import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SessionUsage, UsageSource } from "./types.js";

/**
 * What a run cost, read from the transcripts Claude Code keeps of it. Every
 * assistant line carries the `usage` of the API call it came from, and one call
 * is written on several lines, one per content block, all under the same
 * message id: the last line of an id holds its final figures, so a call is
 * counted once, with those.
 *
 * The pilot's transcript is `<project>/<session>.jsonl`; each subagent has its
 * own under `<project>/<session>/subagents/agent-<id>.jsonl`, beside a
 * `.meta.json` naming its type. The agent id is the one the hooks carry.
 */

type Call = { input: number; output: number; cacheRead: number; cacheWrite: number; model?: string; at?: string };

function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** The calls of one transcript, in the order they were first written. `sidechain`: which lines to keep in a file that mixes both. */
export function usageFromTranscript(text: string, { sidechain = false }: { sidechain?: boolean } = {}): Omit<SessionUsage, "sessionId"> {
  const calls = new Map<string, Call>();
  for (const line of text.split("\n")) {
    if (!line.includes("\"usage\"")) continue;
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (entry.type !== "assistant" || Boolean(entry.isSidechain) !== sidechain) continue;
    const message = entry.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Record<string, unknown> | undefined;
    const id = typeof message?.id === "string" ? message.id : undefined;
    if (!usage || !id) continue;
    const model = typeof message?.model === "string" ? message.model : undefined;
    // A line the client wrote for itself (an error, an interruption) is no API call.
    if (model === "<synthetic>") continue;
    const known = calls.get(id);
    calls.set(id, {
      input: count(usage.input_tokens), output: count(usage.output_tokens),
      cacheRead: count(usage.cache_read_input_tokens), cacheWrite: count(usage.cache_creation_input_tokens),
      model, at: known?.at ?? (typeof entry.timestamp === "string" ? entry.timestamp : undefined),
    });
  }
  const list = [...calls.values()];
  const context = (call: Call) => call.input + call.cacheRead + call.cacheWrite;
  const models = [...new Set(list.flatMap((call) => call.model ?? []))];
  return {
    calls: list.length,
    inputTokens: list.reduce((sum, call) => sum + call.input, 0),
    outputTokens: list.reduce((sum, call) => sum + call.output, 0),
    cacheReadTokens: list.reduce((sum, call) => sum + call.cacheRead, 0),
    cacheWriteTokens: list.reduce((sum, call) => sum + call.cacheWrite, 0),
    firstContextTokens: list.length > 0 ? context(list[0]) : 0,
    peakContextTokens: list.reduce((peak, call) => Math.max(peak, context(call)), 0),
    ...(models.length > 0 ? { model: models.join(", ") } : {}),
  };
}

/** The directory Claude Code keeps the transcripts of a working directory in. */
export function transcriptDirectory(cwd: string, configDirectory = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude")) {
  return path.join(configDirectory, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));
}

async function subagentUsage(sessionFile: string): Promise<SessionUsage[]> {
  const sessionId = path.basename(sessionFile, ".jsonl");
  const directory = path.join(path.dirname(sessionFile), sessionId, "subagents");
  const files = (await readdir(directory).catch(() => [] as string[])).filter((name) => /^agent-.+\.jsonl$/.test(name));
  return Promise.all(files.map(async (name) => {
    const agentId = name.slice("agent-".length, -".jsonl".length);
    const text = await readFile(path.join(directory, name), "utf8").catch(() => "");
    const meta = await readFile(path.join(directory, `agent-${agentId}.meta.json`), "utf8").then((content) => JSON.parse(content) as Record<string, unknown>).catch(() => undefined);
    const agentType = typeof meta?.agentType === "string" ? meta.agentType : undefined;
    return { sessionId, agentId, ...(agentType ? { agentType } : {}), ...usageFromTranscript(text, { sidechain: true }) };
  }));
}

/**
 * Every session of a run, the pilot's first. The transcript the hooks named is
 * read when there is one; a run whose working directory is its own (`isolated`)
 * is also found from that directory alone, which is what lets a run of an
 * earlier process be measured, and picks up a session resumed under a new file.
 */
export async function readSessionUsage({ transcriptPath, cwd, isolated }: UsageSource): Promise<SessionUsage[]> {
  const files = new Set<string>();
  if (transcriptPath) files.add(transcriptPath);
  if (isolated && cwd) {
    const directory = transcriptPath ? path.dirname(transcriptPath) : transcriptDirectory(cwd);
    for (const name of await readdir(directory).catch(() => [] as string[])) if (name.endsWith(".jsonl")) files.add(path.join(directory, name));
  }
  const sessions: SessionUsage[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8").catch(() => undefined);
    if (text === undefined) continue;
    sessions.push({ sessionId: path.basename(file, ".jsonl"), ...usageFromTranscript(text) }, ...await subagentUsage(file));
  }
  return sessions;
}
