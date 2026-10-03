import { pendingAnswerLabel, pendingDecisions, runInProgress, runLabel } from "./run-state";
import type { RunSummary } from "./types";

/** Two cues, the distinction the workflow has always made: something is expected of you, or the run is over. */
export type AlertCue = "attention" | "done";
export type RunAlert = { tag: string; title: string; body: string; cue: AlertCue; runId: string };

const NAME = "Implementation Harness";

/**
 * A run lasts long enough to be left alone, so the harness has to call the user
 * back. Only transitions raise an alert: a reconnection replays the current
 * state, and replaying it must not ring a second time.
 *
 * Read from the summary rather than from the open run: with several runs going,
 * the one that needs the user is rarely the one on screen, and an alert that
 * only fired for the visible run left the other two silent.
 */
export function runAlert(previous: RunSummary | undefined, next: RunSummary): RunAlert | undefined {
  if (!previous || previous.id !== next.id) return undefined;
  const where = runLabel(next);
  if (next.pendingQuestionCount > 0 && previous.pendingQuestionCount === 0)
    return { runId: next.id, tag: `question-${next.pendingQuestionId}`, title: pendingAnswerLabel(next.pendingQuestionCount), body: `${where} · le workflow attend ta décision pour continuer.`, cue: "attention" };
  if (next.sessionPromptId && next.sessionPromptId !== previous.sessionPromptId)
    return { runId: next.id, tag: `session-prompt-${next.sessionPromptId}`, title: "Claude Code demande de faire confiance au dossier", body: `${where} · la session ne démarre pas sans ta décision.`, cue: "attention" };
  if (next.status === "completed" && runInProgress(previous.status))
    return { runId: next.id, tag: `completed-${next.id}`, title: `Workflow terminé · ${where}`, body: next.mergeRequestUrl ?? "Le run est allé au bout.", cue: "done" };
  // A failed run is over too, and what happens next is the user's call either
  // way: the workflow has always used the same cue for both.
  if (next.status === "failed" && runInProgress(previous.status))
    return { runId: next.id, tag: `failed-${next.id}`, title: `Le run a échoué · ${where}`, body: next.error ?? "La session s'est interrompue.", cue: "done" };
  // A stop the user asked for is over too, but it never went all the way: it
  // must never read like the "completed" case above.
  if (next.status === "stopped" && runInProgress(previous.status))
    return { runId: next.id, tag: `stopped-${next.id}`, title: `Run arrêté · ${where}`, body: next.error ?? "Tu as arrêté la session avant la fin du workflow.", cue: "done" };
  // One alert per incident, whatever else changed with it: its opening is the news.
  if (next.incident && next.incident.id !== previous.incident?.id && next.pendingQuestionCount === 0)
    return { runId: next.id, tag: `incident-${next.incident.id}`, title: `${next.incident.title} · ${where}`, body: "Ouvre le run pour voir ce qui a été observé et ce que tu peux faire.", cue: "attention" };
  if (next.pendingQuestionCount === 0 && next.status === "attention" && previous.status !== "attention")
    return { runId: next.id, tag: `attention-${next.id}`, title: "Claude Code attend ton attention", body: `${where} · le run est en pause tant que tu n'as pas repris la main.`, cue: "attention" };
  // A doubt is worth one call, never on a run already waiting for the user: that one was called already.
  if (next.health === "suspected_stall" && previous.health !== "suspected_stall" && next.status !== "attention" && next.pendingQuestionCount === 0)
    return { runId: next.id, tag: `suspected-${next.id}`, title: `Aucune progression observée · ${where}`, body: "Un doute, pas un verdict : rien n’a été arrêté ni relancé.", cue: "attention" };
  return undefined;
}

/** Every alert raised between two lists of runs, whichever run the page is showing. */
export function runAlerts(previous: RunSummary[], next: RunSummary[]): RunAlert[] {
  const before = new Map(previous.map((run) => [run.id, run]));
  return next.flatMap((run) => {
    const alert = runAlert(before.get(run.id), run);
    return alert ? [alert] : [];
  });
}

/**
 * The tab is the only thing left of the harness once the window is behind
 * another one, and it now stands for every run at once: what it has to say is
 * the most demanding state across all of them, and how many runs are in it.
 */
export function documentTitle(runs: RunSummary[]) {
  const waiting = runs.filter((run) => pendingDecisions(run) > 0);
  if (waiting.length === 1) return `● ${pendingAnswerLabel(pendingDecisions(waiting[0]))} · ${NAME}`;
  if (waiting.length > 1) return `● ${waiting.length} runs attendent une réponse · ${NAME}`;
  const attention = runs.filter((run) => run.status === "attention").length;
  if (attention > 0) return `● Attention requise${attention > 1 ? ` (${attention})` : ""} · ${NAME}`;
  const active = runs.filter((run) => runInProgress(run.status)).length;
  if (active > 0) return `${active} run${active > 1 ? "s" : ""} en cours · ${NAME}`;
  if (runs.some((run) => run.status === "failed")) return `✗ Échec · ${NAME}`;
  if (runs.some((run) => run.status === "completed")) return `✓ Terminé · ${NAME}`;
  if (runs.some((run) => run.status === "stopped")) return `○ Arrêté · ${NAME}`;
  return NAME;
}

/** The colour of a single run, used both by the favicon and by the dot of its row. */
export function statusColor(status: RunSummary["status"]) {
  if (status === "attention") return "#d97706";
  if (status === "failed") return "#b91c1c";
  if (status === "completed") return "#477a62";
  if (status === "stopped") return "#6b7280";
  if (runInProgress(status)) return "#477a62";
  return "#1c211f";
}

/** The favicon speaks for the whole console: the most demanding run wins. */
export function faviconColor(runs: RunSummary[]) {
  if (runs.some((run) => run.status === "attention" || pendingDecisions(run) > 0)) return statusColor("attention");
  if (runs.some((run) => runInProgress(run.status))) return statusColor("running");
  if (runs.some((run) => run.status === "failed")) return statusColor("failed");
  if (runs.some((run) => run.status === "completed")) return statusColor("completed");
  if (runs.some((run) => run.status === "stopped")) return statusColor("stopped");
  return statusColor("idle");
}

export function faviconDataUri(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="${color}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
