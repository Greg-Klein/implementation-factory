import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { pluginRoot } from "./config.js";
import { excludeLine, isRunWorktreePath, RUN_WORKTREES_DIRECTORY, withExcludeLines, worktreeProvisioning, type WorktreeFacts } from "./domain.js";

const exec = promisify(execFile);

export type Worktree = { path: string; branch?: string };

/** Every worktree registered against a checkout, the primary one included. The harness checkout unless another is named. */
export async function listWorktrees(repository: string = pluginRoot): Promise<Worktree[]> {
  const { stdout } = await exec("git", ["worktree", "list", "--porcelain"], { cwd: repository });
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
export async function findWorktree(name: string, repository: string = pluginRoot): Promise<Worktree | undefined> {
  return (await listWorktrees(repository)).find((worktree) => path.basename(worktree.path) === name);
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

/**
 * Drops an improvement worktree and the branch it was on, once its fate is
 * settled. Never used on the worktree of a ticket: see removeRunWorktree.
 */
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

/**
 * The main checkout behind a directory, which may be a sub-directory of it or
 * one of its linked worktrees. The worktrees of the runs and the ticket lock
 * both hang on that one path, so a launch from a linked worktree lands on the
 * same repository as a launch from its root.
 */
export async function mainCheckout(directory: string) {
  try {
    const common = (await exec("git", ["-C", directory, "rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim();
    if (path.basename(common) === ".git") return path.dirname(common);
    return (await exec("git", ["-C", directory, "rev-parse", "--show-toplevel"])).stdout.trim();
  } catch {
    throw new Error(`The project directory is not a git repository: ${directory}`);
  }
}

/** The branch checked out in a checkout, undefined on a detached HEAD. */
export async function currentBranch(repository: string) {
  const branch = await exec("git", ["-C", repository, "symbolic-ref", "--quiet", "--short", "HEAD"]).then(({ stdout }) => stdout.trim(), () => "");
  return branch || undefined;
}

/**
 * Makes git ignore paths in every worktree of the repository, through the
 * `info/exclude` of its common directory. A tracked `.gitignore` is never
 * touched, and lines already there are not written twice.
 */
export async function ensureExcluded(repository: string, lines: string[]) {
  if (lines.length === 0) return;
  const common = (await exec("git", ["-C", repository, "rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim();
  const file = path.join(common, "info", "exclude");
  const next = withExcludeLines(await readFile(file, "utf8").catch(() => ""), lines);
  if (next === undefined) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, next);
}

/**
 * A worktree for one run, detached at the commit the checkout is on. No
 * network and no branch: the workflow creates the ticket branch itself, from
 * the base it chooses. The directory holding the worktrees is excluded first,
 * so the main checkout never shows them as untracked.
 */
export async function createRunWorktree(repository: string, worktreePath: string) {
  if (!isRunWorktreePath(repository, worktreePath)) throw new Error(`Worktree path refused: ${worktreePath}`);
  await ensureExcluded(repository, [excludeLine(RUN_WORKTREES_DIRECTORY, { directory: true })]);
  await mkdir(path.dirname(worktreePath), { recursive: true });
  await exec("git", ["-C", repository, "worktree", "add", "--detach", worktreePath, "HEAD"], { maxBuffer: 8 * 1024 * 1024 });
}

/** A copy-on-write copy of a directory, which costs no disk until one side changes. Fails where the platform has none. */
async function cloneDirectory(source: string, target: string) {
  if (process.platform === "darwin") await exec("cp", ["-c", "-R", source, target], { timeout: 180_000 });
  else if (process.platform === "linux") await exec("cp", ["--reflink=auto", "-R", source, target], { timeout: 180_000 });
  else throw new Error("no copy-on-write copy on this platform");
}

const missing = (target: string) => lstat(target).then(() => false, () => true);

export type ProvisionOptions = {
  /** Names of the ignored directories to bring over, at any depth: dependencies, never build outputs. */
  dependencyDirectories: string[];
  /** Ignored files to copy, by name (`.env*`), or by path from the root when the pattern holds a slash. */
  copyFiles: string[];
  /** Replaced in tests, to exercise the fallback. */
  clone?: (source: string, target: string) => Promise<void>;
};

/**
 * Gives a fresh worktree the untracked files it lacks, from the main checkout
 * and without reinstalling anything. Dependency directories are cloned
 * copy-on-write, so an install inside the worktree stays inside it; where the
 * clone fails they are symlinked instead, and an install then writes through
 * to the main checkout. A gitignore pattern such as `node_modules/` does not
 * match a symlink, so each link is excluded by its own path, or the worktree
 * would look dirty and the link could be committed. Configuration files are
 * plain copies. A path the worktree already has is left alone.
 */
export async function provisionWorktree(repository: string, worktreePath: string, options: ProvisionOptions) {
  const { stdout } = await exec("git", ["-C", repository, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"], { maxBuffer: 64 * 1024 * 1024 });
  const plan = worktreeProvisioning(stdout.split("\0").filter(Boolean), options.dependencyDirectories, options.copyFiles);
  const clone = options.clone ?? cloneDirectory;
  const cloned: string[] = [];
  const linked: string[] = [];
  const copied: string[] = [];
  for (const relative of plan.directories) {
    const source = path.join(repository, relative);
    const target = path.join(worktreePath, relative);
    if (!(await missing(target))) continue;
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await clone(source, target);
      cloned.push(relative);
    } catch {
      await rm(target, { recursive: true, force: true });
      await symlink(source, target, "dir");
      linked.push(relative);
    }
  }
  const excluded = linked.map((relative) => excludeLine(relative));
  for (const relative of [...plan.files, ...plan.paths]) {
    const source = path.join(repository, relative);
    const target = path.join(worktreePath, relative);
    if (!(await missing(target))) continue;
    const file = await lstat(source).then((stats) => stats.isFile(), () => false);
    if (!file) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    copied.push(relative);
    // A path named outright is copied whether git ignores it or not, and must not dirty the worktree.
    if (plan.paths.includes(relative)) excluded.push(excludeLine(relative));
  }
  await ensureExcluded(repository, excluded);
  const dependencies = linked.length > 0 ? "symlink" as const : cloned.length > 0 ? "clone" as const : undefined;
  return { cloned, linked, copied, dependencies };
}

/** Whether the commit a worktree is on already sits on a remote-tracking branch. Read from local refs, no network. */
export async function worktreeIsPushed(worktreePath: string) {
  const { stdout } = await exec("git", ["-C", worktreePath, "for-each-ref", "--contains", "HEAD", "--count=1", "refs/remotes"]);
  return stdout.trim() !== "";
}

/** What decides whether a run worktree may go. Anything git cannot answer counts as work that could be lost. */
export async function worktreeFacts(worktreePath: string): Promise<WorktreeFacts> {
  const exists = await lstat(worktreePath).then((stats) => stats.isDirectory(), () => false);
  if (!exists) return { exists: false, clean: true, pushed: true };
  const clean = await worktreeIsClean({ path: worktreePath }).catch(() => false);
  const pushed = await worktreeIsPushed(worktreePath).catch(() => false);
  return { exists, clean, pushed };
}

/** Forgets the worktrees whose directory is gone. */
export async function pruneWorktrees(repository: string) {
  await exec("git", ["-C", repository, "worktree", "prune"]);
}

/**
 * Removes the worktree of a run, and only that: the branch it was on stays,
 * with every commit it holds. Without `force` git refuses a worktree holding
 * uncommitted work, which is the caller's cue to ask before losing it.
 */
export async function removeRunWorktree(repository: string, worktreePath: string, { force = false }: { force?: boolean } = {}) {
  if (!isRunWorktreePath(repository, worktreePath)) throw new Error(`Worktree path refused: ${worktreePath}`);
  await exec("git", ["-C", repository, "worktree", "remove", ...(force ? ["--force"] : []), worktreePath]);
  await pruneWorktrees(repository).catch(() => undefined);
}
