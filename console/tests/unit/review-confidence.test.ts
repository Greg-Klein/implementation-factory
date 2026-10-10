import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";

import { defined } from "../../lib/defined";
import { acceptanceText } from "../../server/acceptance-text";
import { changedFiles } from "../../server/auto-merge-policy";
import { emptyState } from "../../server/domain";
import {
  changeAfterReading, type ChangeFacts, changeFacts, changeReadingKey, CONFIDENCE_DETAILS, CONFIDENCE_MAXIMUM, CONFIDENCE_RULES, confidenceAtDelivery, type ConfidenceInput, confidenceKey, gateFacts, pathMatches, reviewConfidence,
} from "../../server/review-confidence";
import type { AcceptanceDigest, AgentState, RunIncident } from "../../server/types";

const counts = (over: Partial<AcceptanceDigest["counts"]> = {}) => ({ total: 3, verified: 3, failed: 0, blocked: 0, unverified: 0, stale: 0, ...over });
const acceptance = (over: Partial<AcceptanceDigest> = {}): AcceptanceDigest => ({
  available: true, revision: 1, updatedAt: "2026-10-10T10:00:00.000Z", counts: counts(), diagnostics: 0, qa: { status: "PASS", consistent: true, unobserved: 0 }, ...over,
});
const change = (over: Partial<ChangeFacts> = {}): ChangeFacts => ({ files: 3, lines: 80, sensitive: [], removedTests: [], codeChanged: true, testChanged: true, ...over });

/** A run whose review left nothing to hold against it: every test moves one fact away from it. */
const reviewed = (over: Omit<Partial<ConfidenceInput>, "state"> & { state?: Partial<ConfidenceInput["state"]> } = {}): ConfidenceInput => ({
  acceptance: acceptance(), findings: [], gate: { failed: 0, unchecked: 0 }, change: change(), ...over,
  state: { ...emptyState(), status: "running", artifacts: ["senior-review.md", "qa-report.md"], ...over.state },
});

const rules = (input: ConfidenceInput) => reviewConfidence(input)?.reasons.map((reason) => reason.rule);
const score = (input: ConfidenceInput) => reviewConfidence(input)?.score;

