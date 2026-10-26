import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  REVIEW_GUIDE_CANDIDATES, globPathMatches, guideIgnoresFile, pathIsRunWorktree, renderReviewGuide, reviewGuideIgnoredPaths, reviewGuidePath, reviewGuideSource,
} from "../../server/domain";

const root = path.resolve(process.cwd(), "..");

describe("where a repository's review guide lives", () => {
  it("should list the same candidates as the contract, root first", () => {
    const contract = readFileSync(path.join(root, "contracts", "review-guide.md"), "utf8");
    const listed = [...contract.matchAll(/^\d+\. `([^`]+)`/gm)].map((match) => match[1]);
    expect(listed).toEqual([...REVIEW_GUIDE_CANDIDATES]);
    expect(reviewGuidePath(["docs/REVIEW.md", "REVIEW.md", ".claude/REVIEW.md"])).toBe("REVIEW.md");
    expect(reviewGuidePath(["./docs/REVIEW.md"])).toBe("docs/REVIEW.md");
    expect(reviewGuidePath([])).toBeUndefined();
  });

  it("should name the copied file and cut a dumped one off", () => {
    expect(renderReviewGuide("REVIEW.md", "# Priorities\n")).toBe("<!-- source: REVIEW.md -->\n# Priorities\n");
    const dumped = renderReviewGuide(".claude/REVIEW.md", "x".repeat(32_001));
    expect(dumped.startsWith("<!-- source: .claude/REVIEW.md -->\n")).toBe(true);
    expect(dumped).toContain("[truncated]");
    expect(dumped.length).toBeLessThan(32_100);
    expect(reviewGuideSource(dumped)).toBe(".claude/REVIEW.md");
    expect(reviewGuideSource("<!-- source: README.md -->\n")).toBeUndefined();
  });

  it("should read ignored paths until the next heading", () => {
    const markdown = [
      "## Priorities",
      "- src/**",
      "## Chemins ignorés",
      "- `generated/**` build output",
      "- locales/**/*.json",
      "## Limite des détails",
      "- no nits",
    ].join("\n");
    expect(reviewGuideIgnoredPaths(markdown)).toEqual(["generated/**", "locales/**/*.json"]);
  });

  it("should match a glob from the repository root, and a bare name at any depth", () => {
    expect(globPathMatches("generated/**", "generated/out.ts")).toBe(true);
    expect(globPathMatches("generated/**", "src/generated/out.ts")).toBe(false);
    expect(globPathMatches("locales/**/*.json", "locales/fr/common.json")).toBe(true);
    expect(globPathMatches("**/*.generated.ts", "src/a.generated.ts")).toBe(true);
    expect(globPathMatches("translations", "pkg/translations")).toBe(true);
    expect(globPathMatches("translations", "pkg/translations/en.json")).toBe(false);
    expect(guideIgnoresFile("generated/out.ts", ["generated/**"])).toBe(true);
    expect(guideIgnoresFile(undefined, ["generated/**"])).toBe(false);
    expect(guideIgnoresFile("../secret", ["**"])).toBe(false);
  });

  it("should tell a run worktree from the checkout", () => {
    expect(pathIsRunWorktree("/repo/.claude/worktrees/run-1")).toBe(true);
    expect(pathIsRunWorktree("/repo/.claude/worktrees")).toBe(false);
    expect(pathIsRunWorktree("/repo/worktrees/run-1")).toBe(false);
    expect(pathIsRunWorktree("/repo/.claude/tasks")).toBe(false);
  });
});

describe("who is told to apply the review guide", () => {
  const files = [
    "agents/senior-reviewer.md",
    "agents/qa-reviewer.md",
    "agents/designer-reviewer-figma.md",
    "agents/review-orchestrator.md",
    "commands/implement.md",
    "skills/review-change/references/code-review.md",
    "skills/figma-review/SKILL.md",
  ];

  it("should point the reviewers at the task copy and leave the developer out", () => {
    for (const file of files) expect(readFileSync(path.join(root, file), "utf8")).toContain("review-guide");
    const pilot = readFileSync(path.join(root, "commands", "implement.md"), "utf8");
    expect(pilot).toContain("IMPL_REVIEW_GUIDE");
    expect(pilot).toContain("to no `developer`");
    const designer = readFileSync(path.join(root, "agents", "designer-reviewer-figma.md"), "utf8");
    expect(designer).toContain("`review-guide.md`");
    expect(readFileSync(path.join(root, "contracts", "review-summary.md"), "utf8")).toContain("## Guide de revue");
    expect(readFileSync(path.join(root, "contracts", "language.md"), "utf8")).toContain("`## Review guide`");
  });
});
