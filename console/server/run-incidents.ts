import { closeAbandonedAgents, reopeningOpen, runInProgress } from "./domain.js";
import { isLanguage } from "../lib/i18n/index.js";
import { texts } from "../lib/i18n/texts.js";
import { runLanguage } from "./language.js";
import { storedConfidence } from "./review-confidence.js";
import type { Language } from "../lib/i18n/index.js";
import type { HealthInput, HealthVerdict, IncidentCandidate } from "./run-health.js";
import type { IncidentAction, IncidentDecision, RunIncident, RunState } from "./types.js";

/**
 * The life of an incident, kept apart from its detection: opened once per
 * stable cause, updated while that cause holds, resolved only on an event that
 * actually lifts it, opened again when a resolved cause comes back, and never
 * reopened once the user dismissed it. Pure.
 */

export const RUN_SCHEMA_VERSION = 2;

export type IncidentTransition = { incidents: RunIncident[]; opened: RunIncident[]; resolved: RunIncident[]; changed: boolean };

function sameObservations(left: RunIncident["observations"], right: RunIncident["observations"]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Why an open incident no longer holds, read from the verdict that replaced
 * it. Only structured signals reach the verdict, so terminal output alone can
 * never resolve anything.
 */
export function resolutionOutcome(incident: RunIncident, input: HealthInput, verdict: HealthVerdict) {
  const t = texts(input.language ?? "en").serverOps;
  if (input.status === "completed") return t.outcomeWorkflowCompleted;
  if (input.status === "stopped") return t.outcomeRunStopped;
  if (input.status === "paused") return t.outcomeRunPaused;
  if (input.status === "failed") return t.outcomeSessionEnded;
  if (verdict.wait?.reason === "user_question") return t.outcomeQuestionWaiting;
  if (verdict.wait?.reason === "permission" || verdict.wait?.reason === "terminal_interaction") return t.outcomeWaitingTerminal;
  if (input.agents.some((agent) => agent.status === "running")) return t.outcomeAgentStarted;
  const resumed = incident.continuation ? t.outcomeResumedAfterRequest : t.outcomeResumed;
  const idleSince = input.signals.pilotIdleSince;
  if (idleSince === undefined) return resumed;
  if (incident.kind === "no_next_action" && incident.fingerprint !== `no_next_action:${idleSince}`) return t.outcomeThenHandedBack(resumed);
  if (incident.kind === "missing_result" && verdict.incident?.fingerprint !== incident.fingerprint) return t.outcomeResultReceived;
  if (incident.kind === "unresolvable_dependency") return t.outcomePlanFixed;
  return t.outcomeCauseGone;
}

/**
 * Applies one verdict to the incidents of a run. A lost session is never
 * resolved by the detector: nothing that happens afterwards brings it back.
 */
export function reconcileIncidents(incidents: RunIncident[], candidate: IncidentCandidate | undefined, context: { runId: string; now: string; outcome: (incident: RunIncident) => string }): IncidentTransition {
  const opened: RunIncident[] = [];
  const resolved: RunIncident[] = [];
  let changed = false;
  let next = incidents.map((incident) => {
    if (incident.status !== "open" || incident.kind === "lost_session" || incident.fingerprint === candidate?.fingerprint) return incident;
    const done: RunIncident = { ...incident, status: "resolved", revision: incident.revision + 1, updatedAt: context.now, resolution: { at: context.now, outcome: context.outcome(incident) } };
    resolved.push(done);
    changed = true;
    return done;
  });
  if (candidate) {
    // The latest one under this fingerprint speaks for the cause: a resolved
    // incident whose cause is observed again is a new incident, or the run sits
    // stalled with nothing open, no notification and no way to resume it.
    const known = next.findLast((incident) => incident.fingerprint === candidate.fingerprint);
    if (!known || known.status === "resolved") {
      const incident: RunIncident = {
        id: `incident-${crypto.randomUUID().slice(0, 8)}`, runId: context.runId, kind: candidate.kind, status: "open", revision: 1,
        detectedAt: context.now, updatedAt: context.now, fingerprint: candidate.fingerprint, title: candidate.title, reason: candidate.reason,
        observations: candidate.observations, ...(candidate.expectedNextAction ? { expectedNextAction: candidate.expectedNextAction } : {}),
        suggestedActions: candidate.suggestedActions, decisions: [],
      };
      next = [...next, incident];
      opened.push(incident);
      changed = true;
    } else if (known.status === "open" && (!sameObservations(known.observations, candidate.observations) || known.reason !== candidate.reason)) {
      next = next.map((incident) => incident === known ? { ...incident, observations: candidate.observations, reason: candidate.reason, revision: incident.revision + 1, updatedAt: context.now } : incident);
      changed = true;
    }
  }
  return { incidents: next, opened, resolved, changed };
}

export function openIncident(incidents: RunIncident[] | undefined) {
  return incidents?.findLast((incident) => incident.status === "open");
}

export type ActionContext = {
  incident: RunIncident | undefined;
  expectedRevision: number;
  requestId: string;
  action: IncidentAction;
  reason?: string;
  live: boolean;
  input?: HealthInput;
  /** The run's language, for the message of a refusal. English when absent. */
  language?: Language;
};

export type ActionCheck = { ok: true } | { ok: false; duplicate?: boolean; message: string };

/** Actions that only move the interface: the server has nothing to do for them. */
const INTERFACE_ACTIONS = new Set<IncidentAction>(["answer", "open_terminal", "view_diagnostic"]);

/**
 * Whether an action may run now, checked on the server against the state it
 * holds right before the effect: a click made on an older state is refused,
 * and a request already seen, from this page or another, is not run twice.
 */
export function checkIncidentAction(context: ActionContext): ActionCheck {
  const incident = context.incident;
  const t = texts(context.language ?? context.input?.language ?? "en").serverOps;
  if (!incident) return { ok: false, message: t.actionNoIncident };
  if (incident.decisions.some((decision) => decision.requestId === context.requestId)) return { ok: false, duplicate: true, message: t.actionDuplicate };
  if (INTERFACE_ACTIONS.has(context.action)) return { ok: false, message: t.actionInterfaceOnly };
  if (incident.status !== "open") return { ok: false, message: t.actionIncidentClosed };
  if (incident.revision !== context.expectedRevision) return { ok: false, message: t.actionStale };
  if (context.action === "dismiss") {
    if (!context.reason?.trim()) return { ok: false, message: t.actionDismissReason };
    return { ok: true };
  }
  if (!context.live) return { ok: false, message: t.actionNoSession };
  if (context.action === "stop") return context.input?.sessionActive ? { ok: true } : { ok: false, message: t.actionSessionInactive };
  if (context.action === "request_continuation") {
    const input = context.input;
    if (!input?.sessionActive) return { ok: false, message: t.actionNothingToResume };
    if (incident.kind === "lost_session") return { ok: false, message: t.actionLostSessionNoResume };
    if (incident.continuation) return { ok: false, duplicate: true, message: t.actionContinuationRequested };
    const signals = input.signals;
    if (signals.pilotIdleSince === undefined) return { ok: false, message: t.actionWorkingAgain };
    if (input.agents.some((agent) => agent.status === "running")) return { ok: false, message: t.actionAgentActive };
    if (signals.activeTools.length > 0 || signals.backgroundWaits.length > 0) return { ok: false, message: t.actionCommandRunning };
    if (input.pendingQuestion || signals.permission || signals.terminalInteraction || signals.unexplainedAttention) return { ok: false, message: t.actionWaitingOnYou };
    return { ok: true };
  }
  return { ok: false, message: t.actionUnknown };
}

export function withDecision(incident: RunIncident, decision: IncidentDecision): RunIncident {
  return { ...incident, decisions: [...incident.decisions.filter((entry) => entry.requestId !== decision.requestId), decision] };
}

/**
 * The instruction sent to a live session on "Request continuation": it
 * resumes where the workflow stands, it never restarts it.
 */
export const CONTINUATION_INSTRUCTION = [
  "The factory no longer observes any action in progress on this run. Resume the workflow where it stands:",
  "read again the current context, the plan, the reports and evidence already written in .claude/tasks, and the Git state (branch, commits, modified files),",
  "then take the next action still needed. Keep the existing working files and commits.",
  "Do not rerun the initial command and do not start again from step 1. Update workflow-state.json before acting.",
  "If you are waiting for something from me, ask the question with AskUserQuestion.",
].join(" ");

/**
 * When a run was last seen doing anything: its latest activity, message or
 * agent event. A run whose session died with the server has no end of its own,
 * and dating it at the restart would count the hours the console was down as
 * time the run spent working.
 */
export function lastKnownActivityAt(state: Pick<Partial<RunState>, "startedAt" | "activities" | "messages" | "agents">): string | undefined {
  const stamps = [
    state.startedAt,
    ...(state.activities ?? []).map((activity) => activity.at),
    ...(state.messages ?? []).map((message) => message.at),
    ...(state.agents ?? []).flatMap((agent) => [agent.startedAt, agent.endedAt]),
  ].filter((value): value is string => typeof value === "string" && Number.isFinite(new Date(value).getTime()));
  if (!stamps.length) return undefined;
  return stamps.reduce((latest, value) => new Date(value).getTime() > new Date(latest).getTime() ? value : latest);
}

/**
 * An archive read back after a restart: every field it may lack filled, and
 * nothing claiming to be live. A decision that was written but never
 * confirmed has an unknown outcome, and stays that way.
 */
export function normalizeArchivedRun(raw: unknown, runId: string): RunState | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const state = raw as Partial<RunState>;
  if (typeof state.status !== "string" || typeof state.cwd !== "string") return undefined;
  const t = texts(isLanguage(state.language) ? state.language : runLanguage({})).serverOps;
  const incidents = Array.isArray(state.incidents) ? state.incidents.filter((incident): incident is RunIncident =>
    Boolean(incident) && typeof incident === "object" && typeof incident.id === "string" && typeof incident.kind === "string" && typeof incident.status === "string").map((incident) => ({
    ...incident,
    revision: typeof incident.revision === "number" ? incident.revision : 1,
    observations: Array.isArray(incident.observations) ? incident.observations : [],
    suggestedActions: Array.isArray(incident.suggestedActions) ? incident.suggestedActions : [],
    decisions: (Array.isArray(incident.decisions) ? incident.decisions : []).map((decision) => decision.outcome === "pending" ? { ...decision, outcome: "unknown" as const, detail: t.decisionOutcomeUnknown } : decision),
  })) : [];
  return {
    // A pause lives only as long as its session, and an archive has none.
    id: state.id ?? runId, status: state.status === "paused" ? "stopped" : state.status, phase: typeof state.phase === "number" ? state.phase : 0, cwd: state.cwd,
    issueUrl: state.issueUrl ?? "", instruction: state.instruction ?? "", startedAt: state.startedAt ?? null, endedAt: state.endedAt ?? lastKnownActivityAt(state) ?? null,
    agents: Array.isArray(state.agents) ? state.agents : [], activities: Array.isArray(state.activities) ? state.activities : [],
    messages: Array.isArray(state.messages) ? state.messages : [], artifacts: Array.isArray(state.artifacts) ? state.artifacts : [],
    ...(state.branch ? { branch: state.branch } : {}), ...(state.mergeRequestUrl ? { mergeRequestUrl: state.mergeRequestUrl } : {}),
    ...(state.error ? { error: state.error } : {}), ...(state.ticketTitle ? { ticketTitle: state.ticketTitle } : {}),
    ...(state.planTasks ? { planTasks: state.planTasks } : {}), ...(state.planDelegations ? { planDelegations: state.planDelegations } : {}),
    ...(state.acceptance ? { acceptance: state.acceptance } : {}), ...(state.evidenceUpdatedAt ? { evidenceUpdatedAt: state.evidenceUpdatedAt } : {}),
    ...(state.workflow ? { workflow: state.workflow } : {}), ...(state.health ? { health: state.health } : {}),
    ...(typeof state.repository === "string" && state.repository ? { repository: state.repository } : {}),
    ...(state.worktree && typeof state.worktree.path === "string" && typeof state.worktree.state === "string" ? { worktree: state.worktree } : {}),
    ...(state.archiveSyncedAt ? { archiveSyncedAt: state.archiveSyncedAt } : {}),
    ...(state.artifactArrivals ? { artifactArrivals: state.artifactArrivals } : {}), ...(Array.isArray(state.reviewNotes) ? { reviewNotes: state.reviewNotes } : {}),
    // What the run's figures are measured from: a restart rewrites the archive from this state.
    ...(Array.isArray(state.userWaits) ? { userWaits: state.userWaits } : {}), ...(state.phaseArrivals ? { phaseArrivals: state.phaseArrivals } : {}),
    ...(Array.isArray(state.reopenings) ? { reopenings: state.reopenings } : {}), ...(state.reviewTier !== undefined ? { reviewTier: state.reviewTier } : {}), ...(isLanguage(state.language) ? { language: state.language } : {}),
    ...(state.factory ? { factory: state.factory } : {}), ...(state.baseCommit ? { baseCommit: state.baseCommit } : {}),
    ...(state.baseBranch ? { baseBranch: state.baseBranch } : {}), ...(state.ticketBaseBranch ? { ticketBaseBranch: state.ticketBaseBranch } : {}),
    ...(state.transcriptPath ? { transcriptPath: state.transcriptPath } : {}),
    // The note the interface shows and the calibration counts: figures written again after a restart are built from this state.
    ...storedConfidence(state),
    // A question whose session is gone cannot be answered: its text stays, in the incident, as context.
    pendingQuestion: undefined,
    sessionActive: false,
    incidents,
    schemaVersion: RUN_SCHEMA_VERSION,
  };
}

