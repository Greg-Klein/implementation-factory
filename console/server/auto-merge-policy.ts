/**
 * What decides, without any agent, whether an improvement branch may be merged
 * without the user. Pure: the git readings, the checks and the judge are in
 * auto-merge.ts. This file is itself a protected path, so a branch cannot relax
 * the rules it is judged by.
 */

/**
 * Files a branch merged without the user may not touch: the guard and the stop
 * gate, the loop's own prompts and code, the judge, the independent reviewers,
 * the CI and the launcher. Prefixes end with a slash, other entries are exact
 * paths.
 */
export const PROTECTED_PATHS = [
  "hooks/guard.mjs",
  "hooks/gate.mjs",
  "hooks/emit.mjs",
  "hooks/hooks.json",
  "commands/improve.md",
  "commands/rebase.md",
  "commands/judge-improvement.md",
  "commands/review.md",
  "contracts/improvement-verdict.md",
  "contracts/qa.md",
  "contracts/design.md",
  "contracts/senior.md",
  "agents/senior-reviewer.md",
  "agents/qa-reviewer.md",
  "agents/designer-reviewer-figma.md",
  "agents/review-orchestrator.md",
  "skills/review-change/",
  "skills/figma-review/",
  "console/server/self-improvement.ts",
  "console/server/auto-merge.ts",
  "console/server/auto-merge-policy.ts",
  "console/server/engine/improvement-judge.ts",
  "bin/implementation-harness",
  ".claude-plugin/",
  ".github/",
];

export const AUTO_MERGE_LIMITS = { files: 15, lines: 400 };

export type ChangedFile = { status: string; path: string; oldPath?: string; added: number; removed: number };

export function isProtectedPath(file: string) {
  return PROTECTED_PATHS.some((entry) => entry.endsWith("/") ? file.startsWith(entry) : file === entry);
}

export function isTestFile(file: string) {
  return /(^|\/)tests?\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

const DISABLED_TEST = /\b(?:(?:it|test|describe)\.(?:skip|only|todo|fixme)|xit|xdescribe|xtest)\s*\(/;

/** The lines a unified diff adds, with the file each one lands in. */
export function addedLines(patch: string) {
  const lines: { path: string; text: string }[] = [];
  let current: string | undefined;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ ")) { current = line.startsWith("+++ b/") ? line.slice(6) : undefined; continue; }
    if (line.startsWith("diff --git ")) { current = undefined; continue; }
    if (current && line.startsWith("+")) lines.push({ path: current, text: line.slice(1) });
  }
  return lines;
}

/**
 * `git diff --name-status -M` and `git diff --numstat -M` of the same range,
 * read into one entry per file. A rename shows in numstat as `old => new`, or
 * `dir/{old => new}/file`; it is matched by its new path.
 */
export function changedFiles(nameStatus: string, numstat: string): ChangedFile[] {
  const counts = new Map<string, { added: number; removed: number }>();
  for (const line of numstat.split("\n").filter(Boolean)) {
    const [added, removed, ...rest] = line.split("\t");
    const name = rest.join("\t");
    const renamed = name.replace(/\{[^{}]*? => ([^{}]*)\}/, "$1").replace(/^.* => /, "").replace(/\/\//g, "/");
    // A binary file counts `-`: it is read as large, never as empty.
    counts.set(renamed, { added: added === "-" ? AUTO_MERGE_LIMITS.lines : Number(added) || 0, removed: removed === "-" ? 0 : Number(removed) || 0 });
  }
  return nameStatus.split("\n").filter(Boolean).map((line) => {
    const [status, first, second] = line.split("\t");
    const file = second ?? first ?? "";
    return { status: status?.charAt(0) ?? "", path: file, ...(second ? { oldPath: first } : {}), ...(counts.get(file) ?? { added: 0, removed: 0 }) };
  });
}

/** Why a branch may not be merged without the user, empty when nothing stands in the way. */
export function autoMergeBlockers(files: ChangedFile[], patch: string) {
  const blockers: string[] = [];
  if (files.length === 0) blockers.push("The branch changes no file.");
  const touched = [...new Set(files.flatMap((file) => [file.path, file.oldPath]).filter((file): file is string => Boolean(file)).filter(isProtectedPath))];
  if (touched.length > 0) blockers.push(`It touches a protected file: ${touched.join(", ")}.`);
  const removedTests = files.filter((file) => (file.status === "D" && isTestFile(file.path)) || (file.status === "R" && file.oldPath && isTestFile(file.oldPath) && !isTestFile(file.path)));
  if (removedTests.length > 0) blockers.push(`It removes a test file: ${removedTests.map((file) => file.oldPath ?? file.path).join(", ")}.`);
  const disabled = [...new Set(addedLines(patch).filter((line) => isTestFile(line.path) && DISABLED_TEST.test(line.text)).map((line) => line.path))];
  if (disabled.length > 0) blockers.push(`It skips or isolates a test: ${disabled.join(", ")}.`);
  const lines = files.reduce((total, file) => total + file.added + file.removed, 0);
  if (files.length > AUTO_MERGE_LIMITS.files) blockers.push(`It changes ${files.length} files, more than ${AUTO_MERGE_LIMITS.files}.`);
  if (lines > AUTO_MERGE_LIMITS.lines) blockers.push(`It changes ${lines} lines, more than ${AUTO_MERGE_LIMITS.lines}.`);
  return blockers;
}

export type JudgeVerdict = { decision: "merge" | "hold"; expected: string; reasons: string[] };

/** The judge's file, as contracts/improvement-verdict.md defines it. Anything else is a reason to hold. */
export function judgeVerdict(raw: unknown): { verdict: JudgeVerdict } | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: "The verdict is not a JSON object." };
  const { decision, expected, reasons } = raw as Record<string, unknown>;
  if (decision !== "merge" && decision !== "hold") return { error: "`decision` is neither `merge` nor `hold`." };
  if (typeof expected !== "string" || !expected.trim()) return { error: "`expected` is missing." };
  if (!Array.isArray(reasons) || reasons.length === 0 || reasons.length > 10 || !reasons.every((reason) => typeof reason === "string" && reason.trim()))
    return { error: "`reasons` is not a list of 1 to 10 sentences." };
  return { verdict: { decision, expected: expected.trim().slice(0, 2_000), reasons: reasons.map((reason: string) => reason.trim().slice(0, 600)) } };
}

