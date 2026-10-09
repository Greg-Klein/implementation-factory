import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { isMissingFile, now, reportFailure } from "./context.js";
import { dataRoot, feedbackRoot, pluginRoot, scheduleRoot, selfImprovementAutorun, storageRoot } from "./config.js";
import { isImprovementWorktree, mergeNeedsRestart, positiveDuration, withoutBundlerVariables } from "./domain.js";
import { engine } from "./engine/index.js";
import { autoMergeBlockers, autoMergeDecision, changedFiles, judgeVerdict, latestDecisions, recentAutoMerges, rejectedEntry, type AutoMergeDecision, type RejectedAttempt } from "./auto-merge-policy.js";
import { applySelfImprovementReview, notice, readImprovementReport, realignPendingImprovements, type PromotionResult } from "./self-improvement.js";
import { branchIsRebasedOn, changedPaths, headCommit, listWorktrees, rebaseWorktree, removeWorktree, worktreeCommitCount, worktreeIsClean, type Worktree } from "./worktree.js";
import { improvementReportName } from "./domain.js";

const exec = promisify(execFile);

/**
 * Every finished branch is decided here, never left to a review: the user only
 * sees what was merged, and can revert it. Off with the rest of the loop
 * when IMPL_SELF_IMPROVEMENT_AUTORUN is false, since the judge is a session the
 * console starts on its own.
 */
function autoMergeOn() { return selfImprovementAutorun(); }

const decisionsFile = path.join(storageRoot, "self-improvement-decisions.jsonl");
/** Beside the scheduling files, outside the plugin, where the judge may write. */
const judgeRoot = path.join(path.dirname(scheduleRoot), "improvement-judge");
const POLL_MS = positiveDuration(process.env.IMPL_AUTO_MERGE_POLL_MS, 60_000);
const CHECK_TIMEOUT_MS = 20 * 60_000;
const JUDGE_TIMEOUT_MS = 15 * 60_000;
const OUTPUT_TAIL = 1_500;

let decisions: AutoMergeDecision[] = [];
let checking: string | undefined;
let ticking = false;
let restartPending = false;
let bootCommit: string | undefined;
let isIdle: () => boolean = () => false;

/** What the page shows of a branch with commits: the console decides it, nobody else. */
export function autoMergeView(worktreeName: string) {
  if (!autoMergeOn()) return undefined;
  return { state: checking === worktreeName ? "checking" as const : "waiting" as const };
}

/** The branches merged without the user in the last day, which the page offers to revert. */
export function recentAutomaticMerges() {
  return autoMergeOn() ? recentAutoMerges(decisions, Date.now()).map(({ worktreeName, at, reasons }) => ({ worktreeName, at, reasons })) : [];
}

