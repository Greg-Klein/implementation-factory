import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { pluginRoot } from "./config.js";

const exec = promisify(execFile);

export type Worktree = { path: string; branch?: string };

/** Every worktree registered against the harness checkout, the primary one included. */
export async function listWorktrees(): Promise<Worktree[]> {
  const { stdout } = await exec("git", ["worktree", "list", "--porcelain"], { cwd: pluginRoot });
  return stdout.split("\n\n").flatMap((block) => {
    const lines = block.split("\n");
    const worktreePath = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    if (!worktreePath) return [];
    return [{ path: worktreePath, branch: lines.find((line) => line.startsWith("branch refs/heads/"))?.slice("branch refs/heads/".length) }];
  });
}

/**
 * The agent is free to rename the branch it creates for a worktree, and Claude
 * Code does exactly that by prefixing it with "worktree-". The directory name
 * is the only handle that stays what the harness asked for, whichever engine
 * created it.
 */
export async function findWorktree(name: string): Promise<Worktree | undefined> {
  return (await listWorktrees()).find((worktree) => path.basename(worktree.path) === name);
}

/** The point where the worktree left the branch the harness itself runs on. */
async function mergeBase(worktree: Worktree) {
  const branch = (await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: pluginRoot })).stdout.trim();
  return (await exec("git", ["merge-base", "HEAD", branch], { cwd: worktree.path })).stdout.trim();
}

/** Committed and uncommitted work, measured from the point where the worktree left the harness branch. */
export async function worktreeDiff(worktree: Worktree) {
  const base = await mergeBase(worktree);
  const { stdout } = await exec("git", ["diff", base], { cwd: worktree.path, maxBuffer: 2 * 1024 * 1024 });
  return stdout;
}

/**
 * Commits the worktree added on top of the harness branch. Uncommitted work is
 * deliberately not counted: /implementation-harness:improve leaves the branch
 * uncommitted when its own validation fails, and that state must never be
 * offered for promotion.
 */
export async function worktreeCommitCount(worktree: Worktree) {
  const base = await mergeBase(worktree);
  const { stdout } = await exec("git", ["rev-list", "--count", `${base}..HEAD`], { cwd: worktree.path });
  return Number(stdout.trim()) || 0;
}

/**
 * Whether the checkout already contains every commit of the branch. A commit is
 * its own ancestor, so a branch the improvement agent never committed to answers
 * yes as well: this says the branch has nothing left to give, never that it once
 * gave something. Pair it with `worktreeIsClean` before destroying anything.
 */
export async function branchIsMerged(repository: string, branch: string) {
  return await exec("git", ["-C", repository, "merge-base", "--is-ancestor", branch, "HEAD"]).then(() => true, () => false);
}

/**
 * No uncommitted change in the worktree. /implementation-harness:improve leaves
 * its branch uncommitted when its own validation fails, and that diagnosis is the
 * only copy: nothing may be removed while it is still on disk.
 */
export async function worktreeIsClean(worktree: Worktree) {
  const { stdout } = await exec("git", ["status", "--porcelain"], { cwd: worktree.path });
  return stdout.trim() === "";
}

/**
 * Simulates the merge without touching the checkout: `merge-tree --write-tree`
 * exits 0 on a clean merge and 1 on a conflict, and writes only to the object
 * database. Asked before the buttons open, so a promotion is never announced as
 * one click when the user would discover the conflict by clicking.
 */
export async function branchMergesCleanly(repository: string, branch: string) {
  return await exec("git", ["-C", repository, "merge-tree", "--write-tree", "HEAD", branch], { maxBuffer: 8 * 1024 * 1024 }).then(() => true, () => false);
}

/** Drops the worktree and the branch it was on, once its fate is settled. */
export async function removeWorktree(repository: string, worktree: Worktree) {
  await exec("git", ["worktree", "remove", "--force", "--force", worktree.path], { cwd: repository });
  if (worktree.branch) await exec("git", ["-C", repository, "branch", "-D", worktree.branch]).catch(() => undefined);
}

/**
 * Merges an improvement branch into a checkout and reports whether it brought
 * anything. Git answers "Already up to date" with a zero exit code, so the exit
 * code alone cannot tell a real merge from a branch that holds no commit, and a
 * conflict leaves the checkout half-merged unless it is aborted here.
 */
export async function mergeBranch(repository: string, branch: string, message: string) {
  const head = async () => (await exec("git", ["-C", repository, "rev-parse", "HEAD"])).stdout.trim();
  const before = await head();
  try {
    await exec("git", ["-C", repository, "merge", "--no-ff", branch, "-m", message]);
  } catch (error) {
    await exec("git", ["-C", repository, "merge", "--abort"]).catch(() => undefined);
    throw error;
  }
  return (await head()) !== before;
}

/** The files that differ between two commits, relative to the repository root. */
export async function changedPaths(repository: string, from: string, to: string) {
  const { stdout } = await exec("git", ["-C", repository, "diff", "--name-only", from, to]);
  return stdout.split("\n").filter(Boolean);
}

/** The commit an improvement branch has to sit on top of to merge in one click. */
export async function headCommit(repository: string) {
  return (await exec("git", ["-C", repository, "rev-parse", "HEAD"])).stdout.trim();
}

/** Whether the branch already carries that commit, so replaying it would change nothing. */
export async function branchIsRebasedOn(repository: string, branch: string, commit: string) {
  return await exec("git", ["-C", repository, "merge-base", "--is-ancestor", commit, branch]).then(() => true, () => false);
}

/**
 * Replays the branch on top of `onto`, from inside its own worktree: the branch is
 * checked out there, so no other checkout is allowed to rebase it. A conflict git
 * cannot resolve leaves the worktree stopped mid-rebase, so it is aborted here and
 * the branch is left exactly where it was rather than half-replayed.
 */
export async function rebaseWorktree(worktree: Worktree, onto: string) {
  return await exec("git", ["rebase", onto], { cwd: worktree.path }).then(() => true, async () => {
    await exec("git", ["rebase", "--abort"], { cwd: worktree.path }).catch(() => undefined);
    return false;
  });
}
