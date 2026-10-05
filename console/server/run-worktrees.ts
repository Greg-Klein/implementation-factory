import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ARCHIVED_ACTIVITIES, now } from "./context.js";
import { worktreeCopyFiles, worktreeDependencyDirectories } from "./config.js";
import { isRunWorktreePath, runHoldsRepository, runWorktreePath, sourceRepository, worktreeKeptDetail, worktreeRemoval } from "./domain.js";
import { normalizeArchivedRun } from "./run-incidents.js";
import { createRunWorktree, provisionWorktree, pruneWorktrees, removeRunWorktree, worktreeFacts } from "./worktree.js";
import type { RunSession } from "./run-session.js";
import type { RunState, RunWorktree } from "./types.js";

/**
 * The worktree of a run, from its creation to its removal. A ticket no longer
 * works in the checkout it was launched on: it gets a worktree of its own
 * under `.claude/worktrees/<run-id>`, so several tickets of one repository run
 * side by side, and the checkout stays the user's.
 */

export type WorktreeRemovalResult = { outcome: "removed" | "confirm" | "refused"; message: string; risks?: string[] };

const REMOVED = "Worktree removed";

/**
 * Creates the worktree and fills it. A failure to create it is the caller's
 * to report, and the run must not start; a failure to bring the dependencies
 * over leaves a worktree that works after an install, so it is only reported
 * back as `warning`.
 */
export async function prepareRunWorktree(repository: string, runId: string): Promise<{ worktree: RunWorktree; summary: string; warning?: string }> {
  const worktreePath = runWorktreePath(repository, runId);
  await createRunWorktree(repository, worktreePath);
  try {
    const provisioned = await provisionWorktree(repository, worktreePath, { dependencyDirectories: worktreeDependencyDirectories, copyFiles: worktreeCopyFiles });
    const parts = [
      provisioned.cloned.length > 0 ? `${provisioned.cloned.length} dependency ${provisioned.cloned.length > 1 ? "directories" : "directory"} cloned` : "",
      provisioned.linked.length > 0 ? `${provisioned.linked.length} linked by symlink` : "",
      provisioned.copied.length > 0 ? `${provisioned.copied.length} configuration file${provisioned.copied.length > 1 ? "s" : ""} copied` : "",
      provisioned.hooks.length > 0 ? `git hooks copied (${provisioned.hooks.join(", ")})` : "",
    ].filter(Boolean);
    return { worktree: { path: worktreePath, state: "active", ...(provisioned.dependencies ? { dependencies: provisioned.dependencies } : {}) }, summary: parts.join(", ") };
  } catch (error) {
    return { worktree: { path: worktreePath, state: "active" }, summary: "", warning: error instanceof Error ? error.message.split("\n")[0] : String(error) };
  }
}

/** Undoes a worktree whose run never started. Nothing was written in it yet. */
export async function discardRunWorktree(repository: string, worktreePath: string) {
  await removeRunWorktree(repository, worktreePath, { force: true }).catch(() => undefined);
}

/**
 * What becomes of a worktree once nothing works in it, decided on the state
 * given and on what git says. Returns the worktree as it should now read, or
 * undefined when there is nothing to settle.
 */
async function settle(state: RunState): Promise<RunWorktree | undefined> {
  const worktree = state.worktree;
  if (!worktree || worktree.state === "removed" || runHoldsRepository(state)) return undefined;
  const repository = sourceRepository(state);
  const facts = await worktreeFacts(worktree.path);
  if (!facts.exists) {
    await pruneWorktrees(repository).catch(() => undefined);
    return { ...worktree, state: "removed", detail: "Worktree not found on disk" };
  }
  const decision = worktreeRemoval(state, facts);
  if (decision.automatic && isRunWorktreePath(repository, worktree.path)) {
    const removed = await removeRunWorktree(repository, worktree.path).then(() => true, () => false);
    if (removed) return { ...worktree, state: "removed", detail: REMOVED };
    return { ...worktree, state: "kept", detail: worktreeKeptDetail(["git refused the removal"]) };
  }
  return { ...worktree, state: "kept", detail: worktreeKeptDetail(decision.reasons) };
}

/**
 * Called once the session of a run is gone: the worktree goes on its own when
 * the run delivered and nothing would be lost, and is kept with its reason
 * otherwise.
 */
