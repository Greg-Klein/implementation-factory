import { runInProgress, sourceRepository } from "./domain.js";
import type { SessionUsage } from "./engine/index.js";
import type { AgentMetrics, MetricsBaseline, MetricsFinding, RunDiff, RunMetrics, RunState, SessionMetrics, TokenUsage, UserWait } from "./types.js";

/**
 * What a run cost and what it delivered, in figures. Pure: the run state, the
 * usage the engine read and the size of the change come in, `RunMetrics` comes
 * out. The files and git are in run-metrics-runtime.ts.
 *
 * Two figures are predictions and one is a fact. The plan's sizes and the
 * review tier come from the harness itself; the diff is what the ticket turned
 * out to be. Comparing a run to others by the first two alone would grade the
 * harness with its own estimate.
 */

const time = (value: string | null | undefined) => (value ? new Date(value).getTime() : Number.NaN);
const span = (from: number, to: number) => (Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, to - from) : 0);

/** Why the run is waiting on the user right now, or undefined when it is not. */
export function userWaitReason(state: Pick<RunState, "status" | "pendingQuestion" | "sessionPrompt">): UserWait["reason"] | undefined {
  if (state.sessionPrompt) return "session_prompt";
  if (state.status !== "attention") return undefined;
  return state.pendingQuestion ? "question" : "terminal";
}

/**
 * Brings the two timelines of a run up to date with its state: the waits on the
 * user and the first time each phase was reached. Called on every publication,
 * so a wait is as long as the state said the run was waiting. Returns whether
 * anything moved.
 */
export function trackTimeline(state: RunState, at: string) {
  let changed = false;
  if (state.phase > 0 && !state.phaseArrivals?.[state.phase]) {
    state.phaseArrivals = { ...state.phaseArrivals, [state.phase]: at };
    changed = true;
  }
  const waits = state.userWaits ?? [];
  const open = waits.at(-1)?.to === undefined ? waits.at(-1) : undefined;
  const reason = userWaitReason(state);
  if (open && open.reason !== reason) {
    state.userWaits = waits.map((wait) => (wait === open ? { ...wait, to: at } : wait));
    changed = true;
  }
  if (reason && open?.reason !== reason) {
    state.userWaits = [...state.userWaits ?? [], { reason, from: at }];
    changed = true;
  }
  return changed;
}

