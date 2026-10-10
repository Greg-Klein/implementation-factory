import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "@jest/globals";

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "impl-discovery-")));
process.env.IMPL_SEARCH_ROOTS = root;

afterAll(() => rmSync(root, { recursive: true, force: true }));

function git(directory: string, ...args: string[]) {
  return execFileSync("git", ["-C", directory, "-c", "user.email=test@example.com", "-c", "user.name=Test", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

describe("discovering checkouts next to run worktrees", () => {
  // A worktree carries the same remote as its repository: listed, it would be
  // offered as a second checkout of the project, and a run launched on it would
  // nest a worktree inside a worktree.
  it("should list a repository once, never the worktrees of its runs", async () => {
    const checkout = path.join(root, "client", "app");
    mkdirSync(checkout, { recursive: true });
    git(checkout, "init", "-q", "-b", "main");
    git(checkout, "remote", "add", "origin", "https://gitlab.com/group/app.git");
    writeFileSync(path.join(checkout, "app.ts"), "export {};\n");
    git(checkout, "add", ".");
    git(checkout, "commit", "-q", "-m", "init");
    const { createRunWorktree } = await import("../../server/worktree");
    const { runWorktreePath } = await import("../../server/domain");
    await createRunWorktree(checkout, runWorktreePath(checkout, "run-1"));
    await createRunWorktree(checkout, runWorktreePath(checkout, "run-2"));

    const { discoverRepositories, detectProjectDirectory } = await import("../../server/repository");
    const repositories = await discoverRepositories();
    expect(repositories).toEqual([{ project: "group/app", identity: { forge: "gitlab", hostname: "gitlab.com", project: "group/app" }, path: checkout, resolvedPath: checkout, exists: true }]);
    await expect(detectProjectDirectory("https://gitlab.com/group/app/-/issues/4", repositories)).resolves.toMatchObject({ path: checkout });
  });
});
