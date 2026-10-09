import { defined } from "../lib/defined.js";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { broadcast, isMissingFile, now, reportFailure } from "./context.js";
import { feedbackRoot, pluginRoot, selfImprovementAutorun } from "./config.js";
import { demoState } from "./demo.js";
import { auditReasons, commitlessImprovementStatus, hasAuditableEvidence, improvementCause, pendingEntry, improvementReportName, improvementWorktreeInFlight, improvementWorktreeName, isImprovementWorktree, isImprovementWorktreeName, mergeNeedsRestart, normalizeText, sourceRepository } from "./domain.js";
import { engine } from "./engine/index.js";
import { metricsBaseline, metricsFindings } from "./run-metrics.js";
import { recordRunMetrics, storedMetrics } from "./run-metrics-runtime.js";
import { branchIsMerged, branchIsRebasedOn, branchMergesCleanly, changedPaths, findWorktree, headCommit, listWorktrees, mergeBranch, rebaseWorktree, removeWorktree, worktreeCommitCount, worktreeIsClean } from "./worktree.js";
import type { RunSession } from "./run-session.js";
import type { PendingSelfImprovementReview, RunState } from "./types.js";
import type { PendingEntry } from "./domain.js";

const auditedRuns = new Set<string>();

export type PromotionResult = { merged: boolean; restart: boolean; mergeCommit?: string };

/**
 * Merges an improvement branch into the harness, or drops it, then removes its
 * worktree. The one promotion path, whether the user clicked or the automatic
 * merge decided. Restarting the console is left to the caller.
 */
export async function applySelfImprovementReview(worktreeName: string, merge: boolean, automatic = false): Promise<PromotionResult> {
  // Asked over the socket, where nothing else checked the name the page sends.
  if (!isImprovementWorktreeName(worktreeName)) throw new Error("Invalid worktree name.");
  if (worktreeName.startsWith("demo-")) {
    demoState.pendingImprovement = undefined;
    notice("info", merge ? "Improvements merged (demo)" : "Improvements ignored (demo)", worktreeName);
    return { merged: false, restart: false };
  }
  const worktree = await findWorktree(worktreeName);
  if (!worktree) throw new Error(`No self-improvement worktree "${worktreeName}" to process.`);
  let result: PromotionResult = { merged: false, restart: false };
  if (merge) {
    if (!worktree.branch) throw new Error(`The worktree "${worktreeName}" is on no branch.`);
    // The harness may have moved since the branch was cut, by an earlier promotion
    // or by hand. Replaying it here is what keeps the promise the button makes:
    // without it, a merge that conflicts is aborted and handed back to the user.
    await realignPendingImprovements();
    // A worktree is destroyed just below, so nothing may be announced as merged
    // before the checkout actually moved.
    const before = await headCommit(pluginRoot);
    const merged = await mergeBranch(pluginRoot, worktree.branch, `self-improvement: apply improvements from ${worktreeName}`)
      .catch((error) => { throw new Error(`The merge of ${worktreeName} failed and was rolled back, the worktree is kept: ${error instanceof Error ? error.message.split("\n")[0] : error}`); });
    // Git brings nothing in two cases its exit code cannot tell apart: a branch
    // whose commits the harness already contains, and one that holds no commit at
    // all. The first is work landed by hand, and refusing to clean it up left no
    // honest way out: merging said nothing was merged, discarding recorded as
    // ignored what had in fact been kept. The second may still be an agent
    // mid-write, so the worktree only goes when it has nothing uncommitted either.
    const spent = !merged && await branchIsMerged(pluginRoot, worktree.branch) && await worktreeIsClean(worktree);
    if (!merged && !spent)
      throw new Error(`${worktreeName} brings no commit to merge. Nothing was merged, the worktree is kept.`);
    // Prompts apply to the next run on their own; the console's code only after a restart.
    const restart = merged && mergeNeedsRestart(await changedPaths(pluginRoot, before, "HEAD").catch(() => []));
    notice("info", merged ? (automatic ? "Improvements merged automatically" : "Improvements merged") : "Improvements already present", worktreeName);
    result = { merged, restart, ...(merged ? { mergeCommit: await headCommit(pluginRoot) } : {}) };
  } else {
    // Merging already refuses to destroy a worktree with something uncommitted
    // on disk (see worktreeIsClean's own contract): ignoring must refuse the same
    // way, or "Ignorer" becomes the one button that can erase a diagnosis the
    // validation step deliberately left uncommitted after a failed check.
    if (!(await worktreeIsClean(worktree)))
      throw new Error(`${worktreeName} holds uncommitted changes: ignoring them would destroy them. Nothing was touched.`);
    notice("info", "Improvements ignored", worktreeName);
  }
  await removeWorktree(pluginRoot, worktree);
  // The checkout just moved under every branch still waiting, which is exactly what
  // left the previous improvement of a series unmergeable.
  if (result.merged) await realignPendingImprovements();
  return result;
}

