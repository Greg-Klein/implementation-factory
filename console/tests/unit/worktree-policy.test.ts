import { describe, expect, it } from "@jest/globals";
import { dependencyDrift, excludeLine, isRunWorktreePath, lockedPackages, listSetting, relativeHooksPath, runWorktreePath, withExcludeLines, worktreeKeptDetail, worktreeProvisioning, worktreeRemoval } from "../../server/domain";
import type { RunState, WorkflowState } from "../../server/types";
import { overridden, type Overrides } from "./overrides";

type Run = Pick<RunState, "status" | "sessionActive" | "mergeRequestUrl" | "workflow" | "archiveSyncedAt">;

const MR = "https://gitlab.com/acme/app/-/merge_requests/12";
const workflow = (overrides: Partial<WorkflowState> = {}): WorkflowState => ({ schemaVersion: 1, revision: 4, state: "completed", result: { delivery: "merge_request", mergeRequestUrl: MR, blockers: [] }, receivedAt: "2026-10-03T10:00:00.000Z", ...overrides });
/** A run that delivered: finished, its merge request open, its evidence archived, its session gone. */
const delivered = (overrides: Overrides<Run> = {}) => overridden<Run>({ status: "completed", sessionActive: false, mergeRequestUrl: MR, workflow: workflow(), archiveSyncedAt: "2026-10-03T10:01:00.000Z" }, overrides);
const safe = { exists: true, clean: true, pushed: true };

describe("where the worktree of a run lives", () => {
  it("should sit inside the repository, under the directory the factory ignores, named after the run", () => {
    expect(runWorktreePath("/work/repo", "2026-10-03T08-00-00-000Z-abcd1234")).toBe("/work/repo/.claude/worktrees/2026-10-03T08-00-00-000Z-abcd1234");
  });

  it("should recognise only a direct child of that directory as removable", () => {
    expect(isRunWorktreePath("/work/repo", "/work/repo/.claude/worktrees/run-1")).toBe(true);
    expect(isRunWorktreePath("/work/repo", "/work/repo/.claude/worktrees")).toBe(false);
    expect(isRunWorktreePath("/work/repo", "/work/repo/.claude/worktrees/run-1/src")).toBe(false);
    expect(isRunWorktreePath("/work/repo", "/work/repo/.claude/worktrees/../../other")).toBe(false);
    expect(isRunWorktreePath("/work/repo", "/work/repo")).toBe(false);
    expect(isRunWorktreePath("/work/repo", "/work/other/.claude/worktrees/run-1")).toBe(false);
  });
});

