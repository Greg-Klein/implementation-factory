import { describe, expect, it } from "@jest/globals";
import {
  FINDING_CATEGORIES, type FindingFixDraft, type KeptFinding, appendFindingFix, draftFindingFix, findingFixMarker, findingFixRunThreshold, findingFixStore, instructionTarget, lintRulesFor, lintStack, mergeFindingFixes, readFindingFixes, reviewFindingsStore, sourceFixGroups,
} from "../../server/domain";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-05T12:00:00Z");

const kept = (runId: string, category: string, daysAgo = 1, extra: Partial<KeptFinding> = {}): KeptFinding => ({
  id: `SR-R1-${runId}`, runId, ticket: `https://github.com/acme/shop/issues/${runId}`,
  at: new Date(NOW - daysAgo * DAY).toISOString(), category, severity: "P1", summary: `${category} on ${runId}`, fixed: false, ...extra,
});

describe("when a habit becomes a source fix", () => {
  it("should keep the proposals beside the findings of the repository", () => {
    expect(pathDir(findingFixStore("/data", "/work/shop"))).toBe(pathDir(reviewFindingsStore("/data", "/work/shop")));
  });

  it("should read the configured threshold only when it is an integer from 2 to 20", () => {
    expect(findingFixRunThreshold(undefined)).toBe(3);
    expect(findingFixRunThreshold("3")).toBe(3);
    expect(findingFixRunThreshold("2")).toBe(2);
    expect(findingFixRunThreshold("20")).toBe(20);
    expect(findingFixRunThreshold("1")).toBe(3);
    expect(findingFixRunThreshold("21")).toBe(3);
    expect(findingFixRunThreshold("3.5")).toBe(3);
    expect(findingFixRunThreshold("")).toBe(3);
  });

  it("should count distinct runs, not rounds of one run, and never other", () => {
    const rounds = [1, 2, 3].map((round) => kept("same", "test-gap", round, { id: `SR-R${round}-1` }));
    expect(sourceFixGroups(rounds, NOW, 3)).toEqual([]);
    const runs = [kept("a", "test-gap", 3), kept("b", "test-gap", 2), kept("c", "test-gap", 1), kept("d", "other", 1)];
    expect(sourceFixGroups(runs, NOW, 3).map(({ category, runs: count }) => `${category} ${count}`)).toEqual(["test-gap 3"]);
    expect(sourceFixGroups(runs, NOW, 4)).toEqual([]);
    expect(sourceFixGroups([kept("a", "edge-case", 1), kept("b", "edge-case", 91)], NOW, 2)).toEqual([]);
  });
});

describe("the block a person can accept", () => {
  it("should name ESLint when that config is present and Biome only when it is the one configured", () => {
    const both = JSON.stringify({ devDependencies: { eslint: "9", "@biomejs/biome": "1" } });
    expect(lintStack(both, ["eslint.config.js", "biome.json"]).tool).toBe("eslint");
    expect(lintStack(both, ["biome.json"]).tool).toBe("biome");
    expect(lintStack(both, []).tool).toBe("eslint");
    expect(lintStack(JSON.stringify({ devDependencies: { "@biomejs/biome": "1" } }), []).tool).toBe("biome");
    expect(lintStack("{", []).tool).toBeUndefined();
  });

  it("should name rules only when the plugin that owns them is installed", () => {
    expect(lintRulesFor("type-escape", { tool: "eslint", packages: ["eslint"] })).toBeUndefined();
    expect(lintRulesFor("type-escape", { tool: "eslint", packages: ["eslint", "typescript-eslint"] })?.rules).toEqual(["@typescript-eslint/no-explicit-any", "@typescript-eslint/no-non-null-assertion"]);
    expect(lintRulesFor("dead-code", { tool: "eslint", packages: ["eslint"] })?.rules).toEqual(["no-unused-vars"]);
    expect(lintRulesFor("dead-code", { tool: "eslint", packages: ["eslint", "@typescript-eslint/eslint-plugin"] })?.rules).toEqual(["@typescript-eslint/no-unused-vars"]);
    expect(lintRulesFor("accessibility", { tool: "eslint", packages: ["eslint"] })).toBeUndefined();
    expect(lintRulesFor("accessibility", { tool: "eslint", packages: ["eslint", "eslint-plugin-jsx-a11y"] })?.rules).toContain("jsx-a11y/alt-text");
    expect(lintRulesFor("type-escape", { tool: "biome", packages: ["@biomejs/biome"] })?.rules).toContain("suspicious/noExplicitAny");
    expect(lintRulesFor("edge-case", { tool: "eslint", packages: ["eslint"] })).toBeUndefined();
  });

  it("should append to the review guide, then AGENTS.md, then CLAUDE.md, else a new REVIEW.md", () => {
    expect(instructionTarget(["AGENTS.md", "docs/REVIEW.md"])).toBe("docs/REVIEW.md");
    expect(instructionTarget(["CLAUDE.md", "AGENTS.md"])).toBe("AGENTS.md");
    expect(instructionTarget(["CLAUDE.md"])).toBe("CLAUDE.md");
    expect(instructionTarget([])).toBe("REVIEW.md");
  });

  it("should write the habit in the workflow language and keep the title in English", () => {
    const group = sourceFixGroups([kept("a", "type-escape"), kept("b", "type-escape"), kept("c", "type-escape", 2, { file: "src/a.ts" })], NOW, 3)[0]!;
    const stack = { tool: "eslint" as const, packages: ["eslint", "typescript-eslint"] };
    const english = draftFindingFix(group, { language: "en", stack, existingFiles: ["AGENTS.md"] });
    expect(english.kind).toBe("lint");
    expect(english.title).toBe("Block type-escape with ESLint");
    expect(english.body).toContain("## Review habit: type-escape");
    expect(english.body).toContain("`@typescript-eslint/no-explicit-any`");
    expect(english.body).toContain(findingFixMarker("type-escape"));
    expect(english.body).toContain("<!-- /implementation-factory:finding-fix type-escape -->");
    const french = draftFindingFix(group, { language: "fr", stack: { packages: [] }, existingFiles: ["AGENTS.md"] });
    expect(french.kind).toBe("instruction");
    expect(french.title).toBe("Record type-escape in AGENTS.md");
    expect(french.body).toContain("## Habitude de revue: type-escape");
    expect(french.body).toContain("3 exécutions");
    for (const category of Object.keys(FINDING_CATEGORIES)) {
      if (category === "other") continue;
      const drafted = draftFindingFix({ category, label: FINDING_CATEGORIES[category]!, runs: 3, findings: 3, examples: [kept("a", category)] }, { language: "en", stack: { packages: [] }, existingFiles: [] });
      expect(drafted.body).toContain(findingFixMarker(category));
      expect(drafted.targetFile).toBe("REVIEW.md");
    }
  });

  it("should append the block once", () => {
    expect(appendFindingFix("", "block\n", "test-gap")).toEqual({ text: "block\n", applied: true });
    expect(appendFindingFix("# A\n", "block\n", "test-gap").text).toBe("# A\n\nblock\n");
    const marked = `${findingFixMarker("test-gap")}\n`;
    expect(appendFindingFix(marked, "block\n", "test-gap")).toEqual({ text: marked, applied: false });
  });
});