/**
 * The improvement loop belongs to the harness, not to any one run: it is read
 * from the worktrees on disk and it keeps going after the run that triggered it
 * is closed. What it has to say therefore goes to every open page instead of
 * into the activity feed of a run that may no longer exist.
 */
export function notice(level: "info" | "attention", title: string, detail?: string) {
  broadcast({ type: "notice", level, title, ...defined({ detail }), at: now() });
}

/** The report of an improvement worktree, undefined until its agent has written it. */
export async function readImprovementReport(worktreeName: string) {
  return await readFile(path.join(path.dirname(feedbackRoot), improvementReportName(worktreeName)), "utf8").catch(() => undefined);
}

/**
 * Every self-improvement worktree, whichever run spawned it and however long ago,
 * including one the background agent has just opened and not committed to yet: the
 * console shows it as "analyzing" rather than staying silent until the first commit
 * lands. A worktree with nothing ahead of the harness whose agent has written its
 * report is shown as "finished" instead: the agent is done and the report says why
 * it left nothing to merge.
 * Computed fresh on every call instead of watched: a timer that gives up after
 * a fixed delay can only ever miss a slow commit, and one that never re-checks a
 * worktree it already gave up on loses it for good.
 */
export async function listPendingImprovements(): Promise<PendingSelfImprovementReview[]> {
  const worktrees = (await listWorktrees()).filter((worktree) => isImprovementWorktree(worktree.path));
  const reviews: PendingSelfImprovementReview[] = [];
  for (const worktree of worktrees) {
    const commits = await worktreeCommitCount(worktree).catch(() => 0);
    if (commits === 0) {
      const worktreeName = path.basename(worktree.path);
      const reported = (await readImprovementReport(worktreeName)) !== undefined;
      reviews.push({ worktreeName, ...defined({ branch: worktree.branch }), commits: 0, status: commitlessImprovementStatus({ reported }) });
      continue;
    }
    const mergesCleanly = worktree.branch ? await branchMergesCleanly(pluginRoot, worktree.branch).catch(() => true) : true;
    reviews.push({ worktreeName: path.basename(worktree.path), ...defined({ branch: worktree.branch }), commits, mergesCleanly, status: "ready" });
  }
  if (demoState.pendingImprovement) reviews.push(demoState.pendingImprovement);
  return reviews;
}

/**
 * Hands a branch git could not replay to a background agent, which resolves the
 * conflict in the worktree the branch already lives in and revalidates there.
 * Gated on the same flag as the improvement loop itself: a console the user never
 * opted into autonomy on must not start sessions of its own.
 */
function startConflictResolution(worktreeName: string, onto: string) {
  if (!selfImprovementAutorun()) return false;
  const child = engine.startConflictResolution({ worktreeName, onto });
  if (!child) return false;
  // A session that could not start: without this listener the failure was an unhandled error event.
  // The close that follows it is the same failure, said once.
  let failed = false;
  child.on("error", (error) => { failed = true; notice("attention", "Assisted rebase failed", `${worktreeName}: ${error.message}`); });
  child.on("close", (code) => {
    if (failed) return;
    notice(code === 0 ? "info" : "attention", code === 0 ? "Assisted rebase completed" : "Assisted rebase failed", worktreeName);
  });
  return true;
}

/**
 * Replays every pending improvement branch on top of the harness as it stands now.
 * Improvement branches are all cut from the same base and land one after another, so
 * the first promotion of a series leaves every branch still waiting behind the
 * checkout, and it only drifts further as the next ones land. Replaying them at every
 * move is what keeps the queue to one click each: a branch caught up with a single
 * commit almost always replays on its own, the same branch caught up with ten rarely
 * does.
 *
 * Three states are left untouched on purpose: a branch without a commit is an agent
 * still writing, a branch the checkout already contains has nothing left to replay,
 * and a worktree with uncommitted work holds the diagnosis
 * /implementation-harness:improve deliberately leaves behind when its own validation
 * fails, which a rebase would take away.
 */