describe("the review confidence of a run", () => {
  it("should give no note before a reviewer wrote its report", () => {
    expect(reviewConfidence(reviewed({ state: { artifacts: ["developer-report.md", "qa-plan.md"] } }))).toBeUndefined();
  });

  it("should give the highest note when nothing observed stands against the review", () => {
    expect(reviewConfidence(reviewed())).toEqual({ score: CONFIDENCE_MAXIMUM, reasons: [] });
  });

  it("should hold the note at zero on a failed run, a blocked workflow or a draft", () => {
    const completed = { schemaVersion: 1 as const, revision: 3, receivedAt: "2026-10-10T10:00:00.000Z", state: "completed" as const };
    const failed = reviewed({ state: { status: "failed" } });
    const blocked = reviewed({ state: { workflow: { ...completed, result: { delivery: "merge_request", blockers: ["P0 still open"] } } } });
    const draft = reviewed({ state: { workflow: { ...completed, result: { delivery: "draft_merge_request", blockers: [] } } } });
    expect([rules(failed), rules(blocked), rules(draft)]).toEqual([["run_failed"], ["workflow_blocked"], ["draft_delivery"]]);
    expect([score(failed), score(blocked), score(draft)]).toEqual([0, 0, 0]);
  });

  it("should hold the note at zero on a failed criterion and at one on a blocked one", () => {
    const failed = reviewed({ acceptance: acceptance({ counts: counts({ verified: 2, failed: 1 }) }) });
    const blocked = reviewed({ acceptance: acceptance({ counts: counts({ verified: 2, blocked: 1 }) }) });
    expect([rules(failed), score(failed)]).toEqual([["criterion_failed"], 0]);
    expect([rules(blocked), score(blocked)]).toEqual([["criterion_blocked"], 1]);
  });

  it("should take one point per unverified criterion, three at most", () => {
    const unverified = (n: number) => reviewed({ acceptance: acceptance({ counts: counts({ total: 6, verified: 6 - n, unverified: n }) }) });
    expect([score(unverified(1)), score(unverified(2)), score(unverified(5))]).toEqual([4, 3, 2]);
    expect(reviewConfidence(unverified(5))?.reasons).toEqual([{ rule: "criterion_unverified", minus: 3, count: 5, detail: "5 acceptance criteria unverified." }]);
  });

  it("should read a QA verdict that does not approve as a refusal, whatever the criteria say", () => {
    for (const status of ["FAIL", "INCONCLUSIVE", "APPROVED"]) {
      const input = reviewed({ acceptance: acceptance({ qa: { status, consistent: true, unobserved: 0 } }) });
      expect([rules(input), score(input)]).toEqual([["qa_rejected"], 0]);
    }
  });

  it("should hold the note at two when QA approved over a criterion it did not observe", () => {
    const input = reviewed({ acceptance: acceptance({ qa: { status: "PASS", consistent: false, unobserved: 2 } }) });
    expect([rules(input), score(input)]).toEqual([["qa_unobserved"], 2]);
  });

  it("should hold the note at three when no QA verdict was written", () => {
    const { qa: _none, ...withoutQa } = acceptance();
    const input = reviewed({ acceptance: withoutQa });
    expect([rules(input), score(input)]).toEqual([["qa_missing"], 3]);
  });

  it("should hold the note at two without a criteria registry, a missing digest included", () => {
    const unavailable = reviewed({ acceptance: acceptance({ available: false, counts: counts({ total: 0, verified: 0 }) }) });
    const { acceptance: _none, ...absent } = reviewed();
    expect([rules(unavailable), score(unavailable)]).toEqual([["no_criteria_registry"], 2]);
    expect([rules(absent), score(absent)]).toEqual([["no_criteria_registry"], 2]);
  });

  it("should count stale evidence by halves and round the note down", () => {
    const stale = (n: number) => reviewed({ acceptance: acceptance({ counts: counts({ stale: n }) }) });
    expect([score(stale(1)), score(stale(2)), score(stale(9))]).toEqual([4, 4, 3]);
  });

  it("should count an evidence file that does not follow its contract", () => {
    const input = reviewed({ acceptance: acceptance({ diagnostics: 2 }) });
    expect([rules(input), score(input)]).toEqual([["evidence_anomaly"], 4]);
  });

  it("should hold the note at two while an incident is open, and not once it is resolved", () => {
    const incident = (status: RunIncident["status"]) => ({ status }) as RunIncident;
    const open = reviewed({ state: { incidents: [incident("resolved"), incident("open")] } });
    expect([rules(open), score(open)]).toEqual([["incident_open"], 2]);
    expect(rules(reviewed({ state: { incidents: [incident("resolved"), incident("dismissed")] } }))).toEqual([]);
  });

  it("should hold a finding of the last review round nobody took over against the note", () => {
    const p0 = reviewed({ findings: [{ id: "SR-R1-1", severity: "P0", fixed: false }] });
    const p1 = reviewed({ findings: [{ id: "SR-R1-1", severity: "P1", fixed: false }, { id: "SR-R1-2", severity: "P2", fixed: false }] });
    expect([rules(p0), score(p0)]).toEqual([["finding_p0_open"], 0]);
    expect([rules(p1), score(p1)]).toEqual([["finding_p1_open"], 2]);
  });

  it("should leave a finding alone once its reviewer corrected it, a rework took it over or a later round replaced it", () => {
    expect(rules(reviewed({ findings: [{ id: "SR-R1-1", severity: "P0", fixed: true }] }))).toEqual([]);
    expect(rules(reviewed({ findings: [{ id: "SR-R1-1", severity: "P1", fixed: false }], state: { artifacts: ["senior-review.md", "developer-report-rework1.md"] } }))).toEqual([]);
    const secondRound = reviewed({ findings: [{ id: "SR-R1-1", severity: "P0", fixed: false }, { id: "SR-R2-1", severity: "P2", fixed: false }], state: { artifacts: ["senior-review.md", "developer-report-rework1.md"] } });
    expect(rules(secondRound)).toEqual([]);
  });

  it("should hold the finding of a second round against the note when a single rework came before it", () => {
    const input = reviewed({ findings: [{ id: "SR-R2-1", severity: "P1", fixed: false }], state: { artifacts: ["qa-report.md", "developer-report-rework1.md"] } });
    expect(rules(input)).toEqual(["finding_p1_open"]);
  });

  it("should take a point for a gate check that still failed and half for one that could not conclude", () => {
    const failed = reviewed({ gate: { failed: 2, unchecked: 0 } });
    const unchecked = reviewed({ gate: { failed: 0, unchecked: 1 } });
    expect([rules(failed), score(failed)]).toEqual([["gate_failed"], 4]);
    expect(reviewConfidence(unchecked)?.reasons).toEqual([{ rule: "gate_unchecked", minus: 0.5, detail: CONFIDENCE_DETAILS.gate_unchecked(1) }]);
  });

  it("should count the review notes, two rework rounds and a reviewer that ended without an outcome", () => {
    const agent = (name: string, status: AgentState["status"]): AgentState => ({ id: name, name, status, startedAt: "2026-10-10T10:00:00.000Z" });
    const notes = reviewed({ state: { reviewNotes: ["qa-plan.md arrived after qa-report.md", "design-inventory.md arrived after designer-review.md", "a third"] } });
    const reworked = reviewed({ state: { artifacts: ["qa-report.md", "developer-report-rework1.md", "developer-report-rework2.md"] } });
    const lost = reviewed({ state: { agents: [agent("implementation-factory:qa-reviewer", "abandoned"), agent("developer", "failed"), agent("senior-reviewer", "completed")] } });
    expect(reviewConfidence(notes)?.reasons).toEqual([{ rule: "review_order", minus: 1, count: 3, detail: CONFIDENCE_DETAILS.review_order(3) }]);
    expect(rules(reworked)).toEqual(["rework_repeated"]);
    expect(rules(reviewed({ state: { artifacts: ["qa-report.md", "developer-report-rework1.md"] } }))).toEqual([]);
    expect(reviewConfidence(lost)?.reasons).toEqual([{ rule: "reviewer_lost", minus: 0.5, detail: CONFIDENCE_DETAILS.reviewer_lost(1) }]);
  });

  it("should count a diff that could not be read against the note", () => {
    const { change: _none, ...unread } = reviewed();
    expect(rules(unread)).toEqual(["diff_unknown"]);
  });

  it("should lower the note with the size of the change, the larger threshold replacing the smaller", () => {
    expect(rules(reviewed({ change: change({ lines: 400, files: 15 }) }))).toEqual([]);
    expect(rules(reviewed({ change: change({ lines: 401 }) }))).toEqual(["diff_large"]);
    expect(rules(reviewed({ change: change({ lines: 1001, files: 16 }) }))).toEqual(["diff_very_large", "diff_many_files"]);
    expect(score(reviewed({ change: change({ lines: 1001, files: 16 }) }))).toBe(3);
  });

  it("should lower the note on a sensitive path, a removed test and code changed without a test", () => {
    const sensitive = reviewed({ change: change({ sensitive: ["db/migrations/004.sql"] }) });
    const removed = reviewed({ change: change({ removedTests: ["tests/cart.test.ts"] }) });
    expect([rules(sensitive), score(sensitive)]).toEqual([["sensitive_path"], 4]);
    expect([rules(removed), score(removed)]).toEqual([["test_removed"], 3]);
    expect(rules(reviewed({ change: change({ testChanged: false }) }))).toEqual(["no_test_change"]);
    expect(rules(reviewed({ change: change({ codeChanged: false, testChanged: false }) }))).toEqual([]);
  });

  it("should apply the lowest cap after the deductions and never go below zero", () => {
    const input = reviewed({
      acceptance: acceptance({ counts: counts({ total: 8, verified: 3, unverified: 5, stale: 4 }), diagnostics: 1 }),
      gate: { failed: 1, unchecked: 1 }, change: change({ lines: 2000, files: 40, sensitive: ["a/auth/x.ts"], testChanged: false }),
    });
    expect(score(input)).toBe(0);
    const capped = reviewed({ change: change({ removedTests: ["a.test.ts"], sensitive: ["a/auth/x.ts"] }), state: { incidents: [{ status: "open" } as RunIncident] } });
    expect([rules(capped), score(capped)]).toEqual([["incident_open", "test_removed", "sensitive_path"], 2]);
  });

  it("should never go up on what an agent declares", () => {
    const approvals = reviewed({
      acceptance: acceptance({ counts: counts({ verified: 2, unverified: 1 }), qa: { status: "PASS", consistent: true, unobserved: 0 } }),
      findings: [{ id: "SR-R1-1", severity: "P2", fixed: true }],
    });
    const silent = reviewed({ acceptance: acceptance({ counts: counts({ verified: 2, unverified: 1 }) }) });
    expect(score(approvals)).toBe(score(silent));
  });

  it("should give the same key to two computations that say the same thing", () => {
    const input = reviewed({ gate: { failed: 1, unchecked: 0 } });
    expect(confidenceKey(reviewConfidence(input))).toBe(confidenceKey(reviewConfidence(input)));
    expect(confidenceKey(reviewConfidence(input))).not.toBe(confidenceKey(reviewConfidence(reviewed())));
    expect(confidenceKey(undefined)).toBe("");
  });
});