/** One line of the decisions file: what the console decided for a branch, on its own or on the user's revert. */
export type AutoMergeDecision = {
  worktreeName: string;
  at: string;
  decision: "merged" | "rejected" | "reverted";
  reasons: string[];
  branch?: string;
  mergeCommit?: string;
  /** Every pass of the judge on the branch before this decision, one more each time the harness or the branch moved under it. */
  judgements?: JudgeRun[];
};

/** One session of the judge: how long it took, and what it consumed when it ended on its own report. */
export type JudgeRun = {
  at: string;
  durationMs: number;
  timedOut?: true;
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  costUsd?: number;
  turns?: number;
  models?: string[];
};

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** A judge pass read back from the decisions file, or undefined when one of its figures is not one. */
export function judgeRun(raw: unknown): JudgeRun | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const { at, durationMs, timedOut, tokens, costUsd, turns, models } = raw as Record<string, unknown>;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at)) || !isCount(durationMs)) return undefined;
  if (timedOut !== undefined && timedOut !== true) return undefined;
  if (costUsd !== undefined && !isCount(costUsd)) return undefined;
  if (turns !== undefined && !isCount(turns)) return undefined;
  if (models !== undefined && !(Array.isArray(models) && models.every((model) => typeof model === "string"))) return undefined;
  let figures: JudgeRun["tokens"];
  if (tokens !== undefined) {
    if (typeof tokens !== "object" || tokens === null) return undefined;
    const { input, output, cacheRead, cacheWrite, total } = tokens as Record<string, unknown>;
    if (![input, output, cacheRead, cacheWrite, total].every(isCount)) return undefined;
    figures = { input, output, cacheRead, cacheWrite, total } as NonNullable<JudgeRun["tokens"]>;
  }
  return {
    at, durationMs,
    ...(timedOut ? { timedOut } : {}),
    ...(figures ? { tokens: figures } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(turns !== undefined ? { turns } : {}),
    ...(models !== undefined ? { models: models as string[] } : {}),
  };
}

