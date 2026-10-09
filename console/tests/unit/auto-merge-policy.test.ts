import { describe, expect, it } from "@jest/globals";
import { existsSync } from "node:fs";
import path from "node:path";
import { addedLines, autoMergeBlockers, autoMergeDecision, changedFiles, judgeVerdict, PROTECTED_PATHS, recentAutoMerges, type ChangedFile } from "../../server/auto-merge-policy";

const repoRoot = path.resolve(process.cwd(), "..");
const file = (changed: Partial<ChangedFile> & { path: string }): ChangedFile => ({ status: "M", added: 3, removed: 1, ...changed });
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("what keeps a branch from merging without the user", () => {
  it("should let a small change of an agent prompt through", () => {
    expect(autoMergeBlockers([file({ path: "agents/developer.md" })], "")).toEqual([]);
  });

  it("should name every protected file a branch touches", () => {
    const blockers = autoMergeBlockers([file({ path: "hooks/guard.mjs" }), file({ path: "agents/qa-reviewer.md" }), file({ path: "skills/review-change/SKILL.md" })], "");
    expect(blockers).toEqual(["It touches a protected file: hooks/guard.mjs, agents/qa-reviewer.md, skills/review-change/SKILL.md."]);
  });

  it("should hold the reviewers, the loop's own prompts and code, and the CI", () => {
    for (const protectedFile of ["agents/senior-reviewer.md", "agents/designer-reviewer-figma.md", "agents/review-orchestrator.md", "commands/improve.md", "commands/judge-improvement.md", "console/server/auto-merge.ts", "console/server/engine/improvement-judge.ts", ".github/workflows/ci.yml"])
      expect(autoMergeBlockers([file({ path: protectedFile })], "")[0]).toContain(protectedFile);
  });

  it("should hold a file renamed away from a protected path", () => {
    expect(autoMergeBlockers([file({ status: "R", oldPath: "hooks/gate.mjs", path: "hooks/gate-old.mjs" })], "")[0]).toContain("hooks/gate.mjs");
  });

  it("should not read a path that only starts like a protected file as one", () => {
    expect(autoMergeBlockers([file({ path: "hooks/guard.mjs.bak" }), file({ path: "agents/qa-reviewer.md.orig" })], "")).toEqual([]);
  });

  it("should hold a branch that deletes a test file or renames it out of the suite", () => {
    expect(autoMergeBlockers([file({ status: "D", path: "console/tests/unit/hooks.test.ts" })], "")).toEqual(["It removes a test file: console/tests/unit/hooks.test.ts."]);
    expect(autoMergeBlockers([file({ status: "R", oldPath: "console/tests/unit/a.test.ts", path: "console/server/a.ts" })], "")).toEqual(["It removes a test file: console/tests/unit/a.test.ts."]);
  });

  it("should hold a branch that skips or isolates a test", () => {
    const patch = [
      "diff --git a/console/tests/unit/hooks.test.ts b/console/tests/unit/hooks.test.ts",
      "--- a/console/tests/unit/hooks.test.ts",
      "+++ b/console/tests/unit/hooks.test.ts",
      "@@ -1,1 +1,1 @@",
      "-  it(\"should refuse\", () => {",
      "+  it.skip(\"should refuse\", () => {",
    ].join("\n");
    expect(autoMergeBlockers([file({ path: "console/tests/unit/hooks.test.ts" })], patch)).toEqual(["It skips or isolates a test: console/tests/unit/hooks.test.ts."]);
  });

  it("should not count a skip written outside a test file, or removed from one", () => {
    const patch = [
      "+++ b/docs/engineering-workflow.md",
      "+Never write it.skip( in a test.",
      "+++ b/console/tests/unit/a.test.ts",
      "-  it.only(\"x\", () => {",
    ].join("\n");
    expect(autoMergeBlockers([file({ path: "docs/engineering-workflow.md" }), file({ path: "console/tests/unit/a.test.ts" })], patch)).toEqual([]);
  });

  it("should hold a branch over 15 files or 400 lines", () => {
    const many = Array.from({ length: 16 }, (_, index) => file({ path: `agents/a${index}.md`, added: 1, removed: 0 }));
    expect(autoMergeBlockers(many, "")).toEqual(["It changes 16 files, more than 15."]);
    expect(autoMergeBlockers([file({ path: "agents/developer.md", added: 300, removed: 101 })], "")).toEqual(["It changes 401 lines, more than 400."]);
  });

  it("should hold a branch that changes nothing", () => {
    expect(autoMergeBlockers([], "")).toEqual(["The branch changes no file."]);
  });

  it("should list only paths that exist in the repository, so a typo protects nothing silently", () => {
    for (const entry of PROTECTED_PATHS) expect(`${entry}: ${existsSync(path.join(repoRoot, entry))}`).toBe(`${entry}: true`);
  });
});

