import { describe, expect, it } from "@jest/globals";
import { isImprovementWorktreeName } from "../../server/domain";

describe("the name of a self-improvement worktree", () => {
  it("should accept the names the improvement loop gives its worktrees", () => {
    expect(isImprovementWorktreeName("self-improvement-abc123")).toBe(true);
    expect(isImprovementWorktreeName("demo-a1b2c3d4")).toBe(true);
    expect(isImprovementWorktreeName("SELF-IMPROVEMENT-UPPER")).toBe(true);
  });

  it("should refuse an empty name and anything that is not a text", () => {
    expect(isImprovementWorktreeName("")).toBe(false);
    expect(isImprovementWorktreeName(undefined)).toBe(false);
    expect(isImprovementWorktreeName(["self-improvement-abc123"])).toBe(false);
  });

  it("should refuse a path, a space or a shell character", () => {
    expect(isImprovementWorktreeName("../secret")).toBe(false);
    expect(isImprovementWorktreeName("foo/bar")).toBe(false);
    expect(isImprovementWorktreeName("foo bar")).toBe(false);
    expect(isImprovementWorktreeName("; rm -rf /")).toBe(false);
    expect(isImprovementWorktreeName("name\n--upload-pack=x")).toBe(false);
  });
});
