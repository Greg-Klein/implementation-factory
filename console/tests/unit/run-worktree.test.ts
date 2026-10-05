import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { runWorktreePath } from "../../server/domain";
import { createRunWorktree, currentBranch, ensureExcluded, listWorktrees, mainCheckout, provisionWorktree, removeRunWorktree, worktreeFacts, worktreeIsClean, worktreeIsPushed } from "../../server/worktree";

let root: string;
let repository: string;
let worktree: string;

function git(directory: string, ...args: string[]) {
  return execFileSync("git", ["-C", directory, "-c", "user.email=test@example.com", "-c", "user.name=Test", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function write(directory: string, file: string, content: string) {
  mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
  writeFileSync(path.join(directory, file), content);
}

const exclude = () => readFileSync(path.join(repository, ".git", "info", "exclude"), "utf8");
const defaults = { dependencyDirectories: ["node_modules"], copyFiles: [".env*", ".claude/settings.local.json"] };
/** A platform with no copy-on-write copy, which is what sends the dependencies to a symlink. */
const noClone = { ...defaults, clone: async () => { throw new Error("clone unsupported"); } };

beforeEach(() => {
  // git answers with resolved paths, and the temporary directory of macOS is a symlink.
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "impl-run-worktree-")));
  repository = path.join(root, "repo");
  mkdirSync(repository);
  git(repository, "init", "-q", "-b", "main");
  write(repository, ".gitignore", "node_modules/\n.env*\ndist/\n.next/\n");
  write(repository, "app.ts", "export const answer = 42;\n");
  write(repository, "packages/api/index.ts", "export {};\n");
  git(repository, "add", ".");
  git(repository, "commit", "-q", "-m", "init");
  // What a developer's checkout holds and a fresh worktree lacks.
  write(repository, "node_modules/left-pad/index.js", "module.exports = 1;\n");
  write(repository, "packages/api/node_modules/dep/index.js", "module.exports = 2;\n");
  write(repository, ".env", "SECRET=1\n");
  write(repository, "packages/api/.env.local", "API=1\n");
  write(repository, ".claude/settings.local.json", "{}\n");
  write(repository, "dist/bundle.js", "built\n");
  write(repository, ".next/cache/x", "built\n");
  worktree = runWorktreePath(repository, "2026-10-03T08-00-00-000Z-abcd1234");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("creating the worktree of a run", () => {
  it("should check out the commit the repository is on, detached, without creating a branch", async () => {
    await createRunWorktree(repository, worktree);
    expect(readFileSync(path.join(worktree, "app.ts"), "utf8")).toContain("42");
    expect(git(worktree, "rev-parse", "HEAD")).toBe(git(repository, "rev-parse", "HEAD"));
    expect(git(worktree, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");
    expect(git(repository, "branch", "--format=%(refname:short)")).toBe("main");
    expect((await listWorktrees(repository)).map((entry) => entry.path)).toContain(worktree);
  });

  it("should keep the worktrees out of the main checkout's status through info/exclude, never a tracked .gitignore", async () => {
    await createRunWorktree(repository, worktree);
    expect(exclude()).toContain("/.claude/worktrees/");
    expect(readFileSync(path.join(repository, ".gitignore"), "utf8")).not.toContain("worktrees");
    expect(git(repository, "status", "--porcelain")).not.toContain("worktrees");
  });

  it("should write each exclude line once, however many runs start", async () => {
    await createRunWorktree(repository, worktree);
    await createRunWorktree(repository, runWorktreePath(repository, "second-run"));
    await ensureExcluded(repository, ["/.claude/worktrees/"]);
    expect(exclude().split("\n").filter((line) => line === "/.claude/worktrees/")).toHaveLength(1);
  });

  it("should let two runs of one repository work side by side", async () => {
    const second = runWorktreePath(repository, "second-run");
    await createRunWorktree(repository, worktree);
    await createRunWorktree(repository, second);
    git(worktree, "checkout", "-q", "-b", "feat/1");
    git(second, "checkout", "-q", "-b", "feat/2");
    write(worktree, "app.ts", "export const answer = 1;\n");
    expect(readFileSync(path.join(second, "app.ts"), "utf8")).toContain("42");
    expect(readFileSync(path.join(repository, "app.ts"), "utf8")).toContain("42");
  });

  it("should refuse a path outside the directory the harness owns", async () => {
    await expect(createRunWorktree(repository, path.join(root, "elsewhere"))).rejects.toThrow(/Worktree path refused/);
  });

  it("should fail on a directory that is not a git repository rather than create anything", async () => {
    const plain = path.join(root, "plain");
    mkdirSync(plain);
    await expect(createRunWorktree(plain, runWorktreePath(plain, "run"))).rejects.toThrow();
    expect(existsSync(runWorktreePath(plain, "run"))).toBe(false);
  });
});

describe("what the worktree takes from the main checkout", () => {
  beforeEach(() => createRunWorktree(repository, worktree));

  it("should clone every dependency directory, at any depth, into a copy the run owns", async () => {
    const provisioned = await provisionWorktree(repository, worktree, defaults);
    expect(provisioned.cloned.sort()).toEqual(["node_modules", "packages/api/node_modules"]);
    expect(provisioned.dependencies).toBe("clone");
    expect(lstatSync(path.join(worktree, "node_modules")).isSymbolicLink()).toBe(false);
    expect(readFileSync(path.join(worktree, "packages/api/node_modules/dep/index.js"), "utf8")).toContain("2");
    // An install inside the worktree stays inside it.
    write(worktree, "node_modules/left-pad/index.js", "module.exports = 'changed';\n");
    expect(readFileSync(path.join(repository, "node_modules/left-pad/index.js"), "utf8")).toContain("1");
    await expect(worktreeIsClean({ path: worktree })).resolves.toBe(true);
  });

  it("should fall back on a symlink where the clone fails, and exclude the link by its own path", async () => {
    const provisioned = await provisionWorktree(repository, worktree, noClone);
    expect(provisioned.linked.sort()).toEqual(["node_modules", "packages/api/node_modules"]);
    expect(provisioned.dependencies).toBe("symlink");
    expect(lstatSync(path.join(worktree, "node_modules")).isSymbolicLink()).toBe(true);
    expect(readFileSync(path.join(worktree, "node_modules/left-pad/index.js"), "utf8")).toContain("1");
    // `node_modules/` in .gitignore does not match a symlink: without its own line the worktree is dirty.
    expect(exclude()).toContain("/node_modules\n");
    expect(exclude()).toContain("/packages/api/node_modules\n");
    await expect(worktreeIsClean({ path: worktree })).resolves.toBe(true);
    git(worktree, "add", "--all");
    expect(git(worktree, "status", "--porcelain")).toBe("");
  });

  it("should copy the ignored configuration files, not link them", async () => {
    const provisioned = await provisionWorktree(repository, worktree, defaults);
    expect(provisioned.copied.sort()).toEqual([".claude/settings.local.json", ".env", "packages/api/.env.local"]);
    expect(lstatSync(path.join(worktree, ".env")).isSymbolicLink()).toBe(false);
    write(worktree, ".env", "SECRET=2\n");
    expect(readFileSync(path.join(repository, ".env"), "utf8")).toBe("SECRET=1\n");
    // settings.local.json is not ignored by this repository: copied all the same, and kept out of the status.
    await expect(worktreeIsClean({ path: worktree })).resolves.toBe(true);
  });

  it("should never bring build outputs over", async () => {
    await provisionWorktree(repository, worktree, defaults);
    expect(existsSync(path.join(worktree, "dist"))).toBe(false);
    expect(existsSync(path.join(worktree, ".next"))).toBe(false);
  });

  it("should follow the configured names instead of the defaults", async () => {
    write(repository, "vendor/lib.php", "<?php\n");
    writeFileSync(path.join(repository, ".gitignore"), "node_modules/\n.env*\nvendor/\nlocal.json\n");
    write(repository, "local.json", "{}\n");
    const provisioned = await provisionWorktree(repository, worktree, { dependencyDirectories: ["vendor"], copyFiles: ["local.json"] });
    expect(provisioned.cloned).toEqual(["vendor"]);
    expect(provisioned.copied).toEqual(["local.json"]);
    expect(existsSync(path.join(worktree, "node_modules"))).toBe(false);
    expect(existsSync(path.join(worktree, ".env"))).toBe(false);
  });

  it("should leave alone what the worktree already has", async () => {
    write(worktree, ".env", "SECRET=worktree\n");
    const provisioned = await provisionWorktree(repository, worktree, defaults);
    expect(provisioned.copied).not.toContain(".env");
    expect(readFileSync(path.join(worktree, ".env"), "utf8")).toBe("SECRET=worktree\n");
  });

  it("should not take the worktree of another run for a dependency", async () => {
    const second = runWorktreePath(repository, "second-run");
    await createRunWorktree(repository, second);
    await provisionWorktree(repository, second, defaults);
    const provisioned = await provisionWorktree(repository, worktree, defaults);
    expect([...provisioned.cloned, ...provisioned.copied].filter((entry) => entry.includes("worktrees"))).toEqual([]);
  });
});

describe("the git hooks a worktree runs", () => {
  beforeEach(async () => {
    // The husky layout: a tracked hook sources a helper that `husky install` writes and ignores.
    write(repository, ".husky/pre-commit", '#!/bin/sh\n. "$(dirname -- "$0")/_/husky.sh"\n');
    execFileSync("chmod", ["+x", path.join(repository, ".husky/pre-commit")]);
    git(repository, "add", ".husky/pre-commit");
    git(repository, "commit", "-q", "-m", "hooks");
    git(repository, "config", "core.hooksPath", ".husky");
    write(repository, ".husky/_/.gitignore", "*\n");
    write(repository, ".husky/_/husky.sh", "true\n");
    await createRunWorktree(repository, worktree);
  });

  it("should copy the ignored helper of the hooks path, so the first commit of the run passes its hook", async () => {
    const provisioned = await provisionWorktree(repository, worktree, defaults);
    expect(provisioned.hooks).toEqual([".husky/_"]);
    expect(readFileSync(path.join(worktree, ".husky/_/husky.sh"), "utf8")).toBe("true\n");
    await expect(worktreeIsClean({ path: worktree })).resolves.toBe(true);
    write(worktree, "app.ts", "export const answer = 1;\n");
    git(worktree, "commit", "-q", "-am", "change");
    expect(git(worktree, "log", "-1", "--format=%s")).toBe("change");
  });

  it("should copy nothing for the hooks when the repository sets no hooks path", async () => {
    git(repository, "config", "--unset", "core.hooksPath");
    const provisioned = await provisionWorktree(repository, worktree, defaults);
    expect(provisioned.hooks).toEqual([]);
    expect(existsSync(path.join(worktree, ".husky/_"))).toBe(false);
  });
});

describe("whether a worktree holds work that would be lost", () => {
  let remote: string;

  beforeEach(async () => {
    remote = path.join(root, "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    git(repository, "remote", "add", "origin", remote);
    git(repository, "push", "-q", "-u", "origin", "main");
    await createRunWorktree(repository, worktree);
    await provisionWorktree(repository, worktree, defaults);
    git(worktree, "checkout", "-q", "-b", "feat/42");
  });

  it("should report a fresh worktree as clean and already on the remote", async () => {
    await expect(worktreeFacts(worktree)).resolves.toEqual({ exists: true, clean: true, pushed: true });
  });

  it("should report an uncommitted change as dirty", async () => {
    write(worktree, "app.ts", "export const answer = 43;\n");
    await expect(worktreeFacts(worktree)).resolves.toMatchObject({ clean: false });
  });

  it("should report a file the workflow left untracked as dirty", async () => {
    write(worktree, "notes.md", "to pick up again\n");
    await expect(worktreeIsClean({ path: worktree })).resolves.toBe(false);
  });

  it("should report a commit the remote does not have as unpushed, and as pushed once it is", async () => {
    write(worktree, "app.ts", "export const answer = 43;\n");
    git(worktree, "commit", "-q", "-am", "feat: answer");
    await expect(worktreeIsPushed(worktree)).resolves.toBe(false);
    git(worktree, "push", "-q", "-u", "origin", "feat/42");
    await expect(worktreeFacts(worktree)).resolves.toEqual({ exists: true, clean: true, pushed: true });
  });

  it("should report a directory that vanished as absent rather than fail", async () => {
    rmSync(worktree, { recursive: true, force: true });
    await expect(worktreeFacts(worktree)).resolves.toMatchObject({ exists: false });
  });
});

describe("removing the worktree of a run", () => {
  beforeEach(async () => {
    await createRunWorktree(repository, worktree);
    git(worktree, "checkout", "-q", "-b", "feat/42");
    write(worktree, "app.ts", "export const answer = 43;\n");
    git(worktree, "commit", "-q", "-am", "feat: answer");
  });

  it("should remove the directory and keep the branch with its commits", async () => {
    const commit = git(worktree, "rev-parse", "HEAD");
    await removeRunWorktree(repository, worktree);
    expect(existsSync(worktree)).toBe(false);
    expect(git(repository, "rev-parse", "feat/42")).toBe(commit);
    expect((await listWorktrees(repository)).map((entry) => entry.path)).toEqual([repository]);
  });

  it("should refuse a worktree holding uncommitted work unless forced", async () => {
    write(worktree, "notes.md", "to pick up again\n");
    await expect(removeRunWorktree(repository, worktree)).rejects.toThrow();
    expect(existsSync(path.join(worktree, "notes.md"))).toBe(true);
    await removeRunWorktree(repository, worktree, { force: true });
    expect(existsSync(worktree)).toBe(false);
    expect(git(repository, "rev-parse", "--verify", "feat/42")).toBeTruthy();
  });

  it("should leave the main checkout's node_modules intact when the dependencies were cloned", async () => {
    await provisionWorktree(repository, worktree, defaults);
    await removeRunWorktree(repository, worktree);
    expect(existsSync(worktree)).toBe(false);
    expect(readFileSync(path.join(repository, "node_modules/left-pad/index.js"), "utf8")).toContain("1");
    expect(readFileSync(path.join(repository, "packages/api/node_modules/dep/index.js"), "utf8")).toContain("2");
  });

  // The removal deletes a tree holding links into the main checkout: it must unlink them, never follow them.
  it("should leave the main checkout's node_modules intact when the dependencies were symlinked", async () => {
    await provisionWorktree(repository, worktree, noClone);
    await removeRunWorktree(repository, worktree);
    expect(existsSync(worktree)).toBe(false);
    expect(readFileSync(path.join(repository, "node_modules/left-pad/index.js"), "utf8")).toContain("1");
    expect(readFileSync(path.join(repository, "packages/api/node_modules/dep/index.js"), "utf8")).toContain("2");
    expect(readFileSync(path.join(repository, ".env"), "utf8")).toBe("SECRET=1\n");
  });

  it("should refuse to remove anything that is not a worktree of a run", async () => {
    await expect(removeRunWorktree(repository, repository, { force: true })).rejects.toThrow(/Worktree path refused/);
    await expect(removeRunWorktree(repository, path.join(repository, "packages"), { force: true })).rejects.toThrow(/Worktree path refused/);
    expect(existsSync(path.join(repository, "app.ts"))).toBe(true);
  });
});

describe("the repository a launch names", () => {
  it("should resolve a linked worktree, or a directory below the root, to the main checkout", async () => {
    await createRunWorktree(repository, worktree);
    await expect(mainCheckout(worktree)).resolves.toBe(repository);
    await expect(mainCheckout(path.join(repository, "packages", "api"))).resolves.toBe(repository);
    await expect(mainCheckout(repository)).resolves.toBe(repository);
  });

  it("should refuse a directory that is not a git repository, in words the form can show", async () => {
    const plain = path.join(root, "plain");
    mkdirSync(plain);
    await expect(mainCheckout(plain)).rejects.toThrow(/is not a git repository/);
  });

  it("should name the branch the checkout is on, and none on a detached HEAD", async () => {
    await expect(currentBranch(repository)).resolves.toBe("main");
    await createRunWorktree(repository, worktree);
    await expect(currentBranch(worktree)).resolves.toBeUndefined();
  });
});