export function autoMergeDecision(raw: unknown): AutoMergeDecision | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { worktreeName, at, decision, reasons, branch, mergeCommit, judgements } = raw as Record<string, unknown>;
  if (typeof worktreeName !== "string" || !/^[a-z0-9-]+$/i.test(worktreeName)) return undefined;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return undefined;
  if (decision !== "merged" && decision !== "rejected" && decision !== "reverted") return undefined;
  if (!Array.isArray(reasons) || !reasons.every((reason) => typeof reason === "string")) return undefined;
  if (decision === "merged" && (typeof mergeCommit !== "string" || !/^[0-9a-f]{40}$/.test(mergeCommit))) return undefined;
  return {
    worktreeName, at, decision, reasons: reasons as string[],
    ...(typeof branch === "string" ? { branch } : {}),
    ...(typeof mergeCommit === "string" ? { mergeCommit } : {}),
    ...(Array.isArray(judgements) ? { judgements: judgements.flatMap((judgement) => judgeRun(judgement) ?? []) } : {}),
  };
}

/** The latest decision per worktree, the later line winning. */
export function latestDecisions(decisions: AutoMergeDecision[]) {
  const latest = new Map<string, AutoMergeDecision>();
  for (const decision of decisions) latest.set(decision.worktreeName, decision);
  return latest;
}

export const RECENT_MERGE_MS = 24 * 60 * 60 * 1000;

/** The branches merged without the user in the last day and not reverted since, newest first. */
export function recentAutoMerges(decisions: AutoMergeDecision[], now: number) {
  return [...latestDecisions(decisions).values()]
    .filter((decision) => decision.decision === "merged" && now - Date.parse(decision.at) < RECENT_MERGE_MS)
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

/**
 * What the metrics show of the loop: how many branches were merged, rejected
 * (and among them, how many by the judge rather than by a rule or a check) and
 * reverted, plus the decisions the judge took part in, newest first.
 */
export function improvementJudgeMetrics(decisions: AutoMergeDecision[]) {
  const count = (decision: AutoMergeDecision["decision"]) => decisions.filter((entry) => entry.decision === decision).length;
  return {
    merged: count("merged"),
    rejected: count("rejected"),
    rejectedByJudge: decisions.filter((entry) => entry.decision === "rejected" && (entry.judgements?.length ?? 0) > 0).length,
    reverted: count("reverted"),
    judged: decisions
      .filter((entry) => (entry.judgements?.length ?? 0) > 0)
      .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
      .map(({ worktreeName, at, decision, reasons, judgements = [] }) => ({ worktreeName, at, decision, reasons, judgements })),
  };
}

export type ImprovementJudgeMetrics = ReturnType<typeof improvementJudgeMetrics>;

/** How many rejected branches one feedback entry may cause before the loop stops trying it. */
export const MAX_REJECTED_ATTEMPTS = 2;

export type RejectedAttempt = { branch: string; at: string; reasons: string[] };

/**
 * What becomes of a processed feedback entry once the branch built on it is
 * rejected: back to `pending/` with the judge's reasons, so the next iteration
 * tries another way, or left processed after its last allowed attempt.
 * Undefined when the entry is not one the branch processed.
 */
export function rejectedEntry(raw: unknown, branch: string, attempt: RejectedAttempt): { retry: Record<string, unknown> } | { exhausted: Record<string, unknown> } | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.branch !== "string" || (entry.branch !== branch && entry.branch !== `worktree-${branch}` && `worktree-${entry.branch}` !== branch)) return undefined;
  const earlier = Array.isArray(entry.rejectedAttempts) ? entry.rejectedAttempts.filter((item): item is RejectedAttempt => typeof item === "object" && item !== null) : [];
  const rejectedAttempts = [...earlier, attempt];
  if (rejectedAttempts.length >= MAX_REJECTED_ATTEMPTS) return { exhausted: { ...entry, decision: "rejected", rejectedAttempts } };
  const { branch: _branch, commit: _commit, decision: _decision, processedAt: _processedAt, ...rest } = entry;
  return { retry: { ...rest, status: "pending", rejectedAttempts } };
}