describe("the note a run is judged by after its delivery", () => {
  const workflow = (state: "working" | "completed") => ({ schemaVersion: 1 as const, revision: 2, receivedAt: "2026-10-10T10:00:00.000Z", state });

  it("should be the note the run has when its workflow first declares its end", () => {
    expect(confidenceAtDelivery({ workflow: workflow("working") }, { score: 4, reasons: [] })).toBeUndefined();
    expect(confidenceAtDelivery({ workflow: workflow("completed") }, { score: 4, reasons: [] })).toBe(4);
    expect(confidenceAtDelivery({ workflow: workflow("completed") }, undefined)).toBeUndefined();
  });

  it("should not move once set, through a reopening and the end that follows it", () => {
    expect(confidenceAtDelivery({ confidenceAtDelivery: 4, workflow: workflow("working") }, { score: 1, reasons: [] })).toBe(4);
    expect(confidenceAtDelivery({ confidenceAtDelivery: 0, workflow: workflow("completed") }, { score: 5, reasons: [] })).toBe(0);
  });
});

describe("what a diff says of the confidence its review deserves", () => {
  const facts = (nameStatus: string, numstat: string, patch = "", patterns = ["**/migrations/**", "**/auth/**", ".github/workflows/**", "**/Dockerfile*", ".gitlab-ci.yml"]) => changeFacts(changedFiles(nameStatus, numstat), patch, patterns);

  it("should count the files and the lines, a binary file as a large one", () => {
    const read = facts("M\tsrc/cart.ts\nA\tsrc/cart.test.ts\nA\tpublic/logo.png", "10\t4\tsrc/cart.ts\n30\t0\tsrc/cart.test.ts\n-\t-\tpublic/logo.png");
    expect(read).toMatchObject({ files: 3, lines: 444, codeChanged: true, testChanged: true, removedTests: [], sensitive: [] });
  });

  it("should see a test file deleted, renamed out of the tests or with a test disabled", () => {
    expect(facts("D\ttests/cart.test.ts", "0\t20\ttests/cart.test.ts").removedTests).toEqual(["tests/cart.test.ts"]);
    expect(facts("R090\tsrc/cart.spec.ts\tsrc/cart-notes.ts", "1\t1\tsrc/{cart.spec.ts => cart-notes.ts}").removedTests).toEqual(["src/cart.spec.ts"]);
    const patch = "diff --git a/src/cart.test.ts b/src/cart.test.ts\n--- a/src/cart.test.ts\n+++ b/src/cart.test.ts\n@@ -1 +1 @@\n-it(\"should add\", () => {\n+it.skip(\"should add\", () => {\n";
    expect(facts("M\tsrc/cart.test.ts", "1\t1\tsrc/cart.test.ts", patch).removedTests).toEqual(["src/cart.test.ts"]);
  });

  it("should not take a disabled test in a file that is not a test for one", () => {
    const patch = "diff --git a/src/runner.ts b/src/runner.ts\n--- a/src/runner.ts\n+++ b/src/runner.ts\n@@ -1 +1 @@\n+it.skip(\"documented\", () => {\n";
    expect(facts("M\tsrc/runner.ts", "1\t0\tsrc/runner.ts", patch).removedTests).toEqual([]);
  });

  it("should not count a deleted test as a test the change touched", () => {
    expect(facts("M\tsrc/cart.ts\nD\tsrc/cart.test.ts", "3\t1\tsrc/cart.ts\n0\t9\tsrc/cart.test.ts")).toMatchObject({ codeChanged: true, testChanged: false });
  });

  it("should know the test files of other languages", () => {
    for (const file of ["pkg/cart_test.go", "spec/cart_spec.rb", "app/test_cart.py", "src/CartTest.java"]) {
      expect(facts(`M\t${file}`, `2\t1\t${file}`)).toMatchObject({ testChanged: true, codeChanged: false });
    }
  });

  it("should leave documentation and configuration out of the code that needs a test", () => {
    expect(facts("M\tREADME.md\nM\tconfig/app.yaml", "2\t1\tREADME.md\n1\t1\tconfig/app.yaml")).toMatchObject({ codeChanged: false, testChanged: false });
  });

  it("should match a sensitive path at any depth, under either name of a renamed file", () => {
    expect(facts("M\tservices/api/db/migrations/004_add.sql", "5\t0\tservices/api/db/migrations/004_add.sql").sensitive).toEqual(["services/api/db/migrations/004_add.sql"]);
    expect(facts("R100\tsrc/auth/token.ts\tsrc/session/token.ts", "0\t0\tsrc/{auth => session}/token.ts").sensitive).toEqual(["src/auth/token.ts"]);
    expect(facts("M\tdeploy/Dockerfile.prod\nM\t.gitlab-ci.yml\nM\t.github/workflows/ci.yml", "1\t1\tdeploy/Dockerfile.prod\n1\t1\t.gitlab-ci.yml\n1\t1\t.github/workflows/ci.yml").sensitive).toHaveLength(3);
  });

  it("should not match a name that only contains the pattern", () => {
    expect(pathMatches("**/auth/**", "src/author/profile.ts")).toBe(false);
    expect(pathMatches("**/auth/**", "auth/login.ts")).toBe(true);
    expect(pathMatches(".github/workflows/**", "docs/.github/workflows/ci.yml")).toBe(false);
    expect(pathMatches("*.sql", "db/schema.sql")).toBe(true);
    expect(pathMatches("src/*.ts", "src/deep/file.ts")).toBe(false);
    expect(pathMatches("a+b/**", "aab/file")).toBe(false);
    expect(pathMatches("", "anything")).toBe(false);
  });
});

