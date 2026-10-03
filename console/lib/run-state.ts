import type { AcceptanceCounts, IncidentAction, RunIncident, RunState, Status } from "./types";

export function activeAgents<T extends { status: string }>(agents: T[]) {
  return agents.filter((agent) => agent.status === "running");
}

export function isDemoRun(id?: string | null) {
  return typeof id === "string" && id.startsWith("demo-");
}

export function runInProgress(status: Status) {
  return status === "starting" || status === "running" || status === "attention";
}

/**
 * The workflow can be over with the engine session still open at its prompt
 * (`sessionActive`), and the conversation should stay usable for as long as that
 * session is, not just while a workflow phase is running.
 */
export function sessionAlive(status: Status, sessionActive?: boolean) {
  return runInProgress(status) || sessionActive === true;
}

/** Long enough to bridge two bursts of terminal output, short enough to fall silent as soon as the session does. */
const OUTPUT_IDLE_MS = 1_500;

/**
 * Claude Code writes a paragraph to its transcript only once the action that
 * followed it has returned, so the conversation can be a minute behind the
 * terminal. The output of the session is the only live signal that the message
 * on screen is not the last one, and saying so beats looking frozen.
 */
export function isWriting(alive: boolean, lastOutputAt: number, now: number) {
  return alive && now - lastOutputAt < OUTPUT_IDLE_MS;
}

/**
 * A branch, an agent or an artifact can only be recorded once a hook has fired,
 * and every hook payload names the transcript to read the dialogue from. An
 * empty conversation next to that kind of progress means the follower missed
 * the transcript, not that Claude is merely slow to write its next message: the
 * ordinary lag the "Claude réfléchit…" hint covers never reaches this point
 * empty-handed.
 */
export function isTranscriptStalled(messageCount: number, phase: number, agentCount: number, artifactCount: number) {
  return messageCount === 0 && (phase > 0 || agentCount > 0 || artifactCount > 0);
}

/** Mirrors DOCUMENT_EXTENSIONS in server/domain.ts. */
const DOCUMENT_EXTENSION = /\.(?:md|json|txt)$/i;

/**
 * The run's artifact list doubles as the read authorization of the artifacts
 * API, so it has to carry the evidence screenshots for the "Preuves" tab to be
 * allowed to load them. The document reader lists the same array, and a run
 * with a dozen captures buried its reports under them.
 */
export function generatedDocuments(artifacts: string[]) {
  return artifacts.filter((name) => DOCUMENT_EXTENSION.test(name));
}

export function pendingAnswerLabel(count: number) {
  return count === 1 ? "Claude attend une réponse" : `Claude attend ${count} réponses`;
}

/** How many decisions a run waits on: the questions of the workflow, or the one prompt its session opened on. */
export function pendingDecisions(run: { pendingQuestionCount: number; sessionPromptId?: string }) {
  return run.pendingQuestionCount || (run.sessionPromptId ? 1 : 0);
}

export function elapsedLabel(start: string, end: string | undefined, now: number) {
  const milliseconds = (end ? new Date(end).getTime() : now) - new Date(start).getTime();
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  return minutes ? `${minutes} min ${seconds.toString().padStart(2, "0")} s` : `${seconds} s`;
}

/**
 * How a run is named everywhere it is not alone: in the side list, in a
 * notification, in the reason a queued launch gives for waiting. The checkout is
 * what tells two runs apart at a glance, and the ticket number is what tells two
 * runs on the same checkout apart.
 */
