import { closeAbandonedAgents, runInProgress } from "./domain.js";
import type { HealthInput, HealthVerdict, IncidentCandidate } from "./run-health.js";
import type { IncidentAction, IncidentDecision, RunIncident, RunState } from "./types.js";

/**
 * The life of an incident, kept apart from its detection: opened once per
 * stable cause, updated while that cause holds, resolved only on an event that
 * actually lifts it, and never reopened once the user dismissed it. Pure.
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
  if (input.status === "completed") return "Workflow terminé";
  if (input.status === "stopped") return "Run arrêté";
  if (input.status === "failed") return "Session terminée";
  if (verdict.wait?.reason === "user_question") return "Une question attend ta réponse";
  if (verdict.wait?.reason === "permission" || verdict.wait?.reason === "terminal_interaction") return "Claude Code attend une saisie dans le terminal";
  if (input.agents.some((agent) => agent.status === "running")) return "Un agent a démarré";
  const resumed = incident.continuation ? "Reprise observée après la demande de continuation" : "Claude Code a repris la main";
  const idleSince = input.signals.pilotIdleSince;
  if (idleSince === undefined) return resumed;
  if (incident.kind === "no_next_action" && incident.fingerprint !== `no_next_action:${idleSince}`) return `${resumed}, puis l'a rendue`;
  if (incident.kind === "missing_result" && verdict.incident?.fingerprint !== incident.fingerprint) return "Résultat reçu";
  if (incident.kind === "unresolvable_dependency") return "Plan corrigé";
  return "La cause n'est plus observée";
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
    const known = next.find((incident) => incident.fingerprint === candidate.fingerprint);
    if (!known) {
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
  if (!incident) return { ok: false, message: "Cet incident n'existe plus." };
  if (incident.decisions.some((decision) => decision.requestId === context.requestId)) return { ok: false, duplicate: true, message: "Cette action a déjà été prise en compte." };
  if (INTERFACE_ACTIONS.has(context.action)) return { ok: false, message: "Cette action n'a rien à faire côté serveur." };
  if (incident.status !== "open") return { ok: false, message: "La situation a changé : cet incident est déjà clos." };
  if (incident.revision !== context.expectedRevision) return { ok: false, message: "La situation a changé depuis l'affichage. Relis l'incident avant d'agir." };
  if (context.action === "dismiss") {
    if (!context.reason?.trim()) return { ok: false, message: "Dis en quelques mots pourquoi c'est un faux positif." };
    return { ok: true };
  }
  if (!context.live) return { ok: false, message: "Ce run n'a plus de session : seul le classement reste possible." };
  if (context.action === "stop") return context.input?.sessionActive ? { ok: true } : { ok: false, message: "La session n'est plus active." };
  if (context.action === "request_continuation") {
    const input = context.input;
    if (!input?.sessionActive) return { ok: false, message: "La session n'est plus active : rien ne peut reprendre." };
    if (incident.kind === "lost_session") return { ok: false, message: "Une session perdue ne peut pas reprendre." };
    if (incident.continuation) return { ok: false, duplicate: true, message: "La continuation a déjà été demandée." };
    const signals = input.signals;
    if (signals.pilotIdleSince === undefined) return { ok: false, message: "La situation a changé : Claude Code travaille de nouveau." };
    if (input.agents.some((agent) => agent.status === "running")) return { ok: false, message: "La situation a changé : un agent est actif." };
    if (signals.activeTools.length > 0 || signals.backgroundWaits.length > 0) return { ok: false, message: "La situation a changé : une commande est en cours." };
    if (input.pendingQuestion || signals.permission || signals.terminalInteraction || signals.unexplainedAttention) return { ok: false, message: "La situation a changé : Claude Code attend une réponse de ta part." };
    return { ok: true };
  }
  return { ok: false, message: "Action inconnue." };
}

export function withDecision(incident: RunIncident, decision: IncidentDecision): RunIncident {
  return { ...incident, decisions: [...incident.decisions.filter((entry) => entry.requestId !== decision.requestId), decision] };
}

/**
 * The instruction sent to a live session on "Demander la continuation": it
 * resumes where the workflow stands, it never restarts it.
 */