describe("when the diff of a run is read again", () => {
  it("should read it again once the merge request is opened on unchanged code, and once its target is known", () => {
    const before = changeReadingKey("snap-1", undefined, undefined);
    const opened = changeReadingKey("snap-1", "https://gitlab.com/g/p/-/merge_requests/4", undefined);
    const targeted = changeReadingKey("snap-1", "https://gitlab.com/g/p/-/merge_requests/4", "develop");
    expect(new Set([before, opened, targeted]).size).toBe(3);
    expect(changeReadingKey("snap-1", "https://gitlab.com/g/p/-/merge_requests/4", "develop")).toBe(targeted);
  });

  it("should read it again when the code moved, and tell an unidentified code from an identified one", () => {
    expect(changeReadingKey("snap-1", undefined, undefined)).not.toBe(changeReadingKey("snap-2", undefined, undefined));
    expect(changeReadingKey(undefined, undefined, undefined)).not.toBe(changeReadingKey("snap-1", undefined, undefined));
  });

  it("should leave the diff unknown after a failed reading while the worktree is there", () => {
    const known = change({ lines: 12 });
    expect(changeAfterReading(undefined, known, false)).toBeUndefined();
    const { change: _read, ...run } = reviewed();
    expect(rules({ ...run, ...defined({ change: changeAfterReading(undefined, known, false) }) })).toEqual(["diff_unknown"]);
  });

  it("should keep the last diff read once the worktree is gone, and take a new reading over it", () => {
    const known = change({ lines: 12 });
    const read = change({ lines: 40 });
    expect(changeAfterReading(undefined, known, true)).toBe(known);
    expect(changeAfterReading(read, known, true)).toBe(read);
    expect(changeAfterReading(undefined, undefined, true)).toBeUndefined();
  });
});