async function readDecisions() {
  let text: string;
  try {
    text = await readFile(decisionsFile, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return [];
    // Not an absent file: kept aside so the next decision does not overwrite what it held.
    reportFailure("Automatic merge decisions not read", decisionsFile)(error);
    await rename(decisionsFile, `${decisionsFile}.unreadable-${Date.now()}`).catch(reportFailure("Unreadable automatic merge decisions not kept aside", decisionsFile));
    return [];
  }
  const read: AutoMergeDecision[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    let decision: AutoMergeDecision | undefined;
    try { decision = autoMergeDecision(JSON.parse(line) as unknown); } catch { decision = undefined; }
    if (decision) read.push(decision);
    else reportFailure("Automatic merge decision not understood", `${decisionsFile}:${index + 1}`)(new Error("not a decision line"));
  }
  return read;
}

async function record(decision: AutoMergeDecision) {
  await mkdir(path.dirname(decisionsFile), { recursive: true });
  await appendFile(decisionsFile, `${JSON.stringify(decision)}\n`);
  decisions.push(decision);
}

/**
 * The feedback the rejected branch processed goes back to `pending/` with the
 * reasons, so the next iteration tries another way; after its last allowed
 * attempt it stays processed. Returns how many entries go back.
 */
async function requeueFeedback(branch: string, attempt: RejectedAttempt) {
  const processed = path.join(path.dirname(feedbackRoot), "processed");
  const names = await readdir(processed).catch((error: unknown) => {
    if (isMissingFile(error)) return [] as string[];
    throw error;
  });
  let retried = 0;
  for (const name of names.filter((candidate) => candidate.endsWith(".json"))) {
    const file = path.join(processed, name);
    let raw: unknown;
    try { raw = JSON.parse(await readFile(file, "utf8")) as unknown; } catch (error) { reportFailure("Processed feedback entry not read", file)(error); continue; }
    const outcome = rejectedEntry(raw, branch, attempt);
    if (!outcome) continue;
    if ("exhausted" in outcome) {
      await writeFile(file, JSON.stringify(outcome.exhausted, null, 2));
      continue;
    }
    await mkdir(feedbackRoot, { recursive: true });
    await writeFile(path.join(feedbackRoot, name), JSON.stringify(outcome.retry, null, 2));
    await rm(file);
    retried += 1;
  }
  return retried;
}

/**
 * Discards a branch the rules, the checks or the judge refused: nobody reviews
 * it. Uncommitted work is kept as a patch beside the report before the
 * worktree goes, and the feedback is queued again for another attempt.
 */
async function reject(worktree: Worktree, worktreeName: string, reasons: string[]) {
  const at = now();
  await record({ worktreeName, at, decision: "rejected", reasons, ...(worktree.branch ? { branch: worktree.branch } : {}) });
  if (!(await worktreeIsClean(worktree))) {
    const patch = path.join(path.dirname(feedbackRoot), improvementReportName(worktreeName).replace(/^improvement-report-/, "improvement-uncommitted-").replace(/\.md$/, ".patch"));
    await git(worktree.path, ["add", "--all", "--intent-to-add"]);
    await writeFile(patch, await git(worktree.path, ["diff", "HEAD"]));
  }
  await removeWorktree(pluginRoot, worktree);
  const retried = worktree.branch ? await requeueFeedback(worktree.branch, { branch: worktree.branch, at, reasons }) : 0;
  notice("attention", "Improvement rejected", `${worktreeName}: ${reasons[0]} ${retried > 0 ? `Its feedback is queued again for another attempt.` : "Its feedback is not tried again."}`);
}

/** The environment of the checks: the console's own settings and bundler variables stay out, the suites set theirs. */
function checkEnvironment() {
  const environment: NodeJS.ProcessEnv = withoutBundlerVariables(process.env);
  for (const key of Object.keys(environment)) if (key.startsWith("IMPL_") || key === "PORT") delete environment[key];
  return environment;
}

type Check = { name: string; command: string; ok: boolean; output: string };

async function npm(directory: string, name: string, args: string[]): Promise<Check> {
  const command = `npm ${args.join(" ")}`;
  try {
    await exec("npm", args, { cwd: directory, env: checkEnvironment(), timeout: CHECK_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
    return { name, command, ok: true, output: "" };
  } catch (error) {
    const { stdout = "", stderr = "", message = "" } = error as { stdout?: string; stderr?: string; message?: string };
    return { name, command, ok: false, output: `${stdout}\n${stderr}\n${message}`.trim().slice(-OUTPUT_TAIL) };
  }
}

/**
 * The checks of the branch, run by the console itself on the tree it would
 * merge: what the improvement session says it ran is a claim. The build
 * rewrites a tracked file, put back after.
 */
async function runChecks(worktree: Worktree, integration: boolean) {
  const directory = path.join(worktree.path, "console");
  const checks: Check[] = [];
  const steps: [string, string[]][] = [
    ...(existsSync(path.join(directory, "node_modules")) ? [] : [["install", ["ci", "--no-audit", "--no-fund"]] as [string, string[]]]),
    ["typecheck", ["run", "typecheck"]],
    ["unit tests", ["run", "test:unit"]],
    ["build", ["run", "build"]],
    ...(integration ? [["integration tests", ["run", "test:integration"]] as [string, string[]]] : []),
  ];
  try {
    for (const [name, args] of steps) {
      const check = await npm(directory, name, args);
      checks.push(check);
      if (!check.ok) break;
    }
  } finally {
    await exec("git", ["checkout", "--", "console/next-env.d.ts"], { cwd: worktree.path }).catch(reportFailure("next-env.d.ts not restored", worktree.path));
  }
  return checks;
}

async function git(cwd: string, args: string[]) {
  return (await exec("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 })).stdout;
}

/** Asks the judge, and reads anything but a valid `merge` as a reason to hold. */
async function judge(worktree: Worktree & { branch: string }, worktreeName: string, onto: string, patch: string, files: ReturnType<typeof changedFiles>, checks: Check[]) {
  const directory = path.join(judgeRoot, `${worktreeName}-${Date.now()}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const inputPath = path.join(directory, "input.json");
  const outputPath = path.join(directory, "verdict.json");
  const diffPath = path.join(directory, "diff.patch");
  const feedbackDirectory = path.dirname(feedbackRoot);
  const planPath = path.join(feedbackDirectory, improvementReportName(worktreeName).replace(/^improvement-report-/, "improvement-plan-"));
  await writeFile(diffPath, patch);
  await writeFile(inputPath, JSON.stringify({
    worktreeName, branch: worktree.branch, worktreePath: worktree.path, base: onto, diffPath,
    changedFiles: files.map(({ status, path: file, added, removed }) => ({ status, path: file, added, removed })),
    checks: checks.map(({ name, command, ok }) => ({ name, command, ok })),
    feedbackDirectory, runsDirectory: dataRoot,
    planPath: existsSync(planPath) ? planPath : null,
    reportPath: path.join(feedbackDirectory, improvementReportName(worktreeName)),
  }, null, 2));
  const session = engine.startImprovementJudge({ pluginDir: pluginRoot, inputPath, outputPath, readDirectories: [worktree.path, feedbackDirectory, dataRoot], timeoutMs: JUDGE_TIMEOUT_MS });
  if (!session) return { decision: "hold" as const, reasons: [`${engine.label} was not found: the judge could not run.`] };
  const { timedOut, log } = await session.finished;
  let raw: unknown;
  try { raw = JSON.parse(await readFile(outputPath, "utf8")) as unknown; } catch { raw = undefined; }
  const read = raw === undefined ? { error: timedOut ? "The judge ran out of time." : "The judge wrote no verdict." } : judgeVerdict(raw);
  if ("error" in read) {
    await writeFile(path.join(directory, "session.log"), log).catch(reportFailure("Judge log not kept", directory));
    return { decision: "hold" as const, reasons: [`${read.error} Its files are kept in ${directory}.`] };
  }
  await rm(directory, { recursive: true, force: true }).catch(reportFailure("Judge files not removed", directory));
  return read.verdict;
}

/**
 * Decides one finished branch: replayed on the harness, held on a mechanical
 * rule, on a failed check or on the judge's word, merged otherwise. Returns
 * without a decision when the harness or the branch moved during the checks,
 * so the next tick starts again on the tree that would really be merged.
 */
async function decide(worktree: Worktree, worktreeName: string) {
  const branch = worktree.branch;
  if (!branch) return reject(worktree, worktreeName, ["The worktree is on no branch."]);
  const onto = await headCommit(pluginRoot);
  // Replayed here without the assisted rebase, which a tick a minute would start over and over.
  if (!(await branchIsRebasedOn(pluginRoot, branch, onto)) && !(await rebaseWorktree(worktree, onto)))
    return reject(worktree, worktreeName, ["The branch conflicts with the harness and git alone could not replay it."]);
  const branchHead = (await git(pluginRoot, ["rev-parse", branch])).trim();
  const [nameStatus, numstat, patch] = await Promise.all([
    git(pluginRoot, ["diff", "-M", "--name-status", onto, branchHead]),
    git(pluginRoot, ["diff", "-M", "--numstat", onto, branchHead]),
    git(pluginRoot, ["diff", "-M", onto, branchHead]),
  ]);
  const files = changedFiles(nameStatus, numstat);
  const blockers = autoMergeBlockers(files, patch);
  if (blockers.length > 0) return reject(worktree, worktreeName, blockers);
  const checks = await runChecks(worktree, mergeNeedsRestart(files.flatMap((file) => [file.path, ...(file.oldPath ? [file.oldPath] : [])])));
  const failed = checks.find((check) => !check.ok);
  if (failed) return reject(worktree, worktreeName, [`The ${failed.name} check failed (${failed.command}).`, failed.output.split("\n").filter(Boolean).slice(-3).join(" ")].filter(Boolean));
  const verdict = await judge({ ...worktree, branch }, worktreeName, onto, patch, files, checks);
  if (verdict.decision !== "merge") return reject(worktree, worktreeName, verdict.reasons);
  if ((await headCommit(pluginRoot)) !== onto || (await git(pluginRoot, ["rev-parse", branch])).trim() !== branchHead) return;
  let result: PromotionResult;
  try {
    result = await applySelfImprovementReview(worktreeName, true, true);
  } catch (error) {
    return reject(worktree, worktreeName, [error instanceof Error ? error.message : String(error)]);
  }
  if (!result.mergeCommit) return;
  await record({ worktreeName, at: now(), decision: "merged", reasons: verdict.reasons, branch, mergeCommit: result.mergeCommit });
  afterPromotion(worktreeName, result);
}

/** Every improvement worktree whose agent is done and whose fate nobody has settled yet. */
async function settleImprovements() {
  for (const worktree of (await listWorktrees()).filter((candidate) => isImprovementWorktree(candidate.path))) {
    const worktreeName = path.basename(worktree.path);
    // The report is what the improvement session writes last: without it, the agent is still at work.
    if ((await readImprovementReport(worktreeName)) === undefined) continue;
    // Uncommitted work is what a failed validation leaves behind: never merged.
    if (!(await worktreeIsClean(worktree))) {
      await reject(worktree, worktreeName, ["The improvement session left its change uncommitted: its own validation failed."]);
      continue;
    }
    if ((await worktreeCommitCount(worktree)) === 0) {
      await removeWorktree(pluginRoot, worktree);
      notice("info", "Self-improvement finished without a change", `${worktreeName}: its report stays beside the feedback.`);
      continue;
    }
    checking = worktreeName;
    try {
      await decide(worktree, worktreeName);
    } finally {
      checking = undefined;
    }
  }
}

/**
 * Builds the merged console and hands the restart to the launcher, detached so
 * it outlives this process. Only once no run is working: a restart ends every
 * session the console holds.
 */
async function restartConsole() {
  restartPending = false;
  const consoleDirectory = path.join(pluginRoot, "console");
  const changed = bootCommit ? await changedPaths(pluginRoot, bootCommit, "HEAD").catch(() => [] as string[]) : [];
  notice("info", "Console restarting", "A merged improvement changes the console. It is rebuilt and restarted now that no run is working.");
  const steps: [string, string[]][] = [
    ...(changed.includes("console/package-lock.json") ? [["install", ["ci", "--no-audit", "--no-fund"]] as [string, string[]]] : []),
    ["build", ["run", "build"]],
  ];
  for (const [name, args] of steps) {
    const check = await npm(consoleDirectory, name, args);
    if (!check.ok) {
      notice("attention", "Console not restarted", `The ${name} of the merged code failed: fix it, then run impl restart. ${check.output.split("\n").slice(-2).join(" ")}`);
      await exec("git", ["checkout", "--", "console/next-env.d.ts"], { cwd: pluginRoot }).catch(reportFailure("next-env.d.ts not restored", pluginRoot));
      return;
    }
  }
  await exec("git", ["checkout", "--", "console/next-env.d.ts"], { cwd: pluginRoot }).catch(reportFailure("next-env.d.ts not restored", pluginRoot));
  const child = spawn(path.join(pluginRoot, "bin", "implementation-harness"), ["restart"], {
    cwd: pluginRoot, detached: true, stdio: "ignore", env: { ...withoutBundlerVariables(process.env), IMPL_NO_OPEN: "1" },
  });
  child.on("error", (error) => notice("attention", "Console not restarted", `${error.message}. Run impl restart by hand.`));
  child.unref();
}

/** What follows a merge that changed the console: a restart once idle, or the user's when the loop is turned off. */
export function afterPromotion(worktreeName: string, result: Pick<PromotionResult, "restart">) {
  if (!result.restart) return;
  if (!autoMergeOn()) {
    notice("attention", "Improvements merged, restart needed", `${worktreeName} changes the console: run impl restart to apply it.`);
    return;
  }
  restartPending = true;
  notice("info", "Restart scheduled", `${worktreeName} changes the console: it restarts once no run is working.`);
}

/** Reverts a branch merged without the user, with a merge commit of its own. */
export async function revertAutomaticMerge(worktreeName: string) {
  const latest = latestDecisions(decisions).get(worktreeName);
  if (latest?.decision !== "merged" || !latest.mergeCommit) throw new Error(`${worktreeName} was not merged automatically, or is already reverted.`);
  const mergeCommit = latest.mergeCommit;
  try {
    await exec("git", ["-C", pluginRoot, "revert", "-m", "1", "--no-edit", mergeCommit]);
  } catch (error) {
    await exec("git", ["-C", pluginRoot, "revert", "--abort"]).catch(reportFailure("Revert not aborted", pluginRoot));
    throw new Error(`The revert of ${worktreeName} failed and was rolled back: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
  }
  await record({ worktreeName, at: now(), decision: "reverted", reasons: ["Reverted by the user."], ...(latest.branch ? { branch: latest.branch } : {}) });
  notice("info", "Improvement reverted", worktreeName);
  afterPromotion(worktreeName, { restart: mergeNeedsRestart(await changedPaths(pluginRoot, `${mergeCommit}^1`, mergeCommit)) });
  await realignPendingImprovements();
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await settleImprovements();
    if (restartPending && isIdle()) await restartConsole();
  } finally {
    ticking = false;
  }
}

/** Starts the watch of finished improvement branches, unless the improvement loop is turned off. */
export async function startAutoMerge(options: { isIdle: () => boolean }) {
  if (!autoMergeOn()) return;
  isIdle = options.isIdle;
  bootCommit = await headCommit(pluginRoot);
  decisions = await readDecisions();
  const run = () => { tick().catch(reportFailure("Automatic merge not run")); };
  setInterval(run, POLL_MS).unref();
  run();
}