describe("reading git's view of a branch", () => {
  it("should pair each file with its line counts, renames by their new path", () => {
    const nameStatus = "M\tagents/developer.md\nR087\tdocs/old.md\tdocs/new.md\nD\tconsole/tests/unit/a.test.ts\nA\tcover.webp\n";
    const numstat = "4\t1\tagents/developer.md\n2\t0\tdocs/{old.md => new.md}\n0\t12\tconsole/tests/unit/a.test.ts\n-\t-\tcover.webp\n";
    expect(changedFiles(nameStatus, numstat)).toEqual([
      { status: "M", path: "agents/developer.md", added: 4, removed: 1 },
      { status: "R", path: "docs/new.md", oldPath: "docs/old.md", added: 2, removed: 0 },
      { status: "D", path: "console/tests/unit/a.test.ts", added: 0, removed: 12 },
      // A binary file is read as large, never as empty.
      { status: "A", path: "cover.webp", added: 400, removed: 0 },
    ]);
  });

  it("should give the added lines of each file and nothing of the headers", () => {
    expect(addedLines("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n")).toEqual([{ path: "x", text: "new" }]);
    expect(addedLines("--- a/x\n+++ /dev/null\n-gone\n")).toEqual([]);
  });
});

describe("the judge's verdict", () => {
  it("should read a valid merge or hold", () => {
    expect(judgeVerdict({ decision: "merge", expected: "The pilot reads the report once.", reasons: ["The cause is shown in run 1."] }))
      .toEqual({ verdict: { decision: "merge", expected: "The pilot reads the report once.", reasons: ["The cause is shown in run 1."] } });
  });

  it("should refuse anything outside the contract", () => {
    for (const raw of [null, [], "merge", { decision: "approve", expected: "e", reasons: ["r"] }, { decision: "merge", expected: " ", reasons: ["r"] }, { decision: "merge", expected: "e", reasons: [] }, { decision: "merge", expected: "e", reasons: ["r", 3] }, { decision: "merge", expected: "e", reasons: Array.from({ length: 11 }, () => "r") }])
      expect("error" in judgeVerdict(raw)).toBe(true);
  });
});

describe("the decisions file", () => {
  it("should read a merged line only with its merge commit", () => {
    expect(autoMergeDecision({ worktreeName: "self-improvement-1", at: "2026-10-09T08:00:00.000Z", decision: "merged", reasons: [], mergeCommit: COMMIT })).toBeDefined();
    expect(autoMergeDecision({ worktreeName: "self-improvement-1", at: "2026-10-09T08:00:00.000Z", decision: "merged", reasons: [] })).toBeUndefined();
  });

  it("should drop a line with an unknown decision, a bad date or a name git would not accept", () => {
    expect(autoMergeDecision({ worktreeName: "self-improvement-1", at: "2026-10-09T08:00:00.000Z", decision: "approved", reasons: [] })).toBeUndefined();
    expect(autoMergeDecision({ worktreeName: "self-improvement-1", at: "yesterday", decision: "held", reasons: [] })).toBeUndefined();
    expect(autoMergeDecision({ worktreeName: "../main", at: "2026-10-09T08:00:00.000Z", decision: "held", reasons: [] })).toBeUndefined();
  });

  it("should offer to revert the merges of the last day not reverted since", () => {
    const now = Date.parse("2026-10-09T12:00:00.000Z");
    const merged = (worktreeName: string, at: string) => ({ worktreeName, at, decision: "merged" as const, reasons: [], mergeCommit: COMMIT });
    const decisions = [
      merged("self-improvement-old", "2026-10-08T11:00:00.000Z"),
      merged("self-improvement-a", "2026-10-09T08:00:00.000Z"),
      merged("self-improvement-b", "2026-10-09T09:00:00.000Z"),
      { worktreeName: "self-improvement-b", at: "2026-10-09T10:00:00.000Z", decision: "reverted" as const, reasons: [] },
      merged("self-improvement-c", "2026-10-09T11:00:00.000Z"),
    ];
    expect(recentAutoMerges(decisions, now).map((decision) => decision.worktreeName)).toEqual(["self-improvement-c", "self-improvement-a"]);
  });
});