function tokens(input: number, output: number, cacheRead: number, cacheWrite: number): TokenUsage {
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

function sumUsage(sessions: SessionUsage[]): SessionMetrics {
  const models = [...new Set(sessions.flatMap((session) => session.model ?? []))];
  return {
    ...tokens(
      sessions.reduce((sum, session) => sum + session.inputTokens, 0), sessions.reduce((sum, session) => sum + session.outputTokens, 0),
      sessions.reduce((sum, session) => sum + session.cacheReadTokens, 0), sessions.reduce((sum, session) => sum + session.cacheWriteTokens, 0),
    ),
    calls: sessions.reduce((sum, session) => sum + session.calls, 0),
    firstContext: sessions[0]?.firstContextTokens ?? 0,
    peakContext: sessions.reduce((peak, session) => Math.max(peak, session.peakContextTokens), 0),
    ...(models.length > 0 ? { model: models.join(", ") } : {}),
  };
}

/** `implementation-harness:developer` and `developer` are the same agent. */
function agentType(name: string) {
  return name.slice(name.lastIndexOf(":") + 1);
}

function tokenMetrics(state: RunState, usage: SessionUsage[]): RunMetrics["tokens"] {
  if (usage.length === 0) return undefined;
  const pilot = sumUsage(usage.filter((session) => !session.agentId));
  const agents: AgentMetrics[] = usage.filter((session) => session.agentId).map((session) => {
    const known = state.agents.find((agent) => agent.id === session.agentId);
    const activeMs = known ? span(time(known.startedAt), time(known.endedAt)) : 0;
    return {
      agentId: session.agentId!, name: agentType(known?.name ?? session.agentType ?? "agent"),
      ...sumUsage([session]), ...(activeMs > 0 ? { activeMs } : {}),
    };
  });
  const total = tokens(
    pilot.input + agents.reduce((sum, agent) => sum + agent.input, 0), pilot.output + agents.reduce((sum, agent) => sum + agent.output, 0),
    pilot.cacheRead + agents.reduce((sum, agent) => sum + agent.cacheRead, 0), pilot.cacheWrite + agents.reduce((sum, agent) => sum + agent.cacheWrite, 0),
  );
  return { total, pilot, agents, pilotShare: total.total > 0 ? pilot.total / total.total : 0 };
}

function timeMetrics(state: RunState, at: number): RunMetrics["time"] {
  const started = time(state.startedAt);
  const ended = Number.isFinite(time(state.endedAt)) ? time(state.endedAt) : at;
  const elapsedMs = span(started, ended);
  // A wait still open, or one the idle session raised after the workflow ended, stops at the end of the run.
  const spans = (state.userWaits ?? []).map((wait) => ({ reason: wait.reason, ms: span(time(wait.from), Math.min(wait.to ? time(wait.to) : ended, ended)) }));
  const waits = (["question", "session_prompt", "terminal"] as const).flatMap((reason) => {
    const matching = spans.filter((entry) => entry.reason === reason);
    return matching.length > 0 ? [{ reason, count: matching.length, ms: matching.reduce((sum, entry) => sum + entry.ms, 0) }] : [];
  });
  const userWaitMs = Math.min(elapsedMs, waits.reduce((sum, wait) => sum + wait.ms, 0));
  const incidentMs = (state.incidents ?? []).reduce((sum, incident) => sum + span(time(incident.detectedAt), Math.min(incident.resolution ? time(incident.resolution.at) : ended, ended)), 0);
  const arrivals = Object.entries(state.phaseArrivals ?? {}).map(([phase, enteredAt]) => ({ phase: Number(phase), enteredAt })).sort((left, right) => left.phase - right.phase);
  const phases = arrivals.map((arrival, index) => ({ ...arrival, ms: span(time(arrival.enteredAt), index + 1 < arrivals.length ? time(arrivals[index + 1].enteredAt) : ended) }));
  return { startedAt: state.startedAt, endedAt: state.endedAt, elapsedMs, userWaitMs, waits, activeMs: elapsedMs - userWaitMs, incidentMs, phases };
}

const REWORK_REPORT = /developer-report-rework[^/]*\.md$/;

export type MetricsInput = {
  state: RunState;
  usage: SessionUsage[];
  diff?: RunDiff;
  qaStatus?: string;
  /** When the figures are computed, which is where a run still going is measured up to. */
  at: string;
};

export function buildRunMetrics({ state, usage, diff, qaStatus, at }: MetricsInput): RunMetrics {
  const tasks = state.planTasks ?? [];
  const size = (letter: string) => tasks.filter((task) => task.complexity?.toUpperCase() === letter).length;
  const launches: Record<string, number> = {};
  for (const agent of state.agents) launches[agentType(agent.name)] = (launches[agentType(agent.name)] ?? 0) + 1;
  const delivery = state.workflow?.result?.delivery ?? (state.mergeRequestUrl ? "merge_request" : "none");
  const reviewTier = state.reviewTier ?? state.workflow?.reviewTier;
  const tokenFigures = tokenMetrics(state, usage);
  return {
    schemaVersion: 1,
    runId: state.id ?? "",
    computedAt: at,
    final: !state.sessionActive && !runInProgress(state.status),
    ...(state.harness ? { harness: state.harness } : {}),
    ticket: { issueUrl: state.issueUrl, ...(state.ticketTitle ? { title: state.ticketTitle } : {}), repository: sourceRepository(state) },
    outcome: {
      status: state.status, phase: state.phase, delivery,
      ...(state.mergeRequestUrl ? { mergeRequestUrl: state.mergeRequestUrl } : {}),
      questions: (state.userWaits ?? []).filter((wait) => wait.reason === "question").length,
      incidents: (state.incidents ?? []).map((incident) => incident.kind),
      ...(state.acceptance?.available ? { acceptance: state.acceptance.counts } : {}),
      ...(qaStatus ?? state.acceptance?.qa?.status ? { qaStatus: qaStatus ?? state.acceptance?.qa?.status } : {}),
      ...(state.worktree ? { worktree: state.worktree.state } : {}),
    },
    time: timeMetrics(state, new Date(at).getTime()),
    complexity: {
      tasks: tasks.length, sizes: { S: size("S"), M: size("M"), L: size("L") },
      criteria: state.acceptance?.available ? state.acceptance.counts.total : 0,
      ...(reviewTier !== undefined ? { reviewTier } : {}),
      ...(diff ? { diff } : {}),
    },
    rework: {
      launches,
      reworkDevelopers: state.artifacts.filter((artifact) => REWORK_REPORT.test(artifact)).length,
      lostAgents: state.agents.filter((agent) => agent.status === "failed" || agent.status === "abandoned").length,
    },
    ...(tokenFigures ? { tokens: tokenFigures } : {}),
  };
}

/** The size of a change from `git diff --numstat`: one line per file, a binary file counting for no line. */
export function diffFromNumstat(output: string): RunDiff {
  const lines = output.split("\n").map((line) => line.trim().split(/\s+/)).filter((fields) => fields.length >= 3);
  const lineCount = (value: string) => (/^\d+$/.test(value) ? Number(value) : 0);
  return { files: lines.length, insertions: lines.reduce((sum, fields) => sum + lineCount(fields[0]), 0), deletions: lines.reduce((sum, fields) => sum + lineCount(fields[1]), 0) };
}

export function median(values: number[]) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Fewer runs than this and a median says nothing: the comparison is not made. */
export const BASELINE_MINIMUM = 3;
/** How far over the median a figure has to be before it is worth a sentence. */
const OUTLIER_RATIO = 1.5;

/**
 * The runs a run is compared to: finished, delivered, and of the same review
 * tier when enough of them have one. A run that failed or was stopped has
 * figures of its own kind and would drag the medians down.
 */
export function comparableRuns(run: RunMetrics, others: RunMetrics[]): { runs: RunMetrics[]; scope: string } {
  const delivered = others.filter((other) => other.runId !== run.runId && other.final && other.outcome.status === "completed");
  const tier = run.complexity.reviewTier;
  const sameTier = tier === undefined ? [] : delivered.filter((other) => other.complexity.reviewTier === tier);
  return sameTier.length >= BASELINE_MINIMUM ? { runs: sameTier, scope: `palier de revue ${tier}` } : { runs: delivered, scope: "tous les runs livrés" };
}

export function metricsBaseline(run: RunMetrics, others: RunMetrics[]): MetricsBaseline {
  const { runs, scope } = comparableRuns(run, others);
  const measured = runs.filter((other) => other.tokens);
  return {
    runs: runs.length, scope,
    tokens: median(measured.map((other) => other.tokens!.total.total)),
    activeMs: median(runs.map((other) => other.time.activeMs)),
    userWaitMs: median(runs.map((other) => other.time.userWaitMs)),
    pilotCalls: median(measured.map((other) => other.tokens!.pilot.calls)),
    pilotShare: median(measured.map((other) => other.tokens!.pilotShare)),
  };
}

const millions = (value: number) => `${(value / 1_000_000).toFixed(2)} M`;
const minutes = (value: number) => `${Math.round(value / 60_000)} min`;

/**
 * What stands out in a run, against the median of the runs it compares to and
 * against itself. Empty below `BASELINE_MINIMUM` comparable runs, except for
 * what needs no comparison: rework and time under an incident.
 */
export function metricsFindings(run: RunMetrics, others: RunMetrics[]): MetricsFinding[] {
  const baseline = metricsBaseline(run, others);
  const findings: MetricsFinding[] = [];
  const against = (metric: string, value: number | undefined, reference: number | undefined, describe: (value: number, reference: number) => string) => {
    if (baseline.runs < BASELINE_MINIMUM || value === undefined || !reference) return;
    const ratio = value / reference;
    if (ratio >= OUTLIER_RATIO) findings.push({ metric, value, median: reference, ratio: Math.round(ratio * 100) / 100, detail: describe(value, reference) });
  };
  against("tokens", run.tokens?.total.total, baseline.tokens, (value, reference) => `${millions(value)} tokens, pour une médiane de ${millions(reference)} sur ${baseline.runs} runs (${baseline.scope}).`);
  against("activeMs", run.time.activeMs, baseline.activeMs, (value, reference) => `${minutes(value)} hors attente, pour une médiane de ${minutes(reference)}.`);
  against("pilotCalls", run.tokens?.pilot.calls, baseline.pilotCalls, (value, reference) => `${value} appels du pilote, pour une médiane de ${reference}.`);
  const rounds = Math.max(run.rework.launches["senior-reviewer"] ?? 0, run.rework.launches["qa-reviewer"] ?? 0);
  if (rounds > 1 || run.rework.reworkDevelopers > 0) {
    findings.push({ metric: "rework", value: Math.max(rounds - 1, run.rework.reworkDevelopers), median: 0, ratio: 0, detail: `${rounds} passes de revue et ${run.rework.reworkDevelopers} developer(s) de correction.` });
  }
  if (run.time.incidentMs > 60_000) findings.push({ metric: "incidentMs", value: run.time.incidentMs, median: 0, ratio: 0, detail: `${minutes(run.time.incidentMs)} sous un incident ouvert, sans rien qui fasse avancer le run.` });
  return findings;
}