describe("whether the console removes a worktree on its own", () => {
  it("should remove it once the run delivered and nothing would be lost", () => {
    expect(worktreeRemoval(delivered(), safe)).toEqual({ allowed: true, automatic: true, reasons: [], risks: [] });
  });

  it("should keep it while the session is still open, merge request or not", () => {
    const decision = worktreeRemoval(delivered({ sessionActive: true }), safe);
    expect(decision.allowed).toBe(false);
    expect(decision.automatic).toBe(false);
  });

  it("should keep it when the run opened no merge request", () => {
    expect(worktreeRemoval(delivered({ status: "stopped", mergeRequestUrl: undefined, workflow: undefined }), safe)).toMatchObject({ allowed: true, automatic: false, reasons: ["no merge request"], risks: [] });
    expect(worktreeRemoval(delivered({ status: "failed", mergeRequestUrl: undefined }), safe).automatic).toBe(false);
    expect(worktreeRemoval({ ...delivered({ status: "stopped", mergeRequestUrl: undefined, workflow: undefined }), issueUrl: "https://github.com/acme/shop/issues/7" }, safe).reasons).toEqual(["no pull request"]);
  });

  it("should keep it when the merge request is a draft on a blocked run", () => {
    const draft = worktreeRemoval(delivered({ workflow: workflow({ result: { delivery: "draft_merge_request", mergeRequestUrl: MR, blockers: ["QA"] } }) }), safe);
    expect(draft).toMatchObject({ automatic: false, reasons: ["draft merge request on a blocked run"] });
    expect(worktreeRemoval(delivered({ workflow: workflow({ state: "blocked" }) }), safe).automatic).toBe(false);
  });

  it("should keep it when a run with a merge request did not finish", () => {
    expect(worktreeRemoval(delivered({ status: "failed" }), safe)).toMatchObject({ automatic: false, reasons: ["run not finished"] });
  });

  it("should wait for the archive of the evidence to be confirmed", () => {
    expect(worktreeRemoval(delivered({ archiveSyncedAt: undefined }), safe)).toMatchObject({ automatic: false, reasons: ["evidence archive not confirmed"] });
  });

  it("should keep it when the tree is dirty or its commits are not on the remote, and name what a removal would lose", () => {
    expect(worktreeRemoval(delivered(), { exists: true, clean: false, pushed: true })).toMatchObject({ automatic: false, risks: ["uncommitted changes"] });
    expect(worktreeRemoval(delivered(), { exists: true, clean: true, pushed: false })).toMatchObject({ automatic: false, risks: ["unpushed changes"] });
    expect(worktreeRemoval(delivered(), { exists: true, clean: false, pushed: false }).risks).toEqual(["uncommitted changes", "unpushed changes"]);
  });

  it("should ask no confirmation for a kept worktree that holds nothing to lose", () => {
    expect(worktreeRemoval(delivered({ status: "stopped", mergeRequestUrl: undefined }), safe).risks).toEqual([]);
  });

  it("should never remove a directory that is not there", () => {
    expect(worktreeRemoval(delivered(), { exists: false, clean: true, pushed: true }).automatic).toBe(false);
  });

  it("should say in one line why a worktree is kept", () => {
    expect(worktreeKeptDetail(["unpushed changes"])).toBe("Worktree kept: unpushed changes");
    expect(worktreeKeptDetail(["no merge request", "uncommitted changes"])).toBe("Worktree kept: no merge request, uncommitted changes");
    expect(worktreeKeptDetail([])).toBe("Worktree kept");
  });
});

describe("what a worktree takes from the ignored files of the checkout", () => {
  const ignored = ["node_modules/", "packages/api/node_modules/", ".env", "apps/web/.env.local", "dist/", ".next/", "coverage/lcov.info", ".claude/worktrees/", "notes.env.bak"];

  it("should take dependency directories by name at any depth, and files by name pattern", () => {
    expect(worktreeProvisioning(ignored, ["node_modules"], [".env*"])).toEqual({ directories: ["node_modules", "packages/api/node_modules"], files: [".env", "apps/web/.env.local"], paths: [], hooks: [] });
  });

  it("should never take a build output nobody listed", () => {
    const plan = worktreeProvisioning(ignored, ["node_modules"], [".env*"]);
    expect(plan.directories).not.toContain("dist");
    expect(plan.directories).not.toContain(".next");
  });

  it("should take a copy pattern holding a slash as a path from the root, ignored or not", () => {
    expect(worktreeProvisioning([], ["node_modules"], [".env*", ".claude/settings.local.json"]).paths).toEqual([".claude/settings.local.json"]);
    expect(worktreeProvisioning([], [], ["../outside/secret", "/config/local.json"]).paths).toEqual(["config/local.json"]);
  });

  it("should never take anything from the worktrees of other runs", () => {
    const plan = worktreeProvisioning([".claude/worktrees/run-1/node_modules/", ".claude/worktrees/run-1/.env", ".claude/", ".claude/worktrees/"], ["node_modules", ".claude", "worktrees"], [".env*"]);
    expect(plan).toEqual({ directories: [], files: [], paths: [], hooks: [] });
  });

  it("should take the ignored entries at or under the hooks path, and nothing else for them", () => {
    const withHooks = [...ignored, ".husky/_/", "tools/hooks/local.sh", "huskyish/"];
    expect(worktreeProvisioning(withHooks, ["node_modules"], [".env*"], "./.husky/").hooks).toEqual([".husky/_"]);
    expect(worktreeProvisioning(withHooks, ["node_modules"], [".env*"], ".husky/_").hooks).toEqual([".husky/_"]);
    expect(worktreeProvisioning(withHooks, ["node_modules"], [".env*"], "tools/hooks").hooks).toEqual(["tools/hooks/local.sh"]);
    expect(worktreeProvisioning(withHooks, ["node_modules"], [".env*"]).hooks).toEqual([]);
  });

  it("should read no hooks path that is absolute, empty or outside the repository", () => {
    expect(relativeHooksPath("/usr/share/git-hooks")).toBeUndefined();
    expect(relativeHooksPath("~/.githooks")).toBeUndefined();
    expect(relativeHooksPath("../shared/hooks")).toBeUndefined();
    expect(relativeHooksPath(" ./ ")).toBeUndefined();
    expect(relativeHooksPath(".husky/")).toBe(".husky");
  });

  it("should not take a file for a directory, nor a directory for a file", () => {
    expect(worktreeProvisioning(["node_modules", ".env/"], ["node_modules"], [".env*"])).toEqual({ directories: [], files: [], paths: [], hooks: [] });
  });
});

