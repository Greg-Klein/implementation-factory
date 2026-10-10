import { addedLines, AUTO_MERGE_LIMITS, type ChangedFile, DISABLED_TEST, isTestFile } from "./auto-merge-policy.js";
import type { ReviewFinding } from "./domain.js";
import type { AcceptanceDigest, ConfidenceReason, ReviewConfidence, RunState } from "./types.js";

/**
 * How far the automated review of a run can be relied on, from 0 (a person has
 * to review everything) to 5 (nothing the console observed stands against it).
 * Pure and without any agent: the same facts give the same note.
 *
 * Three rules hold the table together. What an agent declares (a QA verdict,
 * the severity of a finding, a blocked workflow) may lower the note and never
 * raises it. A fact that could not be read is not a favourable one. And the
 * note says how well the review was evidenced and how risky the change is,
 * not that the code is right: a requirement nobody wrote down shows in no
 * evidence.
 */

export const CONFIDENCE_MAXIMUM = 5;

/**
 * `cap`: the note cannot be above `value` while the fact holds. `minus`:
 * `value` is taken off, once, or once per occurrence when `each` is set, up to
 * `most`. The table of docs/engineering-workflow.md is held equal to this one
 * by a unit test.
 */
export type ConfidenceRule = { id: string; kind: "cap" | "minus"; value: number; each?: true; most?: number };

export const CONFIDENCE_RULES = [
  { id: "run_failed", kind: "cap", value: 0 },
  { id: "workflow_blocked", kind: "cap", value: 0 },
  { id: "draft_delivery", kind: "cap", value: 0 },
  { id: "criterion_failed", kind: "cap", value: 0 },
  { id: "qa_rejected", kind: "cap", value: 0 },
  { id: "finding_p0_open", kind: "cap", value: 0 },
  { id: "criterion_blocked", kind: "cap", value: 1 },
  { id: "no_criteria_registry", kind: "cap", value: 2 },
  { id: "qa_unobserved", kind: "cap", value: 2 },
  { id: "incident_open", kind: "cap", value: 2 },
  { id: "finding_p1_open", kind: "cap", value: 2 },
  { id: "qa_missing", kind: "cap", value: 3 },
  { id: "test_removed", kind: "cap", value: 3 },
  { id: "criterion_unverified", kind: "minus", value: 1, each: true, most: 3 },
  { id: "evidence_stale", kind: "minus", value: 0.5, each: true, most: 1.5 },
  { id: "gate_failed", kind: "minus", value: 1 },
  { id: "gate_unchecked", kind: "minus", value: 0.5 },
  { id: "evidence_anomaly", kind: "minus", value: 0.5 },
  { id: "review_order", kind: "minus", value: 0.5, each: true, most: 1 },
  { id: "rework_repeated", kind: "minus", value: 0.5 },
  { id: "reviewer_lost", kind: "minus", value: 0.5 },
  { id: "diff_unknown", kind: "minus", value: 0.5 },
  { id: "diff_large", kind: "minus", value: 0.5 },
  { id: "diff_very_large", kind: "minus", value: 1 },
  { id: "diff_many_files", kind: "minus", value: 0.5 },
  { id: "sensitive_path", kind: "minus", value: 1 },
  { id: "no_test_change", kind: "minus", value: 0.5 },
] as const satisfies readonly ConfidenceRule[];

export type ConfidenceRuleId = (typeof CONFIDENCE_RULES)[number]["id"];

