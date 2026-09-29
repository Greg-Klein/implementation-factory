import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { broadcast, now } from "./context.js";
import { feedbackRoot, pluginRoot, selfImprovementAutorun } from "./config.js";
import { demoState } from "./demo.js";
import { commitlessImprovementStatus, hasAuditableEvidence, improvementReportName, improvementWorktreeInFlight, improvementWorktreeName, isImprovementWorktree, normalizeText } from "./domain.js";
import { engine } from "./engine/index.js";
import { branchIsMerged, branchIsRebasedOn, branchMergesCleanly, headCommit, listWorktrees, rebaseWorktree, worktreeCommitCount, worktreeIsClean } from "./worktree.js";
import type { RunSession } from "./run-session.js";
import type { PendingSelfImprovementReview, RunState } from "./types.js";

const auditedRuns = new Set<string>();

/**
 * The improvement loop belongs to the harness, not to any one run: it is read
 * from the worktrees on disk and it keeps going after the run that triggered it
 * is closed. What it has to say therefore goes to every open page instead of
 * into the activity feed of a run that may no longer exist.
 */
export function notice(level: "info" | "attention", title: string, detail?: string) {
  broadcast({ type: "notice", level, title, detail, at: now() });
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
      reviews.push({ worktreeName, branch: worktree.branch, commits: 0, status: commitlessImprovementStatus({ reported }) });
      continue;
    }
    const mergesCleanly = worktree.branch ? await branchMergesCleanly(pluginRoot, worktree.branch).catch(() => true) : true;
    reviews.push({ worktreeName: path.basename(worktree.path), branch: worktree.branch, commits, mergesCleanly, status: "ready" });
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
  child.on("close", (code) => {
    notice(code === 0 ? "info" : "attention", code === 0 ? "Rebase assisté terminé" : "Rebase assisté en échec", worktreeName);
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
      notice("info", "Amélioration rebasée sur le harnais", name);
      continue;
    }
    const delegated = startConflictResolution(name, onto);
    notice("attention", delegated ? "Rebase assisté lancé" : "Rebase impossible",
      delegated ? `${name} est en conflit avec le harnais, un agent le reprend dans son worktree.`
        : `${name} est en conflit avec le harnais. La branche est intacte, à reprendre à la main.`);
  }
}

export async function saveFeedback(session: RunSession, body: string) {
  const feedback = body.trim();
  if (session.demo) throw new Error("La démonstration n'enregistre pas de retour d’auto-amélioration.");
  if (!feedback) throw new Error("Le retour est vide.");
  if (feedback.length > 5_000) throw new Error("Le retour dépasse 5 000 caractères.");
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  await mkdir(feedbackRoot, { recursive: true });
  await writeFile(path.join(feedbackRoot, `${id}.json`), JSON.stringify({
    id, runId: session.id, createdAt: now(), status: "pending", feedback,
    issueUrl: session.state.issueUrl, projectDirectory: session.state.cwd,
  }, null, 2));
  session.activity("artifact", "Retour ajouté à la boucle d’auto-amélioration", `${id}.json`);
  session.publish();
}

async function queueAutonomousReview(session: RunSession, snapshot: RunState) {
  const id = `self-audit-${session.id}`;
  await mkdir(feedbackRoot, { recursive: true });
  await writeFile(path.join(feedbackRoot, `${id}.json`), JSON.stringify({
    id, runId: session.id, createdAt: now(), status: "pending", source: "autonomous",
    objective: "Find durable improvements from observable friction, failures, repeated review findings and missing verification in this run.",
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
  }, null, 2));
  session.activity("artifact", "Auto-audit mis en file", `${id}.json`);
  session.publish();
}

/** Resolves once the launch itself has returned, which is what lets the next audit take its turn. */
function startAutonomousImprovement(session: RunSession) {
  return new Promise<void>((resolve) => {
    if (!selfImprovementAutorun()) return resolve();
    void listWorktrees().catch(() => []).then((worktrees) => {
      const inFlight = improvementWorktreeInFlight(worktrees.map((worktree) => worktree.path));
      if (inFlight) {
        notice("info", "Auto-amélioration en attente", `${path.basename(inFlight)} n'est pas encore tranché. Fusionne-le ou ignore-le pour libérer la boucle.`);
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
        if (code === 0 && !launchError) notice("info", "Auto-amélioration lancée en tâche de fond", worktreeName);
        else notice("attention", "Auto-amélioration non démarrée", normalizeText(launchError?.message ?? output));
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
    while (auditQueue.length > 0) await auditQueue.shift()?.().catch(() => undefined);
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
    session.activity("system", "Auto-audit sans objet", "Cette exécution n'a produit ni agent, ni document, ni échec à analyser.");
    session.publish();
    return;
  }
  auditQueue.push(() => queueAutonomousReview(session, snapshot)
    .then(() => startAutonomousImprovement(session))
    .catch((error) => {
      session.activity("attention", "Auto-audit impossible", normalizeText(error instanceof Error ? error.message : error));
      session.publish();
    }));
  void drainAudits();
}