export async function realignPendingImprovements() {
  const onto = await headCommit(pluginRoot);
  for (const worktree of (await listWorktrees()).filter((candidate) => isImprovementWorktree(candidate.path))) {
    const branch = worktree.branch;
    if (!branch) continue;
    if (await worktreeCommitCount(worktree).catch(() => 0) === 0) continue;
    if (await branchIsMerged(pluginRoot, branch).catch(() => true)) continue;
    if (await branchIsRebasedOn(pluginRoot, branch, onto).catch(() => true)) continue;
    if (!(await worktreeIsClean(worktree).catch(() => false))) continue;
    const name = path.basename(worktree.path);
    if (await rebaseWorktree(worktree, onto).catch(() => false)) {
      notice("info", "Improvement rebased on the harness", name);
      continue;
    }
    const delegated = startConflictResolution(name, onto);
    notice("attention", delegated ? "Assisted rebase started" : "Rebase not possible",
      delegated ? `${name} conflicts with the harness, an agent is taking it over in its worktree.`
        : `${name} conflicts with the harness. The branch is intact, to be taken over by hand.`);
  }
}

export async function saveFeedback(session: RunSession, body: string) {
  const feedback = body.trim();
  if (session.demo) throw new Error("The demo does not record self-improvement feedback.");
  if (!feedback) throw new Error("The feedback is empty.");
  if (feedback.length > 5_000) throw new Error("The feedback exceeds 5,000 characters.");
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  await mkdir(feedbackRoot, { recursive: true });
  await writeFile(path.join(feedbackRoot, `${id}.json`), JSON.stringify({
    id, runId: session.id, createdAt: now(), status: "pending", feedback,
    issueUrl: session.state.issueUrl, projectDirectory: sourceRepository(session.state),
  }, null, 2));
  session.activity("artifact", "Feedback added to the self-improvement loop", `${id}.json`);
  session.publish();
}

/**
 * What waits in `pending/`. A file that cannot be read or is not an entry is
 * reported and stepped over: it neither opens a session nor hides the others.
 */
async function pendingEntries(): Promise<PendingEntry[]> {
  const names = await readdir(feedbackRoot).catch((error: unknown) => {
    if (isMissingFile(error)) return [] as string[];
    throw error;
  });
  const entries: PendingEntry[] = [];
  for (const name of names.filter((candidate) => candidate.endsWith(".json"))) {
    try {
      const entry = pendingEntry(JSON.parse(await readFile(path.join(feedbackRoot, name), "utf8")) as unknown);
      if (entry) entries.push(entry);
      else reportFailure("Pending feedback entry not understood", name)(new Error("neither user feedback nor a self-audit"));
    } catch (error) {
      // The improvement session moves entries out of the directory while this reads it.
      if (!isMissingFile(error)) reportFailure("Pending feedback entry not read", name)(error);
    }
  }
  return entries;
}

/** Writes the entry of the run and returns what the run proved went wrong, which decides whether a session opens on it. */
async function queueAutonomousReview(session: RunSession, snapshot: RunState) {
  const id = `self-audit-${session.id}`;
  // What the run cost, and how that compares to the runs before it: figures, never ticket content.
  const metrics = await recordRunMetrics(session).catch(reportFailure("Run metrics not recorded", session.id));
  const others = metrics ? await storedMetrics().catch(() => []) : [];
  const findings = metrics ? metricsFindings(metrics, others) : [];
  const reasons = auditReasons(snapshot, findings);
  await mkdir(feedbackRoot, { recursive: true });
  await writeFile(path.join(feedbackRoot, `${id}.json`), JSON.stringify({
    id, runId: session.id, createdAt: now(), status: "pending", source: "autonomous",
    objective: "Find the cause of what `reasons` lists and fix it durably. With no reason, this entry is kept for comparison with later runs and justifies no change on its own.",
    reasons,
    signals: {
      finalStatus: snapshot.status,
      finalPhase: snapshot.phase,
      elapsedMs: snapshot.startedAt ? Date.now() - new Date(snapshot.startedAt).getTime() : null,
      agents: snapshot.agents.map((agent) => ({ name: agent.name, status: agent.status })),
      artifacts: snapshot.artifacts,
      attentionEvents: snapshot.activities.filter((item) => item.kind === "attention").map((item) => item.title),
      error: snapshot.error,
      // Where the run lost its way, as the health monitor diagnosed it, and what it closed with.
      incidents: (snapshot.incidents ?? []).map((incident) => ({
        kind: incident.kind, status: incident.status, reason: incident.reason,
        ...(incident.resolution ? { resolution: incident.resolution.outcome } : {}),
        continuationRequested: Boolean(incident.continuation),
      })),
      // What the run could not prove: criteria left unverified, blocked or failed.
      evidenceGaps: snapshot.acceptance?.available ? {
        total: snapshot.acceptance.counts.total, verified: snapshot.acceptance.counts.verified, unverified: snapshot.acceptance.counts.unverified,
        blocked: snapshot.acceptance.counts.blocked, failed: snapshot.acceptance.counts.failed, stale: snapshot.acceptance.counts.stale,
        diagnostics: snapshot.acceptance.diagnostics,
      } : null,
      workflowStateDeclared: Boolean(snapshot.workflow),
    },
    ...(metrics ? { metrics, baseline: metricsBaseline(metrics, others), findings } : {}),
  }, null, 2));
  session.activity("artifact", "Self-audit queued", `${id}.json`);
  session.publish();
  return reasons;
}