/**
 * The run a restart found in progress: closed as interrupted, with one
 * interruption incident however many times the console restarts over it. A run
 * reopened after its final report is closed as the delivered run it was.
 */
export function interruptRun(state: RunState, now: string): RunState {
  // A change asked after the final report that the restart left undone does not take back what the run delivered.
  if (reopeningOpen(state) && state.endedAt) {
    return { ...state, status: "completed", sessionActive: false, pendingQuestion: undefined, sessionPrompt: undefined, action: undefined, agents: closeAbandonedAgents(state.agents ?? [], now).agents, schemaVersion: RUN_SCHEMA_VERSION };
  }
  const t = texts(runLanguage(state)).serverOps;
  const incidents = state.incidents ?? [];
  const hasInterruption = incidents.some((incident) => incident.kind === "lost_session");
  const question = state.pendingQuestion?.questions.map((entry) => entry.question).join(" · ");
  const incident: RunIncident = {
    id: `incident-${crypto.randomUUID().slice(0, 8)}`, runId: state.id ?? "", kind: "lost_session", status: "open", revision: 1,
    detectedAt: now, updatedAt: now, fingerprint: "lost_session:restart",
    title: t.sessionInterrupted,
    reason: t.restartReason,
    observations: [
      { kind: "restart", at: now, detail: t.restartObservation },
      { kind: "phase", detail: t.lastPhaseReached(state.phase) },
      ...(state.activities[0] ? [{ kind: "activity", at: state.activities[0].at, detail: t.lastEvent(state.activities[0].title) }] : []),
      ...(question ? [{ kind: "question", detail: t.questionLeftUnanswered(question) }] : []),
    ],
    expectedNextAction: t.readDiagnosticThenRelaunch,
    suggestedActions: ["view_diagnostic", "dismiss"],
    decisions: [],
  };
  return {
    ...state,
    status: runInProgress(state.status) ? "failed" : state.status,
    endedAt: state.endedAt ?? lastKnownActivityAt(state) ?? now,
    sessionActive: false,
    pendingQuestion: undefined,
    sessionPrompt: undefined,
    action: undefined,
    agents: closeAbandonedAgents(state.agents ?? [], now).agents,
    error: state.error ?? t.restartRunError,
    health: { health: "interrupted", title: t.sessionInterrupted, detail: incident.reason, evaluatedAt: now },
    incidents: hasInterruption ? incidents : [...incidents, incident],
    schemaVersion: RUN_SCHEMA_VERSION,
  };
}