export async function settleRunWorktree(session: RunSession) {
  const before = session.state.worktree;
  const settled = await settle(session.state).catch(() => undefined);
  if (!settled || session.state.worktree !== before) return;
  if (settled.state === before?.state && settled.detail === before.detail) return;
  if (settled.state === "removed") await session.artifactWatcher?.close().catch(() => undefined);
  session.state.worktree = settled;
  session.activity("system", settled.state === "removed" ? REMOVED : "Worktree kept", settled.state === "removed" ? settled.path : settled.detail);
  session.publish();
}

/**
 * A removal the user asked for. Refused while the session lives; answered with
 * `confirm` and what would be lost when the tree holds uncommitted or unpushed
 * work, until the request comes back with `force`. The branch always stays.
 */
export async function removeWorktreeOnRequest(session: RunSession, force: boolean): Promise<WorktreeRemovalResult> {
  const worktree = session.state.worktree;
  if (!worktree) return { outcome: "refused", message: "This run has no worktree." };
  if (worktree.state === "removed") return { outcome: "removed", message: REMOVED };
  if (runHoldsRepository(session.state)) return { outcome: "refused", message: "This run still holds its session. Stop it before removing its worktree." };
  const repository = sourceRepository(session.state);
  if (!isRunWorktreePath(repository, worktree.path)) return { outcome: "refused", message: "This path is not a worktree created by the harness. Nothing was removed." };
  const facts = await worktreeFacts(worktree.path);
  const applied = (next: RunWorktree, title: string) => {
    session.state.worktree = next;
    session.activity("system", title, worktree.path);
    session.publish();
  };
  if (!facts.exists) {
    await pruneWorktrees(repository).catch(() => undefined);
    applied({ ...worktree, state: "removed", detail: "Worktree not found on disk" }, "Worktree already gone from disk");
    return { outcome: "removed", message: "This worktree was no longer on disk." };
  }
  const { risks } = worktreeRemoval(session.state, facts);
  if (risks.length > 0 && !force) {
    return { outcome: "confirm", risks, message: `This worktree holds ${risks.join(" and ")}. Removing it loses what is not committed; the branch and its commits stay in the repository.` };
  }
  try {
    await session.artifactWatcher?.close().catch(() => undefined);
    await removeRunWorktree(repository, worktree.path, { force: !facts.clean });
  } catch (error) {
    return { outcome: "refused", message: `git refused the removal: ${error instanceof Error ? error.message.split("\n").filter(Boolean).pop() : error}` };
  }
  applied({ ...worktree, state: "removed", detail: REMOVED }, risks.length > 0 ? "Worktree removed despite unsaved work" : REMOVED);
  return { outcome: "removed", message: "Worktree removed. The branch is kept." };
}

/**
 * Read at startup, after the interrupted runs were closed and before the
 * archive is listed: a worktree whose directory vanished is pruned, one whose
 * run delivered and that holds nothing to lose is removed, and every other one
 * is marked kept with its reason, which is what puts its run back in the list
 * with the removal on offer.
 */
export async function reconcileRunWorktrees(runsDirectory: string) {
  let runIds: string[];
  try { runIds = await readdir(runsDirectory); } catch { return; }
  // One after the other: several runs share a repository, and git locks it.
  for (const runId of runIds) {
    const runFile = path.join(runsDirectory, runId, "run.json");
    try {
      const raw = JSON.parse(await readFile(runFile, "utf8")) as RunState;
      const state = normalizeArchivedRun(raw, runId);
      if (!state?.worktree || state.worktree.state === "removed") continue;
      const settled = await settle(state);
      if (!settled || (settled.state === state.worktree.state && settled.detail === state.worktree.detail)) continue;
      const title = settled.state === "removed" ? (settled.detail ?? REMOVED) : "Worktree kept";
      const activities = [{ id: crypto.randomUUID(), at: now(), kind: "system" as const, title, detail: settled.state === "removed" ? settled.path : settled.detail }, ...(Array.isArray(raw.activities) ? raw.activities : [])].slice(0, ARCHIVED_ACTIVITIES);
      const temporary = `${runFile}.worktree.tmp`;
      await writeFile(temporary, JSON.stringify({ ...raw, worktree: settled, activities }, null, 2));
      await rename(temporary, runFile);
    } catch { /* one unreadable archive must not keep the others from being reconciled */ }
  }
}
