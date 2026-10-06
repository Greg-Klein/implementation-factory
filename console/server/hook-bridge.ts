import { readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { dataRoot } from "./config.js";
import { spooledHooks } from "./domain.js";
import { followTranscript } from "./transcript.js";
import { processHook } from "./hooks.js";
import { engine } from "./engine/index.js";
import type { RunSession } from "./run-session.js";
import { reportFailure } from "./context.js";

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
  session.markExecution();
  if (!session.firstDelivery(body.hookId)) return undefined;
  const transcript = engine.transcriptPath(body);
  if (transcript) {
    session.state.transcriptPath = transcript;
    void followTranscript(session, transcript);
  }
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
    // One hook that cannot be applied does not take the ones spooled after it with it.
    for (const body of bodies) await Promise.resolve().then(() => receiveHook(session, body)).catch(reportFailure("Spooled hook not applied", session.id));
  } finally {
    await rm(draining, { force: true });
  }
}

/** Applies whatever the session spooled, before anything newer is. */
export function drainHookSpool(session: RunSession) {
  if (session.demo) return Promise.resolve();
  session.spoolDrain ??= replaySpool(session).catch(reportFailure("Hook spool not replayed", session.id)).finally(() => { session.spoolDrain = null; });
  return session.spoolDrain;
}
