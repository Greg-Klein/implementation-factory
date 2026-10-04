import type { RunMetrics } from "./types";

/** Tokens in the unit a person compares: thousands below a million, millions above: "412k", "1.61M". */
export function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

/** A duration to the minute, to the second under a minute, in hours past ninety minutes. */
export function formatDuration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}

export function formatShare(ratio: number) {
  return `${Math.round(ratio * 100)}%`;
}

export function median(values: number[]) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const ROLES: Record<string, string> = {
  "ticket-planner": "Planning", developer: "Development", "senior-reviewer": "Technical review", "qa-reviewer": "QA",
  "designer-reviewer": "Design review", "review-orchestrator": "Review orchestration",
};

export function sessionLabel(name: string) {
  return ROLES[name] ?? name;
}

const WAITS = { question: "Decisions", session_prompt: "Folder trust", terminal: "Terminal input" } as const;

export function waitLabel(reason: keyof typeof WAITS) {
  return WAITS[reason];
}

/** How many times the reviewers were launched beyond a single pass each, plus the developers sent to correct. */
export function reworkCount(metrics: Pick<RunMetrics, "rework">) {
  const rounds = Math.max(metrics.rework.launches["senior-reviewer"] ?? 0, metrics.rework.launches["qa-reviewer"] ?? 0);
  return Math.max(0, rounds - 1) + metrics.rework.reworkDevelopers;
}

/** What the plan predicted, in one short string: "2 S · 1 M". Empty without a plan. */
export function planSizes(metrics: Pick<RunMetrics, "complexity">) {
  const { sizes, tasks } = metrics.complexity;
  const parts = (["S", "M", "L"] as const).flatMap((size) => (sizes[size] > 0 ? [`${sizes[size]} ${size}`] : []));
  return parts.length > 0 ? parts.join(" · ") : tasks > 0 ? `${tasks} task${tasks > 1 ? "s" : ""}` : "";
}

export type MetricsSummary = { runs: number; tokens?: number; activeMs?: number; userWaitMs?: number; pilotShare?: number };

/** The medians of the delivered runs, which is what a single run is read against. Undefined below three: two runs make no median worth showing. */
export function summarize(runs: RunMetrics[]): MetricsSummary | undefined {
  const delivered = runs.filter((run) => run.outcome.status === "completed");
  if (delivered.length < 3) return undefined;
  const measured = delivered.filter((run) => run.tokens);
  return {
    runs: delivered.length,
    tokens: median(measured.map((run) => run.tokens!.total.total)),
    activeMs: median(delivered.map((run) => run.time.activeMs)),
    userWaitMs: median(delivered.map((run) => run.time.userWaitMs)),
    pilotShare: median(measured.map((run) => run.tokens!.pilotShare)),
  };
}
