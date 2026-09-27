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
export const clients = new Map<WebSocket, { runId?: string }>();

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
    const closingEntry: Activity = { id: crypto.randomUUID(), at: now(), kind: "system", title: "Run interrompu par un redémarrage du serveur" };
    interrupted.activities = [closingEntry, ...interrupted.activities].slice(0, ARCHIVED_ACTIVITIES);
    const temporary = `${runFile}.reconcile.tmp`;
    await writeFile(temporary, JSON.stringify(interrupted, null, 2)).then(() => rename(temporary, runFile)).catch(() => undefined);
  }));
}
