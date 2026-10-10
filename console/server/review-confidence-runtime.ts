import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { defined } from "../lib/defined.js";
import { changedFiles } from "./auto-merge-policy.js";
import { dataRoot, sensitivePaths } from "./config.js";
import { isMissingFile, reportFailure } from "./context.js";
import { changeFacts, type ChangeFacts, gateFacts, type GateFacts, isTestPath, reviewConfidence } from "./review-confidence.js";
import { GATE_LOG_FILE, runMergeBase } from "./run-metrics-runtime.js";
import type { RunSession } from "./run-session.js";
import { fetchMergeRequestTarget } from "./ticket.js";
import type { ReviewConfidence } from "./types.js";

const exec = promisify(execFile);

/**
 * Reads what the review confidence of a run is computed from and that the run
 * state does not carry: its diff, the stop gate's log and the findings of its
 * code review. Each reading is kept on the session and made again only when
 * its source moved, so an event of the run costs a `stat` at most.
 */

/** The simulated run has no worktree: a small change with its test, so the demonstration shows a note the evidence alone decides. */
const DEMO_CHANGE: ChangeFacts = { files: 4, lines: 96, sensitive: [], removedTests: [], codeChanged: true, testChanged: true };

/** The branch the merge request targets, asked of the forge once per address. */
async function deliveryTarget(session: RunSession) {
  const { mergeRequestUrl: url, cwd } = session.state;
  if (!url || !cwd) return undefined;
  if (session.deliveryTarget?.url !== url) session.deliveryTarget = { url, branch: await fetchMergeRequestTarget(url, cwd) };
  return session.deliveryTarget.branch;
}

async function readChangeFacts(session: RunSession, forge: boolean): Promise<ChangeFacts | undefined> {
  const cwd = session.state.cwd;
  const base = await runMergeBase(session.state, forge ? await deliveryTarget(session) : session.deliveryTarget?.branch);
  if (!base) return undefined;
  const git = async (...args: string[]) => (await exec("git", ["-C", cwd, "diff", "-M", ...args], { maxBuffer: 32 * 1024 * 1024 })).stdout;
  const files = changedFiles(await git("--name-status", base), await git("--numstat", base));
  // Only the test files are read line by line, for a test the change disables.
  const tests = files.filter((file) => file.status !== "D" && isTestPath(file.path)).map((file) => file.path);
  const patch = tests.length > 0 ? await git(base, "--", ...tests) : "";
  return changeFacts(files, patch, sensitivePaths);
}

async function changeOf(session: RunSession, forge: boolean) {
  if (session.demo) return DEMO_CHANGE;
  const snapshot = session.acceptanceView?.currentSnapshot?.id ?? "";
  const known = session.confidenceChange;
  if (known?.facts && known.snapshot === snapshot) return known.facts;
  const facts = await readChangeFacts(session, forge).catch((error: unknown) => { reportFailure("Change of the run not read for its review confidence", session.id)(error); return undefined; });
  // A worktree that is gone has no diff left to read: the last one read in it stands.
  if (facts || !known) session.confidenceChange = { snapshot, facts };
  return session.confidenceChange?.facts;
}

async function gateOf(session: RunSession): Promise<GateFacts> {
  if (session.demo) return { failed: 0, unchecked: 0 };
  const file = path.join(dataRoot, session.id, GATE_LOG_FILE);
  try {
    const { size } = await stat(file);
    if (session.confidenceGate?.size !== size) session.confidenceGate = { size, facts: gateFacts(await readFile(file, "utf8")) };
    return session.confidenceGate.facts;
  } catch (error) {
    // No log is no check: a change that opens none, documentation for instance, writes no line.
    if (!isMissingFile(error)) reportFailure("Gate log not read for the review confidence", session.id)(error);
    return session.confidenceGate?.facts ?? { failed: 0, unchecked: 0 };
  }
}

/** `forge`: whether the target of the merge request may be asked of the forge, which a reading made for a page never does. */
export async function computeConfidence(session: RunSession, { forge = false }: { forge?: boolean } = {}): Promise<ReviewConfidence | undefined> {
  const state = session.state;
  return reviewConfidence({
    state, findings: [...session.seniorFindings.values()], gate: await gateOf(session),
    ...defined({ acceptance: state.acceptance, change: await changeOf(session, forge) }),
  });
}
