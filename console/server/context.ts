import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { runInProgress } from "./domain.js";
import { interruptRun, normalizeArchivedRun } from "./run-incidents.js";
import type { Activity, RunState, ServerMessage } from "./types.js";

/**
 * Every open page, with the run it has opened. The list of runs goes to all of
 * them; the state of a run and the output of its terminal go only to the pages
 * showing it, so a console with three runs does not push three transcripts and
 * three terminals into every tab.
 */
export const clients = new Map<WebSocket, { runId?: string | undefined }>();

export function now() { return new Date().toISOString(); }

function deliver(socket: WebSocket, serialized: string) {
  if (socket.readyState === WebSocket.OPEN) socket.send(serialized);
}

export function send(socket: WebSocket, message: ServerMessage) {
  deliver(socket, JSON.stringify(message));
}

export function broadcast(message: ServerMessage) {
  const serialized = JSON.stringify(message);
  for (const socket of clients.keys()) deliver(socket, serialized);
}

/** When each kind of failure was last shown to a page. */
const reportedFailures = new Map<string, number>();
const FAILURE_NOTICE_INTERVAL_MS = 10 * 60_000;

/** Whether a read failed because nothing is there, the one failure that means "absent": no such file, or a path that goes through a plain file (a `.DS_Store` beside the run directories). */
export function isMissingFile(error: unknown) {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * What a write or a reading nobody awaits does with its failure: one line in
 * the server log each time, with what failed and on what, and one notice per
 * kind of failure every ten minutes, so a full disk says so without saying it
 * on every event, and says it again if it lasts or comes back. A notice no page
 * was there to receive does not count as shown. A failure dropped in silence
 * left the disk behind the memory until the next restart read the older file
 * as the truth.
 */
export function reportFailure(what: string, subject?: string) {
  return (error: unknown): undefined => {
    const message = error instanceof Error ? error.message : String(error);
    // With where it was thrown, when it says: a message alone names a failure without locating it.
    console.error(`[implementation-factory] ${what}${subject ? ` (${subject})` : ""}: ${message}`, ...(error instanceof Error && error.stack ? [`\n${error.stack}`] : []));
    const shownAt = reportedFailures.get(what);
    if (clients.size === 0 || (shownAt !== undefined && Date.now() - shownAt < FAILURE_NOTICE_INTERVAL_MS)) return;
    reportedFailures.set(what, Date.now());
    broadcast({ type: "notice", level: "attention", title: what, detail: subject ? `${subject}: ${message}` : message, at: now() });
  };
}

/** To the pages showing this run, and to nobody else. */
export function broadcastToViewers(runId: string, message: ServerMessage) {
  const serialized = JSON.stringify(message);
  for (const [socket, subscription] of clients) if (subscription.runId === runId) deliver(socket, serialized);
}

/** Bounded, because the archive is rewritten in full on every event. */
export const ARCHIVED_ACTIVITIES = 1_000;

/**
 * `RunSession` starts empty on every process boot, but a run archived on disk
 * mid-flight keeps whatever status it last persisted. A crash or a restart
 * between two events leaves it reading "running" forever: nothing was left
 * to ever write its outcome. Read at startup, before any new run can begin,
 * so a stale run is never mistaken for one still in progress. Each one gets
 * an interruption incident, once however many restarts go over it, which is
 * what lets the console show it again as a diagnosis rather than lose it.
 */
export async function reconcileInterruptedRuns(runsDirectory: string) {
  let runIds: string[];
  try { runIds = await readdir(runsDirectory); } catch { return; }
  await Promise.all(runIds.map(async (runId) => {
    const runFile = path.join(runsDirectory, runId, "run.json");
    let raw: Partial<RunState>;
    // One damaged archive must not keep every other run from being reconciled, nor the console from starting.
    try { raw = JSON.parse(await readFile(runFile, "utf8")) as Partial<RunState>; } catch { return; }
    const state = normalizeArchivedRun(raw, runId);
    if (!state || !runInProgress(state.status)) return;
    // The question it was waiting on is gone with its session, but it says where the run stood.
    const interrupted = interruptRun({ ...state, pendingQuestion: raw.pendingQuestion }, now());
    const closingEntry: Activity = { id: crypto.randomUUID(), at: now(), kind: "system", title: "Run interrupted by a server restart" };
    interrupted.activities = [closingEntry, ...interrupted.activities].slice(0, ARCHIVED_ACTIVITIES);
    const temporary = `${runFile}.reconcile.tmp`;
    await writeFile(temporary, JSON.stringify(interrupted, null, 2)).then(() => rename(temporary, runFile)).catch(reportFailure("Interrupted run not saved", runId));
  }));
}
