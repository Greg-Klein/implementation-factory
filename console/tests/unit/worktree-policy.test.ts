import { describe, expect, it } from "@jest/globals";
import { excludeLine, isRunWorktreePath, listSetting, runWorktreePath, withExcludeLines, worktreeKeptDetail, worktreeProvisioning, worktreeRemoval } from "../../server/domain";
import type { RunState, WorkflowState } from "../../server/types";

type Run = Pick<RunState, "status" | "sessionActive" | "mergeRequestUrl" | "workflow" | "archiveSyncedAt">;

const MR = "https://gitlab.com/acme/app/-/merge_requests/12";
const workflow = (overrides: Partial<WorkflowState> = {}): WorkflowState => ({ schemaVersion: 1, revision: 4, state: "completed", result: { delivery: "merge_request", mergeRequestUrl: MR, blockers: [] }, receivedAt: "2026-10-03T10:00:00.000Z", ...overrides });
/** A run that delivered: finished, its merge request open, its evidence archived, its session gone. */
const delivered = (overrides: Partial<Run> = {}): Run => ({ status: "completed", sessionActive: false, mergeRequestUrl: MR, workflow: workflow(), archiveSyncedAt: "2026-10-03T10:01:00.000Z", ...overrides });
const safe = { exists: true, clean: true, pushed: true };

describe("where the worktree of a run lives", () => {
  it("should sit inside the repository, under the directory the harness ignores, named after the run", () => {
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
    expect(worktreeRemoval(delivered({ status: "stopped", mergeRequestUrl: undefined, workflow: undefined }), safe)).toMatchObject({ allowed: true, automatic: false, reasons: ["aucune merge request"], risks: [] });
    expect(worktreeRemoval(delivered({ status: "failed", mergeRequestUrl: undefined }), safe).automatic).toBe(false);
  });

  it("should keep it when the merge request is a draft on a blocked run", () => {
    const draft = worktreeRemoval(delivered({ workflow: workflow({ result: { delivery: "draft_merge_request", mergeRequestUrl: MR, blockers: ["QA"] } }) }), safe);
    expect(draft).toMatchObject({ automatic: false, reasons: ["merge request en brouillon sur un run bloqué"] });
    expect(worktreeRemoval(delivered({ workflow: workflow({ state: "blocked" }) }), safe).automatic).toBe(false);
  });

  it("should keep it when a run with a merge request did not finish", () => {
    expect(worktreeRemoval(delivered({ status: "failed" }), safe)).toMatchObject({ automatic: false, reasons: ["run non terminé"] });
  });

  it("should wait for the archive of the evidence to be confirmed", () => {
    expect(worktreeRemoval(delivered({ archiveSyncedAt: undefined }), safe)).toMatchObject({ automatic: false, reasons: ["archive des preuves non confirmée"] });
  });

  it("should keep it when the tree is dirty or its commits are not on the remote, and name what a removal would lose", () => {
    expect(worktreeRemoval(delivered(), { exists: true, clean: false, pushed: true })).toMatchObject({ automatic: false, risks: ["changements non commités"] });
    expect(worktreeRemoval(delivered(), { exists: true, clean: true, pushed: false })).toMatchObject({ automatic: false, risks: ["changements non poussés"] });
    expect(worktreeRemoval(delivered(), { exists: true, clean: false, pushed: false }).risks).toEqual(["changements non commités", "changements non poussés"]);
  });

  it("should ask no confirmation for a kept worktree that holds nothing to lose", () => {
    expect(worktreeRemoval(delivered({ status: "stopped", mergeRequestUrl: undefined }), safe).risks).toEqual([]);
  });

  it("should never remove a directory that is not there", () => {
    expect(worktreeRemoval(delivered(), { exists: false, clean: true, pushed: true }).automatic).toBe(false);
  });

  it("should say in one line why a worktree is kept", () => {
    expect(worktreeKeptDetail(["changements non poussés"])).toBe("Worktree conservé : changements non poussés");
    expect(worktreeKeptDetail(["aucune merge request", "changements non commités"])).toBe("Worktree conservé : aucune merge request, changements non commités");
    expect(worktreeKeptDetail([])).toBe("Worktree conservé");
  });
});

describe("what a worktree takes from the ignored files of the checkout", () => {
  const ignored = ["node_modules/", "packages/api/node_modules/", ".env", "apps/web/.env.local", "dist/", ".next/", "coverage/lcov.info", ".claude/worktrees/", "notes.env.bak"];

  it("should take dependency directories by name at any depth, and files by name pattern", () => {
    expect(worktreeProvisioning(ignored, ["node_modules"], [".env*"])).toEqual({ directories: ["node_modules", "packages/api/node_modules"], files: [".env", "apps/web/.env.local"], paths: [] });
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
    expect(plan).toEqual({ directories: [], files: [], paths: [] });
  });

  it("should not take a file for a directory, nor a directory for a file", () => {
    expect(worktreeProvisioning(["node_modules", ".env/"], ["node_modules"], [".env*"])).toEqual({ directories: [], files: [], paths: [] });
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