describe("what the stop gate's log says of the checks", () => {
  const line = (entry: Record<string, unknown>) => JSON.stringify({ at: "2026-10-10T10:00:00.000Z", agent: "developer", agentId: "a1", root: "/repo/console", ...entry });

  it("should judge a check that failed then passed by its second verdict", () => {
    expect(gateFacts([line({ step: "typecheck", result: "fail" }), line({ step: "typecheck", result: "pass", retry: true })].join("\n"))).toEqual({ failed: 0, unchecked: 0 });
  });

  it("should count a check that failed again, and the checks of two agents apart", () => {
    const log = [
      line({ step: "tests", result: "fail" }), line({ step: "tests", result: "fail", retry: true }),
      line({ step: "tests", result: "pass", agentId: "a2" }), line({ step: "lint", result: "skipped", agentId: "a2" }), line({ step: "typecheck", result: "inconclusive", agentId: "a2" }),
    ].join("\n");
    expect(gateFacts(log)).toEqual({ failed: 1, unchecked: 2 });
  });

  it("should step over a line that is not a verdict", () => {
    expect(gateFacts(["not json", "", line({ result: "none" }), JSON.stringify(null), line({ step: "lint", result: 3 })].join("\n"))).toEqual({ failed: 0, unchecked: 0 });
  });
});

