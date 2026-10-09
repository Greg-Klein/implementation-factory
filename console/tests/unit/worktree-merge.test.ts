import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { branchIsMerged, changedPaths, branchIsRebasedOn, branchMergesCleanly, headCommit, mergeBranch, rebaseWorktree, worktreeIsClean } from "../../server/worktree";

let repository: string;

function git(...args: string[]) {
  return execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim();
}

function commit(file: string, content: string, message: string) {
  writeFileSync(path.join(repository, file), content);
  git("add", file);
  git("commit", "-m", message);
}

beforeEach(() => {
  repository = mkdtempSync(path.join(os.tmpdir(), "impl-merge-"));
  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  commit("README.md", "base\n", "base");
});

afterEach(() => rmSync(repository, { recursive: true, force: true }));

describe("merging an improvement branch", () => {
  it("should list the files the merge brought in", async () => {
    const before = await headCommit(repository);
    git("checkout", "-q", "-b", "improvement");
    commit("fix.ts", "export const fixed = true;\n", "fix: something");
    git("checkout", "-q", "main");
    await mergeBranch(repository, "improvement", "apply");

    await expect(changedPaths(repository, before, "HEAD")).resolves.toEqual(["fix.ts"]);
  });

  it("should report the merge when the branch brings a commit", async () => {
    git("checkout", "-q", "-b", "improvement");
    commit("fix.ts", "export const fixed = true;\n", "fix: something");
    git("checkout", "-q", "main");

    await expect(mergeBranch(repository, "improvement", "apply")).resolves.toBe(true);
    expect(git("log", "-1", "--format=%s")).toBe("apply");
  });

  // The defect this guards: git answers "Already up to date" with exit code 0,
  // and the console used to announce a merge and then destroy the worktree.
  it("should report that nothing was merged when the branch holds no commit", async () => {
    git("branch", "improvement");
    const before = git("rev-parse", "HEAD");

    await expect(mergeBranch(repository, "improvement", "apply")).resolves.toBe(false);
    expect(git("rev-parse", "HEAD")).toBe(before);
  });

  it("should leave no half-merged checkout behind when the merge conflicts", async () => {
    git("checkout", "-q", "-b", "improvement");
    commit("README.md", "from the branch\n", "branch edit");
    git("checkout", "-q", "main");
    commit("README.md", "from main\n", "main edit");
    const before = git("rev-parse", "HEAD");

    await expect(mergeBranch(repository, "improvement", "apply")).rejects.toThrow();
    expect(git("rev-parse", "HEAD")).toBe(before);
    expect(git("status", "--porcelain")).toBe("");
  });
});

// The two cases "nothing was merged" covers, which the console has to tell apart
// before it decides whether the worktree is leftover or still holds the work.
describe("telling a landed branch from an empty one", () => {
  it("should report a branch the checkout already contains as merged", async () => {
    git("checkout", "-q", "-b", "improvement");
    commit("fix.ts", "export const fixed = true;\n", "fix: something");
    git("checkout", "-q", "main");
    await mergeBranch(repository, "improvement", "apply");

    await expect(branchIsMerged(repository, "improvement")).resolves.toBe(true);
  });

  it("should report a branch holding a commit of its own as not merged", async () => {
    git("checkout", "-q", "-b", "improvement");
    commit("fix.ts", "export const fixed = true;\n", "fix: something");
    git("checkout", "-q", "main");

    await expect(branchIsMerged(repository, "improvement")).resolves.toBe(false);
  });

  // A commit is its own ancestor, so a branch the agent never committed to answers
  // yes here too. This is why the console pairs the question with the state of the
  // worktree instead of destroying anything on this answer alone.
  it("should report a branch with no commit as merged, since it holds nothing", async () => {
    git("branch", "improvement");

    await expect(branchIsMerged(repository, "improvement")).resolves.toBe(true);
  });
});

