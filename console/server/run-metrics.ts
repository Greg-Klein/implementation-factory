import { defined } from "../lib/defined.js";
import { runInProgress, sourceRepository } from "./domain.js";
import type { SessionUsage } from "./engine/index.js";
import { CONFIDENCE_MAXIMUM } from "./review-confidence.js";
import type { AgentMetrics, ConfidenceCalibration, GateTimes, MetricsBaseline, MetricsFinding, RunDiff, RunMetrics, RunState, SessionMetrics, TokenUsage, UserWait, WorkflowState } from "./types.js";
import { declaredCompletion } from "./workflow-state.js";

/**
 * What a run cost and what it delivered, in figures. Pure: the run state, the
 * usage the engine read and the size of the change come in, `RunMetrics` comes
 * out. The files and git are in run-metrics-runtime.ts.
 *
 * Two figures are predictions and one is a fact. The plan's sizes and the
 * review tier come from the factory itself; the diff is what the ticket turned
 * out to be. Comparing a run to others by the first two alone would grade the
 * factory with its own estimate.
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

/**
 * Records a change asked after the final report. The workflow then goes from
 * `completed` back to work, and declares `completed` again once the change is
 * reviewed and pushed (see "A request after the final report" in
 * commands/implement.md). The console keeps the run as ended, but its figures
 * must run to that second end, or the work it took would count in the tokens
 * and in no duration. Returns whether anything moved.
 */
export function trackReopening(state: RunState, previous: WorkflowState | undefined, next: WorkflowState, at: string) {
  const reopenings = state.reopenings ?? [];
  const open = reopenings.at(-1)?.to === undefined ? reopenings.at(-1) : undefined;
  if (!open && state.endedAt && previous?.state === "completed" && next.state !== "completed") {
    state.reopenings = [...reopenings, { from: at }];
    return true;
  }
  if (open && declaredCompletion(next, state.mergeRequestUrl).complete) {
    state.reopenings = reopenings.map((reopening) => (reopening === open ? { ...reopening, to: at } : reopening));
    return true;
  }
  return false;
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

/** `implementation-factory:developer` and `developer` are the same agent. */
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
  const reopenings = (state.reopenings ?? []).map((reopening) => ({ from: time(reopening.from), to: reopening.to ? time(reopening.to) : at }));
  // The session idles between the end and a change asked later, sometimes for hours: only the work on either side counts.
  const windows = [{ from: started, to: ended }, ...reopenings];
  const within = (from: number, to: number) => windows.reduce((sum, window) => sum + span(Math.max(from, window.from), Math.min(to, window.to)), 0);
  const reopenedMs = reopenings.reduce((sum, reopening) => sum + span(reopening.from, reopening.to), 0);
  const elapsedMs = span(started, ended) + reopenedMs;
  const lastEnd = reopenings.reduce((last, reopening) => Math.max(last, reopening.to), ended);
  const spans = (state.userWaits ?? []).map((wait) => ({ reason: wait.reason, ms: within(time(wait.from), wait.to ? time(wait.to) : lastEnd) }));
  const waits = (["question", "session_prompt", "terminal"] as const).flatMap((reason) => {
    const matching = spans.filter((entry) => entry.reason === reason);
    return matching.length > 0 ? [{ reason, count: matching.length, ms: matching.reduce((sum, entry) => sum + entry.ms, 0) }] : [];
  });
  const userWaitMs = Math.min(elapsedMs, waits.reduce((sum, wait) => sum + wait.ms, 0));
  const incidentMs = (state.incidents ?? []).reduce((sum, incident) => sum + within(time(incident.detectedAt), incident.resolution ? time(incident.resolution.at) : lastEnd), 0);
  const arrivals = Object.entries(state.phaseArrivals ?? {}).map(([phase, enteredAt]) => ({ phase: Number(phase), enteredAt })).sort((left, right) => left.phase - right.phase);
  const phases = arrivals.map((arrival, index) => {
    const next = arrivals[index + 1];
    return { ...arrival, ms: span(time(arrival.enteredAt), next ? time(next.enteredAt) : ended) };
  });
  const endedAt = state.endedAt && lastEnd > ended ? new Date(lastEnd).toISOString() : state.endedAt;
  return {
    startedAt: state.startedAt, endedAt, elapsedMs, userWaitMs, waits, activeMs: elapsedMs - userWaitMs, incidentMs, phases,
    ...(reopenings.length > 0 ? { reopened: { count: reopenings.length, ms: reopenedMs } } : {}),
  };
}

const REWORK_REPORT = /developer-report-rework[^/]*\.md$/;

/**
 * What the stop gate's checks cost, from the content of its log: one JSON line
 * per check, timed since the gate writes `ms`. A line without it, written by an
 * older gate or for a check that never ran, counts for nothing.
 */
export function gateTimes(log: string): GateTimes | undefined {
  const steps = new Map<string, { step: string; runs: number; ms: number }>();
  for (const line of log.split("\n")) {
    let entry: { step?: unknown; ms?: unknown };
    try { entry = JSON.parse(line); } catch { continue; }
    if (!entry || typeof entry.step !== "string" || typeof entry.ms !== "number" || !Number.isFinite(entry.ms) || entry.ms < 0) continue;
    const known = steps.get(entry.step) ?? { step: entry.step, runs: 0, ms: 0 };
    steps.set(entry.step, { step: entry.step, runs: known.runs + 1, ms: known.ms + entry.ms });
  }
  if (steps.size === 0) return undefined;
  const sorted = [...steps.values()].sort((left, right) => right.ms - left.ms);
  return { ms: sorted.reduce((sum, step) => sum + step.ms, 0), steps: sorted };
}