describe("the rules of the review confidence", () => {
  it("should have a sentence in both languages for every rule and no other", () => {
    const ids = CONFIDENCE_RULES.map((rule) => rule.id).sort();
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(CONFIDENCE_DETAILS).sort()).toEqual(ids);
    expect(Object.keys(acceptanceText("fr").confidence.reason).sort()).toEqual(ids);
    for (const id of ids) expect(acceptanceText("fr").confidence.reason[id](2)).not.toBe(acceptanceText("en").confidence.reason[id](2));
  });

  it("should match the table of the engineering workflow document", () => {
    const document = readFileSync(path.join(__dirname, "../../../docs/engineering-workflow.md"), "utf8");
    const start = document.indexOf("## Review confidence");
    const end = document.indexOf("\n## ", start + 1);
    const section = document.slice(start, end === -1 ? undefined : end);
    const rows = [...section.matchAll(/^\| `([a-z0-9_]+)` \| (held at|minus) ([\d.]+)(?: each, ([\d.]+) at most)? \|/gm)]
      .map(([, id, kind, value, most]) => ({ id, kind: kind === "minus" ? "minus" : "cap", value: Number(value), ...(most ? { each: true, most: Number(most) } : {}) }));
    expect(rows).toEqual(CONFIDENCE_RULES.map((rule) => ({ ...rule })));
  });
});
