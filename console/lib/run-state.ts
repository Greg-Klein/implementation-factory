import { ticketReference } from "./ticket-urls";
import type { AcceptanceCounts, IncidentAction, QueuedRunView, RunIncident, RunState, RunWorktree, Status } from "./types";

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
 * notification, in the reason a queued launch gives for waiting. The repository
 * is what tells two runs apart at a glance, and the ticket number is what tells
 * two runs of the same repository apart. Named after the repository the ticket
 * was launched on, never after `cwd`: that is a worktree, whose directory is the run id.
 */
export function runLabel(run: { cwd: string; repository?: string; issueUrl: string }) {
  const project = sourceRepository(run).replace(/\/+$/, "").split("/").filter(Boolean).pop();
  const ticket = run.issueUrl.split(/[?#]/)[0].split("/").filter(Boolean).pop();
  const reference = ticket && /^\d+$/.test(ticket) ? `#${ticket}` : ticket;
  return [project, reference].filter(Boolean).join(" ") || run.issueUrl || "run";
}

/** A proposed ticket has no checkout yet: it is named by the project of its address, `companion #247`. */
export function proposalLabel(issueUrl: string) {
  const project = issueUrl.split("/-/")[0].split("/").filter(Boolean).pop();
  return [project, ticketReference(issueUrl)].filter(Boolean).join(" ");
}

/** The checkout a run was launched on. A run archived before worktrees ran in that checkout itself. */
export function sourceRepository(run: { cwd: string; repository?: string }) {
  return run.repository || run.cwd;
}

/**
 * What the run panel says of the worktree: where it is while a session works
 * in it, why it is still there once the session is gone, or that it is gone.
 * The path is given from the repository, which the line above already names.
 */
export function worktreeLabel(run: { cwd: string; repository?: string; worktree?: RunWorktree }) {
  const worktree = run.worktree;
  if (!worktree) return undefined;
  if (worktree.state === "removed") return worktree.detail ?? "Worktree supprimé";
  if (worktree.state === "kept") return worktree.detail ?? "Worktree conservé";
  const repository = sourceRepository(run).replace(/\/+$/, "");
  return worktree.path.startsWith(`${repository}/`) ? worktree.path.slice(repository.length + 1) : worktree.path;
}

/** Whether the removal of the worktree can be offered: it is still on disk and no session works in it. */
export function canRemoveWorktree(run: { status: Status; sessionActive?: boolean; worktree?: RunWorktree }) {
  return run.worktree?.state === "kept" && !sessionAlive(run.status, run.sessionActive);
}

/** A merge request the way it is called, `MR !12`. */
export function mergeRequestLabel(mergeRequestUrl: string | undefined) {
  const number = mergeRequestUrl?.split(/[?#]/)[0].split("/").filter(Boolean).pop();
  return number && /^\d+$/.test(number) ? `MR !${number}` : "MR";
}

type QueueWait = Pick<QueuedRunView, "reason"> & Partial<Pick<QueuedRunView, "blocking" | "forced">>;

/** Why a queued launch waits, in the few words its row has room for. */
export function queueReason(entry: QueueWait) {
  const other = entry.blocking ? ticketReference(entry.blocking.issueUrl) : "un autre ticket";
  if (entry.reason === "ticket") return "ticket déjà en cours";
  if (entry.reason === "analysis") return "analyse en cours";
  if (entry.reason === "conflict") return `conflit avec ${other} en cours`;
  if (entry.reason === "merge") return `attend que la ${mergeRequestLabel(entry.blocking?.mergeRequestUrl)} soit mergée (${other})`;
  if (entry.reason === "merge_unknown") return `état de la ${mergeRequestLabel(entry.blocking?.mergeRequestUrl)} inconnu (${other})`;
  if (entry.reason === "dependency") return `dépend de ${other}, encore en file`;
  if (entry.reason === "order") return `passe après ${other}`;
  if (entry.forced?.mode === "stacked") return `départ empilé sur ${entry.forced.baseBranch}, dès qu’une place est libre`;
  if (entry.forced) return "départ forcé, dès qu’une place est libre";
  return "toutes les places sont prises";
}

/** The line a queued row shows: what it waits for, or that its batch is still being analysed. */
export function queueStatus(entry: QueueWait) {
  if (entry.reason === "analysis") return "Analyse en cours";
  if (entry.reason === "merge" || entry.reason === "merge_unknown" || entry.reason === "dependency" || entry.reason === "order" || entry.forced) {
    const reason = queueReason(entry);
    return reason.charAt(0).toUpperCase() + reason.slice(1);
  }
  return `En attente, ${queueReason(entry)}`;
}

/** Whether the schedule holds the entry, as opposed to a slot or its own ticket: only then is there something to override. */
export function heldBySchedule(entry: Pick<QueuedRunView, "reason">) {
  return entry.reason !== "slot" && entry.reason !== "ticket";
}

/** What a queued row says of the ticket's own prediction, when it changes how the ticket is scheduled. */
export function scheduleMark(entry: Pick<QueuedRunView, "analysisFailure" | "confidence">) {
  if (entry.analysisFailure) return { label: "Analyse en échec", title: `Analyse en échec : ${entry.analysisFailure}. Ce ticket passe seul sur son dépôt.` };
  if (entry.confidence === "low") return { label: "Prédiction peu fiable", title: "Le ticket ne dit pas assez ce qu’il touche. Il passe seul sur son dépôt." };
  return undefined;
}

export type QueueGroup<T> = { key: string; batchId?: string; queuedAt: string; count: number; repositories: { repository: string; name: string; entries: T[] }[] };

/**
 * The queue as it is shown: by batch, then by repository, each in the order
 * its first entry was asked. A launch made alone is a group of its own.
 */
export function queueGroups<T extends { id: string; cwd: string; repository?: string; batchId?: string; queuedAt: string }>(queued: T[]): QueueGroup<T>[] {
  const groups: QueueGroup<T>[] = [];
  for (const entry of queued) {
    const key = entry.batchId ?? entry.id;
    let group = groups.find((candidate) => candidate.key === key);
    if (!group) groups.push(group = { key, ...(entry.batchId ? { batchId: entry.batchId } : {}), queuedAt: entry.queuedAt, count: 0, repositories: [] });
    const repository = sourceRepository(entry);
    let bucket = group.repositories.find((candidate) => candidate.repository === repository);
    if (!bucket) group.repositories.push(bucket = { repository, name: repository.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? repository, entries: [] });
    bucket.entries.push(entry);
    group.count += 1;
  }
  return groups;
}

/**
 * Where a row goes when it is moved one step among the rows shown with it, as
 * the `before` of a `queue.move`: the entry it lands in front of, null for the
 * end of the queue, undefined when it cannot move that way.
 */
export function queueMoveTarget(queued: { id: string }[], siblings: { id: string }[], id: string, direction: "up" | "down"): string | null | undefined {
  const position = siblings.findIndex((entry) => entry.id === id);
  if (position < 0) return undefined;
  if (direction === "up") return position === 0 ? undefined : siblings[position - 1].id;
  const next = siblings[position + 1];
  if (!next) return undefined;
  const others = queued.filter((entry) => entry.id !== id);
  return others[others.findIndex((entry) => entry.id === next.id) + 1]?.id ?? null;
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

/** A run whose workflow is over but whose agent session is still up, holding its slot and its ticket against the queue. */
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
