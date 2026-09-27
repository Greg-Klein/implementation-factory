import type { Status } from "./types";

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