/** Above this many changed lines the change is large, above the second very large. The first is the limit of an improvement merged without the user. */
export const CONFIDENCE_DIFF_LINES = { large: AUTO_MERGE_LIMITS.lines, veryLarge: 1000 };

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the interface says of each rule. The merge request summary has its own sentences, in the workflow language (acceptance-text.ts). */
export const CONFIDENCE_DETAILS: Record<ConfidenceRuleId, (occurrences: number) => string> = {
  run_failed: () => "The run failed.",
  workflow_blocked: () => "The workflow ended blocked.",
  draft_delivery: () => "The merge request was opened as a draft.",
  criterion_failed: (n) => `${count(n, "acceptance criterion", "acceptance criteria")} failed.`,
  qa_rejected: () => "QA did not approve the change.",
  finding_p0_open: (n) => `${count(n, "blocking finding", "blocking findings")} of the code review left uncorrected.`,
  criterion_blocked: (n) => `${count(n, "acceptance criterion", "acceptance criteria")} blocked.`,
  no_criteria_registry: () => "No criteria registry: nothing ties the evidence to a requirement.",
  qa_unobserved: (n) => `QA approved while ${count(n, "criterion has", "criteria have")} no QA observation on the current code.`,
  incident_open: (n) => `${count(n, "incident", "incidents")} still open.`,
  finding_p1_open: (n) => `${count(n, "important finding", "important findings")} of the code review left uncorrected.`,
  qa_missing: () => "No QA verdict: nobody but the author observed the criteria.",
  test_removed: (n) => `${count(n, "test file", "test files")} removed or with a test disabled.`,
  criterion_unverified: (n) => `${count(n, "acceptance criterion", "acceptance criteria")} unverified.`,
  evidence_stale: (n) => `${count(n, "piece of evidence", "pieces of evidence")} taken on code that changed since.`,
  gate_failed: () => "A check of the stop gate still failed when its agent handed over.",
  gate_unchecked: () => "A check of the stop gate could not conclude.",
  evidence_anomaly: (n) => `${count(n, "evidence file", "evidence files")} could not be read as its contract says.`,
  review_order: (n) => `${count(n, "reviewer", "reviewers")} wrote its expectations after its report.`,
  rework_repeated: (n) => `${n} rework rounds before the review ended.`,
  reviewer_lost: (n) => `${count(n, "reviewer", "reviewers")} ended without an outcome.`,
  diff_unknown: () => "The size of the change could not be read.",
  diff_large: (n) => `${n} lines changed, more than ${CONFIDENCE_DIFF_LINES.large}.`,
  diff_very_large: (n) => `${n} lines changed, more than ${CONFIDENCE_DIFF_LINES.veryLarge}.`,
  diff_many_files: (n) => `${n} files changed, more than ${AUTO_MERGE_LIMITS.files}.`,
  sensitive_path: (n) => `${count(n, "sensitive file", "sensitive files")} changed.`,
  no_test_change: () => "Code changed and no test file did.",
};

/** What a diff shows that bears on how far its review can be trusted, whatever the review said. */
export type ChangeFacts = { files: number; lines: number; sensitive: string[]; removedTests: string[]; codeChanged: boolean; testChanged: boolean };

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|py|rb|go|rs|java|kt|kts|scala|php|cs|swift|ex|exs|c|h|cc|cpp|hpp|sql)$/;
const OTHER_TEST_FILE = /(?:_test\.go|_spec\.rb|(?:^|\/)test_[^/]*\.py|_test\.py|Tests?\.(?:java|kt|cs|php|swift))$/;

/** A test file whatever the language, where `isTestFile` only knows the JavaScript shapes and a `tests/` directory. */
export function isTestPath(file: string) {
  return isTestFile(file) || OTHER_TEST_FILE.test(file);
}

