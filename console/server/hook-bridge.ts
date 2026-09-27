import { readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { broadcast, now } from "./context.js";
import { dataRoot, stallThresholdMs } from "./config.js";
import { spooledHooks, runStalled } from "./domain.js";
import { followTranscript } from "./transcript.js";
import { processHook } from "./hooks.js";
import { engine } from "./engine/index.js";
import type { RunSession } from "./run-session.js";

/** Where a session writes the hooks it could not post, for the console to apply late rather than never. */
export function hookSpoolPath(runId: string) {
  return path.join(dataRoot, runId, "hooks-spool.jsonl");
}

/**
 * One hook body, applied to the run it names: the live post and the spool
 * replay go through here alike. A hook posted twice, by a retry or because it
 * was spooled after a post that did land, is applied once.
 */
export function receiveHook(session: RunSession, body: Record<string, unknown>) {
  session.touch();
  if (!session.firstDelivery(body.hookId)) return undefined;
  const transcript = engine.transcriptPath(body);
  if (transcript) void followTranscript(session, transcript);
  return processHook(session, body);
}

async function replaySpool(session: RunSession) {
  const spool = hookSpoolPath(session.id);
  // Moved aside before it is read: a hook appended meanwhile starts a new file
  // instead of landing in one about to be deleted.
  const draining = `${spool}.${Date.now()}.draining`;
  try { await rename(spool, draining); } catch { return; }
  try {
    const bodies = spooledHooks(await readFile(draining, "utf8"));
    for (const body of bodies) await receiveHook(session, body);
  } finally {
    await rm(draining, { force: true });
  }
}

/** Applies whatever the session spooled, before anything newer is. */
export function drainHookSpool(session: RunSession) {
  if (session.demo) return Promise.resolve();
  session.spoolDrain ??= replaySpool(session).catch(() => undefined).finally(() => { session.spoolDrain = null; });
  return session.spoolDrain;
}

/**
 * Calls the user on a run that went silent. A lost hook leaves a run "running"
 * with nothing behind it, and nothing else would ever say so.
 */
export function checkStall(session: RunSession) {
  const stalled = runStalled({
    status: session.state.status,
    sessionActive: session.state.sessionActive,
    pendingQuestion: Boolean(session.state.pendingQuestion),
    demo: session.demo,
    flagged: session.stallFlagged,
    lastActivityAt: session.lastActivityAt,
    now: Date.now(),
    thresholdMs: stallThresholdMs,
  });
  if (!stalled) return;
  const minutes = Math.round(stallThresholdMs / 60_000);
  session.stallFlagged = true;
  session.state.status = "attention";
  session.state.action = undefined;
  session.activity("attention", `Aucun signe de ${engine.label} depuis ${minutes} min`, "Jette un œil au terminal : le run est peut-être bloqué.");
  session.publish();
  broadcast({ type: "notice", level: "attention", at: now(), title: "Run silencieux", detail: `${path.basename(session.state.cwd)} : aucune activité depuis ${minutes} min.` });
}