describe("what a package-lock.json pins at the top of node_modules", () => {
  const lockfile = {
    lockfileVersion: 3,
    packages: {
      "": { name: "app", dependencies: { "left-pad": "^1.0.0" } },
      "node_modules/left-pad": { version: "1.3.0" },
      "node_modules/@scope/kit": { version: "2.0.0", dev: true },
      "node_modules/kit/node_modules/inner": { version: "0.1.0" },
      "node_modules/fsevents": { version: "2.3.3", optional: true },
      "node_modules/sometimes": { version: "1.0.0", devOptional: true },
      "node_modules/local": { resolved: "packages/local", link: true },
      "packages/local": { version: "0.0.1" },
    },
  };

  it("should list the top-level packages with their version, scoped ones included", () => {
    expect(lockedPackages(lockfile)).toEqual([{ name: "left-pad", version: "1.3.0" }, { name: "@scope/kit", version: "2.0.0" }]);
  });

  it("should not judge a file npm 7 or later did not write", () => {
    expect(lockedPackages({ lockfileVersion: 1, dependencies: { "left-pad": { version: "1.3.0" } } })).toBeUndefined();
    expect(lockedPackages(["node_modules/left-pad"])).toBeUndefined();
    expect(lockedPackages(null)).toBeUndefined();
  });

  it("should report a package missing or installed at another version, and nothing for one that matches", () => {
    const locked = lockedPackages(lockfile) ?? [];
    expect(dependencyDrift(locked, ["1.3.0", "2.0.0"])).toEqual([]);
    expect(dependencyDrift(locked, ["1.2.0", undefined])).toEqual([
      { name: "left-pad", version: "1.3.0", installed: "1.2.0" },
      { name: "@scope/kit", version: "2.0.0", installed: undefined },
    ]);
  });
});

describe("the lines written to .git/info/exclude", () => {
  it("should anchor a path at the root and take its glob characters literally", () => {
    expect(excludeLine("packages/api/node_modules")).toBe("/packages/api/node_modules");
    expect(excludeLine(".claude/worktrees", { directory: true })).toBe("/.claude/worktrees/");
    expect(excludeLine("apps/[web]/node_modules")).toBe("/apps/\\[web\\]/node_modules");
  });

  it("should append only what is missing, and nothing when it is all there", () => {
    expect(withExcludeLines("# git ls-files --others\n", ["/node_modules", "/node_modules"])).toBe("# git ls-files --others\n/node_modules\n");
    expect(withExcludeLines("*.log", ["/node_modules"])).toBe("*.log\n/node_modules\n");
    expect(withExcludeLines("", ["/a", "/b"])).toBe("/a\n/b\n");
    expect(withExcludeLines("/a\n/b\n", ["/b", "/a"])).toBeUndefined();
  });
});

describe("the worktree settings", () => {
  it("should read a comma-separated list and fall back on the defaults when it is empty", () => {
    expect(listSetting("node_modules, vendor ,", ["node_modules"])).toEqual(["node_modules", "vendor"]);
    expect(listSetting(undefined, ["node_modules"])).toEqual(["node_modules"]);
    expect(listSetting(" , ", [".env*"])).toEqual([".env*"]);
  });
});