/** `**` crosses directories, `*` stays inside one, and a pattern without a slash matches a name at any depth. */
export function pathMatches(pattern: string, file: string) {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  const anchored = trimmed.includes("/") ? trimmed : `**/${trimmed}`;
  const source = anchored.split(/(\*\*\/|\*\*|\*)/).map((part) => {
    if (part === "**/") return "(?:.*/)?";
    if (part === "**") return ".*";
    if (part === "*") return "[^/]*";
    return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return new RegExp(`^${source}$`).test(file);
}

/** Reads `changedFiles` and the patch of the same range. A renamed file is judged on both its names. */
export function changeFacts(files: ChangedFile[], patch: string, sensitivePatterns: string[]): ChangeFacts {
  const paths = (file: ChangedFile) => [file.path, file.oldPath].filter((name): name is string => Boolean(name));
  const removed = files.filter((file) => (file.status === "D" && isTestPath(file.path)) || (file.status === "R" && Boolean(file.oldPath) && isTestPath(file.oldPath!) && !isTestPath(file.path))).map((file) => file.oldPath ?? file.path);
  const disabled = addedLines(patch).filter((line) => isTestPath(line.path) && DISABLED_TEST.test(line.text)).map((line) => line.path);
  const kept = files.filter((file) => file.status !== "D");
  return {
    files: files.length,
    lines: files.reduce((total, file) => total + file.added + file.removed, 0),
    sensitive: [...new Set(files.flatMap(paths).filter((file) => sensitivePatterns.some((pattern) => pathMatches(pattern, file))))],
    removedTests: [...new Set([...removed, ...disabled])],
    codeChanged: files.some((file) => SOURCE_FILE.test(file.path) && !isTestPath(file.path)),
    testChanged: kept.some((file) => isTestPath(file.path)),
  };
}

/**
 * What a reading of the diff holds for: the code it was made on and the base it
 * was measured from. The merge request is usually opened after the last edit,
 * so its address and the branch it targets are part of it: the code alone would
 * leave the diff measured from the base known before the merge request existed.
 */
export function changeReadingKey(snapshot: string | undefined, mergeRequestUrl: string | undefined, targetBranch: string | undefined) {
  return JSON.stringify([snapshot ?? "", mergeRequestUrl ?? "", targetBranch ?? ""]);
}

/**
 * What stands after a reading of the diff. One that failed leaves the diff
 * unknown, which counts against the note. The last one read is kept only once
 * the worktree is gone, since there is then no diff left to read.
 */
export function changeAfterReading(read: ChangeFacts | undefined, known: ChangeFacts | undefined, worktreeGone: boolean) {
  return read ?? (worktreeGone ? known : undefined);
}

/** What the stop gate last said of each check of each agent: a check that failed and was run again counts by its second verdict. */
export type GateFacts = { failed: number; unchecked: number };

export function gateFacts(log: string): GateFacts {
  const last = new Map<string, string>();
  for (const line of log.split("\n")) {
    let entry: { agentId?: unknown; root?: unknown; step?: unknown; result?: unknown };
    try { entry = JSON.parse(line); } catch { continue; }
    if (!entry || typeof entry.result !== "string" || typeof entry.step !== "string") continue;
    last.set(JSON.stringify([entry.agentId ?? "", entry.root ?? "", entry.step]), entry.result);
  }
  const verdicts = [...last.values()];
  return { failed: verdicts.filter((result) => result === "fail").length, unchecked: verdicts.filter((result) => result === "skipped" || result === "inconclusive").length };
}

const REVIEW_REPORT = /(?:^|\/)(?:senior-review|qa-report)\.md$/;
const REWORK_REPORT = /(?:^|\/)developer-report-rework[^/]*\.md$/;
const REVIEWERS = new Set(["senior-reviewer", "qa-reviewer", "designer-reviewer", "review-orchestrator"]);
const QA_APPROVALS = new Set(["PASS", "PASS_WITH_WARNINGS"]);

/** `implementation-factory:qa-reviewer` and `qa-reviewer` are the same agent. */
const agentType = (name: string) => name.slice(name.lastIndexOf(":") + 1);

/** The round a finding belongs to, from its `SR-R<round>-<n>` identifier; the first round when it follows no such shape. */
function findingRound(id: string) {
  const round = Number(/^SR-R(\d+)-/.exec(id)?.[1]);
  return Number.isInteger(round) && round > 0 ? round : 1;
}

/**
 * The findings of the last round of the code review nobody took over: the
 * reviewer did not correct them and no rework developer came after that round.
 * A finding a rework took over is judged by the QA verdict that follows it.
 */
function openFindings(findings: Pick<ReviewFinding, "id" | "severity" | "fixed">[], reworks: number) {
  const lastRound = Math.max(0, ...findings.map((finding) => findingRound(finding.id)));
  if (reworks >= lastRound) return [];
  return findings.filter((finding) => findingRound(finding.id) === lastRound && !finding.fixed);
}

export type ConfidenceInput = {
  state: Pick<RunState, "status" | "workflow" | "incidents" | "reviewNotes" | "artifacts" | "agents">;
  acceptance?: AcceptanceDigest;
  /** What the code review of this run wrote as data, every round together. */
  findings: Pick<ReviewFinding, "id" | "severity" | "fixed">[];
  gate: GateFacts;
  /** Undefined when the diff could not be read, which counts against the note. */
  change?: ChangeFacts;
};

/** Undefined until a reviewer of the run wrote its report: before that there is no review to trust or doubt. */
export function reviewConfidence({ state, acceptance, findings, gate, change }: ConfidenceInput): ReviewConfidence | undefined {
  if (!state.artifacts.some((artifact) => REVIEW_REPORT.test(artifact))) return undefined;
  const reasons: ConfidenceReason[] = [];
  const apply = (id: ConfidenceRuleId, occurrences = 1) => {
    if (occurrences <= 0) return;
    const rule: ConfidenceRule = CONFIDENCE_RULES.find((entry) => entry.id === id)!;
    const detail = CONFIDENCE_DETAILS[id](occurrences);
    const counted = occurrences > 1 ? { count: occurrences } : {};
    if (rule.kind === "cap") reasons.push({ rule: id, cap: rule.value, ...counted, detail });
    else reasons.push({ rule: id, minus: Math.min(rule.most ?? Infinity, rule.each ? rule.value * occurrences : rule.value), ...counted, detail });
  };

  if (state.status === "failed") apply("run_failed");
  if (state.workflow?.state === "blocked" || (state.workflow?.result?.blockers.length ?? 0) > 0) apply("workflow_blocked");
  if (state.workflow?.result?.delivery === "draft_merge_request") apply("draft_delivery");

  const reworks = state.artifacts.filter((artifact) => REWORK_REPORT.test(artifact)).length;
  const open = openFindings(findings, reworks);
  apply("finding_p0_open", open.filter((finding) => finding.severity === "P0").length);
  apply("finding_p1_open", open.filter((finding) => finding.severity === "P1").length);

  if (!acceptance?.available) apply("no_criteria_registry");
  else {
    apply("criterion_failed", acceptance.counts.failed);
    apply("criterion_blocked", acceptance.counts.blocked);
    apply("criterion_unverified", acceptance.counts.unverified);
    apply("evidence_stale", acceptance.counts.stale);
    if (!acceptance.qa) apply("qa_missing");
    else if (!QA_APPROVALS.has(acceptance.qa.status)) apply("qa_rejected");
    else if (!acceptance.qa.consistent) apply("qa_unobserved", acceptance.qa.unobserved);
  }
  apply("evidence_anomaly", acceptance?.diagnostics ?? 0);
  apply("incident_open", (state.incidents ?? []).filter((incident) => incident.status === "open").length);

  if (gate.failed > 0) apply("gate_failed");
  if (gate.unchecked > 0) apply("gate_unchecked");
  apply("review_order", state.reviewNotes?.length ?? 0);
  if (reworks >= 2) apply("rework_repeated", reworks);
  apply("reviewer_lost", state.agents.filter((agent) => REVIEWERS.has(agentType(agent.name)) && (agent.status === "failed" || agent.status === "abandoned")).length);

  if (!change) apply("diff_unknown");
  else {
    apply("test_removed", change.removedTests.length);
    if (change.lines > CONFIDENCE_DIFF_LINES.veryLarge) apply("diff_very_large", change.lines);
    else if (change.lines > CONFIDENCE_DIFF_LINES.large) apply("diff_large", change.lines);
    if (change.files > AUTO_MERGE_LIMITS.files) apply("diff_many_files", change.files);
    apply("sensitive_path", change.sensitive.length);
    if (change.codeChanged && !change.testChanged) apply("no_test_change");
  }

  const taken = reasons.reduce((sum, reason) => sum + (reason.minus ?? 0), 0);
  const ceiling = Math.min(CONFIDENCE_MAXIMUM, ...reasons.flatMap((reason) => (reason.cap === undefined ? [] : [reason.cap])));
  return { score: Math.max(0, Math.floor(Math.min(ceiling, CONFIDENCE_MAXIMUM - taken))), reasons };
}

/**
 * The note a run is later judged by: the one it had when its workflow first
 * declared its end. Kept once set, so a change asked after the final report,
 * which is what the note is held against, never rewrites it.
 */
export function confidenceAtDelivery(state: Pick<RunState, "confidenceAtDelivery" | "workflow">, confidence: ReviewConfidence | undefined): number | undefined {
  if (state.confidenceAtDelivery !== undefined) return state.confidenceAtDelivery;
  return confidence && state.workflow?.state === "completed" ? confidence.score : undefined;
}

const isScore = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= CONFIDENCE_MAXIMUM;

/**
 * The confidence fields of a run read back from `run.json`: a file, so each is
 * checked. A note out of range or a reason without its sentence is dropped, and
 * a reason of a rule this version no longer has is kept with the sentence it
 * was stored with.
 */
export function storedConfidence(state: { confidence?: unknown; confidenceAtDelivery?: unknown; feedbackCount?: unknown }): Pick<RunState, "confidence" | "confidenceAtDelivery" | "feedbackCount"> {
  const stored = state.confidence as { score?: unknown; reasons?: unknown } | null | undefined;
  const amount = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);
  const reasons = stored && Array.isArray(stored.reasons) ? stored.reasons.flatMap((entry: unknown): ConfidenceReason[] => {
    if (!entry || typeof entry !== "object") return [];
    const { rule, cap, minus, count, detail } = entry as Record<string, unknown>;
    if (typeof rule !== "string" || !rule || typeof detail !== "string" || !detail) return [];
    const effect = { cap: amount(cap), minus: amount(minus), count: amount(count) };
    if (effect.cap === undefined && effect.minus === undefined) return [];
    return [{ rule, ...Object.fromEntries(Object.entries(effect).filter(([, value]) => value !== undefined)), detail }];
  }) : [];
  return {
    ...(stored && typeof stored === "object" && isScore(stored.score) ? { confidence: { score: stored.score, reasons } } : {}),
    ...(isScore(state.confidenceAtDelivery) ? { confidenceAtDelivery: state.confidenceAtDelivery } : {}),
    ...(typeof state.feedbackCount === "number" && Number.isInteger(state.feedbackCount) && state.feedbackCount > 0 ? { feedbackCount: state.feedbackCount } : {}),
  };
}

/** What two computations are compared by: the note is published and its summary rewritten only when this moves. */
export function confidenceKey(confidence: ReviewConfidence | undefined) {
  return confidence ? JSON.stringify([confidence.score, confidence.reasons.map((reason) => [reason.rule, reason.cap, reason.minus, reason.count])]) : "";
}