describe("the proposals kept on disk", () => {
  const body = `${findingFixMarker("test-gap")}\n\n## Review habit: test-gap\n\nHold it.\n\n<!-- /implementation-factory:finding-fix test-gap -->\n`;
  const valid = {
    category: "test-gap", label: "A changed behaviour left without a test", runs: 3, findings: 4, kind: "instruction",
    targetFile: "AGENTS.md", title: "Record test-gap in AGENTS.md", body, status: "pending", proposedAt: "2026-10-01T00:00:00.000Z",
    examples: [{ severity: "P1", file: "src/a.ts", summary: "No test." }],
  };

  it("should drop an entry that cannot be applied safely", () => {
    expect(readFindingFixes("not json")).toBeUndefined();
    expect(readFindingFixes("{\"proposals\":\"no\"}")).toBeUndefined();
    const read = readFindingFixes(JSON.stringify({ proposals: [
      valid,
      { ...valid, category: "other" },
      { ...valid, category: "dead-code", targetFile: "../secret" },
      { ...valid, body: "no marker" },
      { ...valid, category: "edge-case" },
    ] }));
    expect(read?.map(({ category }) => category)).toEqual(["test-gap"]);
  });

  it("should refresh a pending proposal, keep a decision, and drop a pending one that no longer qualifies", () => {
    const draft = (text: string, category = "test-gap"): FindingFixDraft => ({
      category, label: "l", runs: 3, findings: 3, kind: "instruction", targetFile: "AGENTS.md", title: "t", body: text, examples: [],
    });
    const created = mergeFindingFixes([], [draft("one")], "2026-10-01T00:00:00.000Z");
    expect(created.added).toHaveLength(1);
    expect(created.proposals[0]).toMatchObject({ status: "pending", proposedAt: "2026-10-01T00:00:00.000Z" });
    const refreshed = mergeFindingFixes(created.proposals, [draft("two")], "2026-10-02T00:00:00.000Z");
    expect(refreshed.added).toEqual([]);
    expect(refreshed.proposals[0]).toMatchObject({ body: "two", proposedAt: "2026-10-01T00:00:00.000Z" });
    const dismissed = created.proposals.map((proposal) => ({ ...proposal, status: "dismissed" as const }));
    expect(mergeFindingFixes(dismissed, [draft("three")], "2026-10-03T00:00:00.000Z").proposals[0]).toMatchObject({ status: "dismissed", body: "one" });
    expect(mergeFindingFixes(created.proposals, [], "2026-10-04T00:00:00.000Z").proposals).toEqual([]);
    expect(mergeFindingFixes(dismissed, [], "2026-10-04T00:00:00.000Z").proposals).toHaveLength(1);
  });
});

function pathDir(file: string) {
  return file.slice(0, file.lastIndexOf("/"));
}