export const CONTINUATION_INSTRUCTION = [
  "Le harnais n'observe plus aucune action en cours sur ce run. Reprends le workflow là où il en est :",
  "relis le contexte courant, le plan, les rapports et preuves déjà écrits dans .claude/tasks, et l'état Git (branche, commits, fichiers modifiés),",
  "puis prends la prochaine action encore nécessaire. Conserve les fichiers de travail et les commits existants.",
  "Ne relance pas la commande initiale et ne repars pas de l'étape 1. Mets à jour workflow-state.json avant d'agir.",
  "Si tu attends quelque chose de moi, pose la question avec AskUserQuestion.",
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
  const incidents = Array.isArray(state.incidents) ? state.incidents.filter((incident): incident is RunIncident =>
    Boolean(incident) && typeof incident === "object" && typeof incident.id === "string" && typeof incident.kind === "string" && typeof incident.status === "string").map((incident) => ({
    ...incident,
    revision: typeof incident.revision === "number" ? incident.revision : 1,
    observations: Array.isArray(incident.observations) ? incident.observations : [],
    suggestedActions: Array.isArray(incident.suggestedActions) ? incident.suggestedActions : [],
    decisions: (Array.isArray(incident.decisions) ? incident.decisions : []).map((decision) => decision.outcome === "pending" ? { ...decision, outcome: "unknown" as const, detail: "Le serveur s'est arrêté avant de confirmer cette action : son issue est inconnue." } : decision),
  })) : [];
  return {
    id: state.id ?? runId, status: state.status, phase: typeof state.phase === "number" ? state.phase : 0, cwd: state.cwd,
    issueUrl: state.issueUrl ?? "", instruction: state.instruction ?? "", startedAt: state.startedAt ?? null, endedAt: state.endedAt ?? lastKnownActivityAt(state) ?? null,
    agents: Array.isArray(state.agents) ? state.agents : [], activities: Array.isArray(state.activities) ? state.activities : [],
    messages: Array.isArray(state.messages) ? state.messages : [], artifacts: Array.isArray(state.artifacts) ? state.artifacts : [],
    ...(state.branch ? { branch: state.branch } : {}), ...(state.mergeRequestUrl ? { mergeRequestUrl: state.mergeRequestUrl } : {}),
    ...(state.error ? { error: state.error } : {}), ...(state.ticketTitle ? { ticketTitle: state.ticketTitle } : {}),
    ...(state.planTasks ? { planTasks: state.planTasks } : {}), ...(state.planDelegations ? { planDelegations: state.planDelegations } : {}),
    ...(state.acceptance ? { acceptance: state.acceptance } : {}), ...(state.evidenceUpdatedAt ? { evidenceUpdatedAt: state.evidenceUpdatedAt } : {}),
    ...(state.workflow ? { workflow: state.workflow } : {}), ...(state.health ? { health: state.health } : {}),
    ...(state.artifactArrivals ? { artifactArrivals: state.artifactArrivals } : {}), ...(Array.isArray(state.reviewNotes) ? { reviewNotes: state.reviewNotes } : {}),
    // A question whose session is gone cannot be answered: its text stays, in the incident, as context.
    pendingQuestion: undefined,
    sessionActive: false,
    incidents,
    schemaVersion: RUN_SCHEMA_VERSION,
  };
}

/**
 * The run a restart found in progress: closed as interrupted, with one
 * interruption incident however many times the console restarts over it.
 */
export function interruptRun(state: RunState, now: string): RunState {
  const incidents = state.incidents ?? [];
  const hasInterruption = incidents.some((incident) => incident.kind === "lost_session");
  const question = state.pendingQuestion?.questions.map((entry) => entry.question).join(" · ");
  const incident: RunIncident = {
    id: `incident-${crypto.randomUUID().slice(0, 8)}`, runId: state.id ?? "", kind: "lost_session", status: "open", revision: 1,
    detectedAt: now, updatedAt: now, fingerprint: "lost_session:restart",
    title: "Session interrompue",
    reason: "Le serveur du harnais s'est arrêté pendant que ce run était en cours : la session Claude Code a disparu avec lui, et son issue réelle n'a jamais été enregistrée.",
    observations: [
      { kind: "restart", at: now, detail: "Run trouvé en cours au redémarrage de la console." },
      { kind: "phase", detail: `Dernière phase atteinte : ${state.phase}/10.` },
      ...(state.activities[0] ? [{ kind: "activity", at: state.activities[0].at, detail: `Dernier événement : ${state.activities[0].title}.` }] : []),
      ...(question ? [{ kind: "question", detail: `Question restée sans réponse : ${question}` }] : []),
    ],
    expectedNextAction: "Consulter le diagnostic, puis relancer le ticket si le travail doit continuer.",
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
    error: state.error ?? "Le serveur du harnais a redémarré ou s'est arrêté pendant que ce run était en cours ; son issue réelle n'a jamais été enregistrée.",
    health: { health: "interrupted", title: "Session interrompue", detail: incident.reason, evaluatedAt: now },
    incidents: hasInterruption ? incidents : [...incidents, incident],
    schemaVersion: RUN_SCHEMA_VERSION,
  };
}