export type MetricsInput = {
  state: RunState;
  usage: SessionUsage[];
  diff?: RunDiff;
  gate?: GateTimes;
  qaStatus?: string;
  /** When the figures are computed, which is where a run still going is measured up to. */
  at: string;
};

export function buildRunMetrics({ state, usage, diff, gate, qaStatus, at }: MetricsInput): RunMetrics {
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
    ...(state.factory ? { factory: state.factory } : {}),
    ticket: { issueUrl: state.issueUrl, ...(state.ticketTitle ? { title: state.ticketTitle } : {}), repository: sourceRepository(state) },
    outcome: {
      status: state.status, phase: state.phase, delivery,
      ...(state.mergeRequestUrl ? { mergeRequestUrl: state.mergeRequestUrl } : {}),
      questions: (state.userWaits ?? []).filter((wait) => wait.reason === "question").length,
      incidents: (state.incidents ?? []).map((incident) => incident.kind),
      ...(state.acceptance?.available ? { acceptance: state.acceptance.counts } : {}),
      ...defined({ qaStatus: (qaStatus ?? state.acceptance?.qa?.status) || undefined }),
      ...(state.worktree ? { worktree: state.worktree.state } : {}),
      ...defined({ confidence: state.confidence?.score, confidenceAtDelivery: state.confidenceAtDelivery, feedback: state.feedbackCount || undefined }),
    },
    time: { ...timeMetrics(state, new Date(at).getTime()), ...(gate ? { gate } : {}) },
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
  const lineCount = (value = "") => (/^\d+$/.test(value) ? Number(value) : 0);
  return { files: lines.length, insertions: lines.reduce((sum, fields) => sum + lineCount(fields[0]), 0), deletions: lines.reduce((sum, fields) => sum + lineCount(fields[1]), 0) };
}

export function median(values: number[]) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted[middle - 1];
  if (upper === undefined) return undefined;
  return sorted.length % 2 || lower === undefined ? upper : (lower + upper) / 2;
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
  return sameTier.length >= BASELINE_MINIMUM ? { runs: sameTier, scope: `review tier ${tier}` } : { runs: delivered, scope: "all delivered runs" };
}

export function metricsBaseline(run: RunMetrics, others: RunMetrics[]): MetricsBaseline {
  const { runs, scope } = comparableRuns(run, others);
  const measured = runs.filter((other) => other.tokens);
  return {
    runs: runs.length, scope,
    ...defined({
      tokens: median(measured.map((other) => other.tokens!.total.total)),
      activeMs: median(runs.map((other) => other.time.activeMs)),
      userWaitMs: median(runs.map((other) => other.time.userWaitMs)),
      pilotCalls: median(measured.map((other) => other.tokens!.pilot.calls)),
      pilotShare: median(measured.map((other) => other.tokens!.pilotShare)),
    }),
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
  against("tokens", run.tokens?.total.total, baseline.tokens, (value, reference) => `${millions(value)} tokens, against a median of ${millions(reference)} over ${baseline.runs} runs (${baseline.scope}).`);
  against("activeMs", run.time.activeMs, baseline.activeMs, (value, reference) => `${minutes(value)} outside waits, against a median of ${minutes(reference)}.`);
  against("pilotCalls", run.tokens?.pilot.calls, baseline.pilotCalls, (value, reference) => `${value} pilot calls, against a median of ${reference}.`);
  const rounds = Math.max(run.rework.launches["senior-reviewer"] ?? 0, run.rework.launches["qa-reviewer"] ?? 0);
  if (rounds > 1 || run.rework.reworkDevelopers > 0) {
    findings.push({ metric: "rework", value: Math.max(rounds - 1, run.rework.reworkDevelopers), median: 0, ratio: 0, detail: `${rounds} review rounds and ${run.rework.reworkDevelopers} rework developer(s).` });
  }
  if (run.time.incidentMs > 60_000) findings.push({ metric: "incidentMs", value: run.time.incidentMs, median: 0, ratio: 0, detail: `${minutes(run.time.incidentMs)} under an open incident, with nothing moving the run forward.` });
  return findings;
}

/**
 * What happened after delivery to the runs of each note, which is what says
 * whether the note means anything: a 5 that is reopened as often as a 2 does
 * not. Only what the console sees itself counts, a change asked after the final
 * report and feedback the user wrote. A note with fewer than `BASELINE_MINIMUM`
 * delivered runs is left out, and so is a run that was never given one.
 */
export function confidenceCalibration(runs: RunMetrics[]): ConfidenceCalibration {
  const delivered = runs.filter((run) => run.final && run.outcome.status === "completed" && run.outcome.confidenceAtDelivery !== undefined);
  const rows: ConfidenceCalibration = [];
  for (let score = 0; score <= CONFIDENCE_MAXIMUM; score += 1) {
    const scored = delivered.filter((run) => run.outcome.confidenceAtDelivery === score);
    if (scored.length < BASELINE_MINIMUM) continue;
    rows.push({ score, runs: scored.length, reopened: scored.filter((run) => (run.time.reopened?.count ?? 0) > 0).length, feedback: scored.filter((run) => (run.outcome.feedback ?? 0) > 0).length });
  }
  return rows;
}
