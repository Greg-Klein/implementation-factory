import { open } from "node:fs/promises";
import chokidar from "chokidar";
import { engine } from "./engine/index.js";
import type { RunSession } from "./run-session.js";

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
    session.touch();
    const lines = (follow.carry + buffer.toString("utf8")).split("\n");
    follow.carry = lines.pop() ?? "";
    let published = false;
    for (const line of lines) {
      const message = engine.conversationLine(line);
      if (!message || session.state.messages.some((entry) => entry.id === message.id)) continue;
      session.conversationMessage(message);
      published = true;
    }
    if (published) session.publish();
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
  if (session.transcript.path === transcriptPath) return;
  await closeTranscript(session);
  session.transcript.path = transcriptPath;
  const watcher = chokidar.watch(transcriptPath, { ignoreInitial: false });
  session.transcript.watcher = watcher;
  watcher.on("add", () => void readNewMessages(session, transcriptPath));
  watcher.on("change", () => void readNewMessages(session, transcriptPath));
}

export async function closeTranscript(session: RunSession) {
  await session.transcript.watcher?.close().catch(() => undefined);
  session.transcript.watcher = null;
  session.transcript.path = undefined;
  session.transcript.offset = 0;
  session.transcript.carry = "";
}