export function runLabel(run: { cwd: string; issueUrl: string }) {
  const project = run.cwd.replace(/\/+$/, "").split("/").filter(Boolean).pop();
  const ticket = run.issueUrl.split(/[?#]/)[0].split("/").filter(Boolean).pop();
  const reference = ticket && /^\d+$/.test(ticket) ? `#${ticket}` : ticket;
  return [project, reference].filter(Boolean).join(" ") || run.issueUrl || "run";
}

/** Whether a run is finished and no longer holds its session: the only state it can be closed from. */
export function isClosable(run: { status: Status; sessionActive?: boolean }) {
  return !runInProgress(run.status) && run.sessionActive !== true;
}

/**
 * Whether a notice about a queued launch has stopped being true. The message
 * announces a wait, and the wait is over as soon as the entry leaves the queue,
 * started or cancelled: leaving it on screen tells the user their run is still
 * waiting while it is running under their eyes.
 */
export function noticeIsStale(notice: { queuedId?: string } | undefined, queued: { id: string }[]) {
  return notice?.queuedId !== undefined && !queued.some((entry) => entry.id === notice.queuedId);
}

/** A run whose workflow is over but whose agent session is still up, holding its checkout against the queue. */
export function holdsIdleSession(run: { status: Status; sessionActive?: boolean }) {
  return !runInProgress(run.status) && run.sessionActive === true;
}

/** What the row of a run says it is doing, in two or three words. */
export function statusLabel(status: Status) {
  if (status === "starting") return "Démarrage";
  if (status === "running") return "En cours";
  if (status === "attention") return "À toi de jouer";
  if (status === "completed") return "Terminé";
  if (status === "stopped") return "Arrêté";
  if (status === "failed") return "Erreur";
  return "Disponible";
}


export type StatusBadge = { label: string; tone: "decision" | "blocked" | "error" | "stopped" | "neutral" };

/**
 * The Progression badge of an open run. `attention` alone says someone should
 * look, not who: "À toi de jouer" is kept for a real question or a prompt in
 * the terminal, a run the monitor found with no next action reads as blocked
 * without implying a question was asked, and a lost session reads as an
 * interruption rather than an error of the workflow.
 */
export function runStatusBadge(run: Pick<RunState, "status" | "pendingQuestion" | "sessionPrompt" | "health" | "incidents">): StatusBadge {
  const incident = run.incidents?.findLast((entry) => entry.status === "open");
  if (incident?.kind === "lost_session" || run.health?.health === "interrupted") return { label: "Interrompu", tone: "error" };
  if (run.status === "attention") {
    const humanWait = Boolean(run.pendingQuestion) || Boolean(run.sessionPrompt) || (run.health?.health === "waiting" && (run.health.wait?.reason === "permission" || run.health.wait?.reason === "terminal_interaction"));
    if (!humanWait && incident) return { label: "Sans suite", tone: "blocked" };
    return { label: statusLabel(run.status), tone: "decision" };
  }
  if (run.status === "failed") return { label: statusLabel(run.status), tone: "error" };
  if (run.status === "stopped") return { label: statusLabel(run.status), tone: "stopped" };
  return { label: statusLabel(run.status), tone: "neutral" };
}

/** Where a run's documents are read from: an archived run has routes of its own, which never reach a live session. */
export function artifactUrl(run: { id: string | null; archived?: boolean }, path: string) {
  return `/api/${run.archived ? "archive/" : ""}artifacts?runId=${encodeURIComponent(run.id ?? "")}&path=${encodeURIComponent(path)}`;
}

export function acceptanceUrl(run: { id: string | null; archived?: boolean }) {
  return `/api/${run.archived ? "archive/" : ""}runs/${encodeURIComponent(run.id ?? "")}/acceptance`;
}

export type HealthNotice = { title: string; detail: string; tone: "error" | "attention" | "doubt"; incident?: RunIncident; actions: IncidentAction[] };

/** The waits worth a band of their own. A question has its panel, an agent at work needs nobody. */
const SHOWN_WAITS = new Set(["permission", "terminal_interaction", "unknown"]);

/**
 * What the incident band says for a run, or nothing when the run is simply
 * working. An open incident wins over the health it comes with; a doubt or a
 * wait on the terminal is said without claiming anything broke.
 */
export function healthNotice(run: Pick<RunState, "health" | "incidents" | "archived" | "sessionActive">): HealthNotice | undefined {
  const incident = run.incidents?.findLast((entry) => entry.status === "open");
  if (incident) return { title: incident.title, detail: incident.reason, tone: incident.kind === "lost_session" ? "error" : "attention", incident, actions: [] };
  const health = run.health;
  if (!health || run.archived) return undefined;
  const actions: IncidentAction[] = ["open_terminal"];
  if (health.health === "suspected_stall") return { title: health.title ?? "Aucune progression observée", detail: health.detail ?? "", tone: "doubt", actions };
  if (health.health === "waiting" && health.wait && SHOWN_WAITS.has(health.wait.reason)) return { title: health.title ?? "Claude Code demande ton attention", detail: health.detail ?? "", tone: "attention", actions };
  return undefined;
}

/** The actions of an incident that can actually run on this run, now. */
export function incidentActions(run: Pick<RunState, "id" | "status" | "sessionActive" | "archived" | "pendingQuestion">, incident: RunIncident): IncidentAction[] {
  if (incident.status !== "open") return [];
  // The simulated run has no session process, and is live for as long as it plays.
  const live = !run.archived && (run.sessionActive === true || (isDemoRun(run.id) && runInProgress(run.status)));
  return incident.suggestedActions.filter((action) => {
    if (action === "request_continuation" || action === "stop") return live;
    if (action === "open_terminal") return !run.archived;
    if (action === "answer") return Boolean(run.pendingQuestion);
    return action === "dismiss";
  });
}

/** The compact word a row of the side list shows for a run's health, when there is one to show. */
export function healthBadge(run: { health?: string; incident?: { title: string } }) {
  if (run.incident) return { label: run.incident.title, tone: run.health === "interrupted" ? "error" as const : "attention" as const };
  if (run.health === "suspected_stall") return { label: "Aucune progression observée", tone: "doubt" as const };
  return undefined;
}

/**
 * The acceptance figures a row of the side list can afford: verified over
 * total, coloured by the worst state left, with the full count in the tooltip.
 * Nothing without a registry: a run with no criteria is not "0/0 verified".
 */
export function acceptanceChip(counts: AcceptanceCounts | undefined) {
  if (!counts || counts.total === 0) return undefined;
  const parts = [`${counts.verified} critère${counts.verified > 1 ? "s" : ""} vérifié${counts.verified > 1 ? "s" : ""} sur ${counts.total}`];
  if (counts.failed) parts.push(`${counts.failed} en échec`);
  if (counts.blocked) parts.push(`${counts.blocked} bloqué${counts.blocked > 1 ? "s" : ""}`);
  if (counts.unverified) parts.push(`${counts.unverified} non vérifié${counts.unverified > 1 ? "s" : ""}`);
  const tone = counts.failed ? "error" as const : counts.blocked ? "attention" as const : counts.verified === counts.total ? "verified" as const : "neutral" as const;
  return { label: `${counts.verified}/${counts.total} AC`, title: parts.join(" · "), tone };
}