/** Opens the improvement session only on something proven, and says in the feed of the run which it was. */
async function improveOnEvidence(session: RunSession, reasons: string[]) {
  const cause = improvementCause(session.id, reasons, await pendingEntries());
  if (!cause) {
    session.activity("system", "Self-improvement not needed", "Nothing went wrong in this run and no feedback is waiting. Its self-audit is kept for comparison with later runs.");
    session.publish();
    return;
  }
  session.activity("system", "Self-improvement justified", cause);
  session.publish();
  await startAutonomousImprovement(session);
}

/** Resolves once the launch itself has returned, which is what lets the next audit take its turn. */
function startAutonomousImprovement(session: RunSession) {
  return new Promise<void>((resolve) => {
    if (!selfImprovementAutorun()) return resolve();
    void listWorktrees().catch(() => []).then((worktrees) => {
      const inFlight = improvementWorktreeInFlight(worktrees.map((worktree) => worktree.path));
      if (inFlight) {
        notice("info", "Self-improvement waiting", `${path.basename(inFlight)} has not been decided yet: the loop resumes once it is merged or rejected.`);
        return resolve();
      }
      const worktreeName = improvementWorktreeName(session.id);
      const child = engine.startSelfImprovement({
        worktreeName,
        feedbackDirectory: path.dirname(feedbackRoot),
        runId: session.id,
      });
      if (!child) return resolve();
      let output = "";
      let launchError: Error | undefined;
      child.stdout.on("data", (chunk) => { output = (output + chunk.toString()).slice(-4_000); });
      child.stderr.on("data", (chunk) => { output = (output + chunk.toString()).slice(-4_000); });
      child.on("error", (error) => { launchError = error; });
      child.on("close", (code) => {
        if (code === 0 && !launchError) notice("info", "Self-improvement started in the background", worktreeName);
        else notice("attention", "Self-improvement not started", normalizeText(launchError?.message ?? output));
        resolve();
      });
    });
  });
}

/**
 * One improvement agent at a time, whatever the console is running. Several runs
 * finishing together used to each check for a worktree in flight before any of
 * them had created one, and all of them passed: the loop opened concurrent
 * branches on the same checkout, which is the state it was written to avoid.
 * The check and the launch are sequential here, so the second audit sees the
 * worktree the first one opened.
 */
const auditQueue: (() => Promise<void>)[] = [];
let auditing = false;

async function drainAudits() {
  if (auditing) return;
  auditing = true;
  try {
    while (auditQueue.length > 0) await auditQueue.shift()?.().catch(reportFailure("Self-audit not run"));
  } finally {
    auditing = false;
  }
}

/**
 * The Stop hook fires on every idle turn once the workflow reaches its last phase,
 * and the terminal exit fires once more. The decision therefore has to be taken
 * once per run and kept: a second launch races the first one over the same
 * worktree, and one of them destroys the other's work.
 */
export function scheduleAutonomousReview(session: RunSession) {
  if (session.demo) return;
  if (auditedRuns.has(session.id)) return;
  auditedRuns.add(session.id);
  const snapshot = structuredClone(session.archivedState());
  if (!hasAuditableEvidence(snapshot)) {
    session.activity("system", "Self-audit not needed", "This run produced no agent, no document and no failure to analyse.");
    session.publish();
    return;
  }
  auditQueue.push(() => queueAutonomousReview(session, snapshot)
    .then((reasons) => improveOnEvidence(session, reasons))
    .catch((error) => {
      session.activity("attention", "Self-audit not possible", normalizeText(error instanceof Error ? error.message : error));
      session.publish();
    }));
  void drainAudits();
}