describe("uncommitted work in an improvement worktree", () => {
  let worktreePath: string;

  beforeEach(() => {
    worktreePath = path.join(repository, "wt", "self-improvement-abcd1234");
    git("worktree", "add", "-q", "-b", "improvement", worktreePath);
  });

  it("should report a worktree with nothing pending as clean", async () => {
    await expect(worktreeIsClean({ path: worktreePath, branch: "improvement" })).resolves.toBe(true);
  });

  // The state /implementation-factory:improve deliberately leaves behind when its
  // own validation fails: the diagnosis exists nowhere else.
  it("should report a worktree holding an uncommitted diagnosis as dirty", async () => {
    writeFileSync(path.join(worktreePath, "fix.ts"), "export const halfDone = true;\n");

    await expect(worktreeIsClean({ path: worktreePath, branch: "improvement" })).resolves.toBe(false);
  });
});

describe("simulating the promotion before the buttons open", () => {
  it("should report a clean merge without moving the checkout", async () => {
    git("checkout", "-q", "-b", "improvement");
    commit("fix.ts", "export const fixed = true;\n", "fix: something");
    git("checkout", "-q", "main");
    const before = git("rev-parse", "HEAD");

    await expect(branchMergesCleanly(repository, "improvement")).resolves.toBe(true);
    expect(git("rev-parse", "HEAD")).toBe(before);
    expect(git("status", "--porcelain")).toBe("");
  });

  // The 7 September situation: four branches offered as one click, none of which
  // could merge, and the user only found out by clicking.
  it("should report a conflict without touching the checkout", async () => {
    git("checkout", "-q", "-b", "improvement");
    commit("README.md", "from the branch\n", "branch edit");
    git("checkout", "-q", "main");
    commit("README.md", "from main\n", "main edit");
    const before = git("rev-parse", "HEAD");

    await expect(branchMergesCleanly(repository, "improvement")).resolves.toBe(false);
    expect(git("rev-parse", "HEAD")).toBe(before);
    expect(git("status", "--porcelain")).toBe("");
  });
});

// What unblocks a queue of improvements: they are all cut from the same base, so the
// first promotion leaves every branch behind it standing on a checkout that moved.
describe("replaying an improvement branch on top of the factory", () => {
  let worktreePath: string;

  function inWorktree(...args: string[]) {
    return execFileSync("git", ["-C", worktreePath, ...args], { encoding: "utf8" }).trim();
  }

  beforeEach(() => {
    worktreePath = path.join(repository, "wt", "self-improvement-abcd1234");
    git("worktree", "add", "-q", "-b", "improvement", worktreePath);
    writeFileSync(path.join(worktreePath, "fix.ts"), "export const fixed = true;\n");
    inWorktree("add", "fix.ts");
    inWorktree("commit", "-m", "fix: something");
  });

  it("should put a branch the factory outran back on top of it", async () => {
    commit("CHANGELOG.md", "main moved on\n", "main edit");
    const onto = await headCommit(repository);
    await expect(branchIsRebasedOn(repository, "improvement", onto)).resolves.toBe(false);

    await expect(rebaseWorktree({ path: worktreePath, branch: "improvement" }, onto)).resolves.toBe(true);
    await expect(branchIsRebasedOn(repository, "improvement", onto)).resolves.toBe(true);
    await expect(branchMergesCleanly(repository, "improvement")).resolves.toBe(true);
    expect(inWorktree("log", "-1", "--format=%s")).toBe("fix: something");
  });

  // A rebase that stops mid-way leaves the worktree unusable and the branch half
  // replayed, which is worse than the drift it was meant to close. This is the case
  // the console hands to an agent.
  it("should leave the branch exactly where it was when the replay conflicts", async () => {
    writeFileSync(path.join(worktreePath, "README.md"), "from the branch\n");
    inWorktree("commit", "-am", "branch edit");
    const before = inWorktree("rev-parse", "HEAD");
    commit("README.md", "from main\n", "main edit");

    await expect(rebaseWorktree({ path: worktreePath, branch: "improvement" }, await headCommit(repository))).resolves.toBe(false);
    expect(inWorktree("rev-parse", "HEAD")).toBe(before);
    expect(inWorktree("status", "--porcelain")).toBe("");
  });

  it("should report a branch already on top of the checkout as needing no replay", async () => {
    await expect(branchIsRebasedOn(repository, "improvement", await headCommit(repository))).resolves.toBe(true);
  });
});
