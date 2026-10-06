import { existsSync } from "node:fs";
import { open } from "node:fs/promises";
import chokidar from "chokidar";
import { engine } from "./engine/index.js";
import type { RunSession } from "./run-session.js";
import { reportFailure } from "./context.js";

async function readNewMessages(session: RunSession, file: string) {
  const follow = session.transcript;
  const handle = await open(file, "r").catch(() => null);
  if (!handle) return;
  try {
    const { size } = await handle.stat();
    if (size < follow.offset) { follow.offset = 0; follow.carry = ""; }
    if (size === follow.offset) return;
    const buffer = Buffer.alloc(size - follow.offset);
    await handle.read(buffer, 0, buffer.byteLength, follow.offset);
    follow.offset = size;
    session.markExecution();
    const lines = (follow.carry + buffer.toString("utf8")).split("\n");
    follow.carry = lines.pop() ?? "";
    let published = false;
    for (const line of lines) {
      const message = engine.conversationLine(line);
      if (!message || session.state.messages.some((entry) => entry.id === message.id)) continue;
      session.conversationMessage(message);
      session.noteDialogue(message.at);
      published = true;
    }
    if (published) { session.publish(); session.signal(); }
  } finally {
    await handle.close();
  }
}

/**
 * The agent appends every message of the session to this file, so it is the only
 * faithful source for the dialogue. One follower per run: two runs each have
 * their own transcript, and a single shared reader would have kept the offset of
 * whichever spoke last.
 */
export async function followTranscript(session: RunSession, transcriptPath: string) {
  const follow = session.transcript;
  if (follow.path === transcriptPath) {
    // Every hook is a chance to find the file before the timer does.
    if (!follow.onDisk && existsSync(transcriptPath)) watch(session, transcriptPath);
    return;
  }
  await closeTranscript(session);
  follow.path = transcriptPath;
  watch(session, transcriptPath);
}

/** How often a transcript that is not on disk yet is looked for. */
const APPEARANCE_POLL_MS = 500;

/**
 * Watches the file once it exists. The first hook names a transcript that is
 * not written yet, and neither is its directory when the run works in a fresh
 * worktree: Claude Code keeps one directory per working directory. A watcher
 * started that early misses the file, or reports it being created and then
 * nothing it is appended to, and the dialogue stayed empty for the whole run.
 * So nothing is watched before the file is there: it is looked for on a short
 * timer, and on every hook, and the watcher starts on a file it can see.
 */
function watch(session: RunSession, transcriptPath: string) {
  const follow = session.transcript;
  stopWatching(session);
  follow.onDisk = existsSync(transcriptPath);
  if (!follow.onDisk) {
    follow.pending = setInterval(() => { if (existsSync(transcriptPath)) watch(session, transcriptPath); }, APPEARANCE_POLL_MS);
    follow.pending.unref();
    return;
  }
  const watcher = chokidar.watch(transcriptPath, { ignoreInitial: false });
  follow.watcher = watcher;
  const read = () => { readNewMessages(session, transcriptPath).catch(reportFailure("Transcript not read", session.id)); };
  watcher.on("add", read);
  watcher.on("change", read);
}

/** Lets go of the watcher and of the timer that waits for the file, keeping what was already read. */
export function stopWatching(session: RunSession) {
  const follow = session.transcript;
  if (follow.pending) clearInterval(follow.pending);
  follow.pending = null;
  const previous = follow.watcher;
  follow.watcher = null;
  return previous?.close().catch(() => undefined);
}

export async function closeTranscript(session: RunSession) {
  await stopWatching(session);
  session.transcript.path = undefined;
  session.transcript.onDisk = false;
  session.transcript.offset = 0;
  session.transcript.carry = "";
}
