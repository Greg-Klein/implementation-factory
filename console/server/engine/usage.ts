import { defined } from "../../lib/defined.js";
import { open, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HeadlessUsage, SessionUsage, UsageSource } from "./types.js";

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

/** Adds the calls of some transcript lines to the ones already read. `sidechain`: which lines to keep in a file that mixes both. */
function addCalls(calls: Map<string, Call>, text: string, sidechain: boolean) {
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
      ...defined({ model, at: known?.at ?? (typeof entry.timestamp === "string" ? entry.timestamp : undefined) }),
    });
  }
  return calls;
}

function totals(calls: Map<string, Call>): Omit<SessionUsage, "sessionId"> {
  const list = [...calls.values()];
  const context = (call: Call) => call.input + call.cacheRead + call.cacheWrite;
  const models = [...new Set(list.flatMap((call) => call.model ?? []))];
  return {
    calls: list.length,
    inputTokens: list.reduce((sum, call) => sum + call.input, 0),
    outputTokens: list.reduce((sum, call) => sum + call.output, 0),
    cacheReadTokens: list.reduce((sum, call) => sum + call.cacheRead, 0),
    cacheWriteTokens: list.reduce((sum, call) => sum + call.cacheWrite, 0),
    firstContextTokens: list[0] ? context(list[0]) : 0,
    peakContextTokens: list.reduce((peak, call) => Math.max(peak, context(call)), 0),
    ...(models.length > 0 ? { model: models.join(", ") } : {}),
  };
}

/** The calls of one transcript, in the order they were first written. `sidechain`: which lines to keep in a file that mixes both. */
export function usageFromTranscript(text: string, { sidechain = false }: { sidechain?: boolean } = {}): Omit<SessionUsage, "sessionId"> {
  return totals(addCalls(new Map(), text, sidechain));
}

/** How a transcript is reached: its size, and the bytes between two offsets. */
export type TranscriptAccess = {
  size(file: string): Promise<number | undefined>;
  read(file: string, from: number, to: number): Promise<Buffer>;
};

const diskAccess: TranscriptAccess = {
  size: (file) => stat(file).then((stats) => stats.size, () => undefined),
  read: async (file, from, to) => {
    const handle = await open(file, "r");
    try {
      const buffer = Buffer.alloc(to - from);
      const { bytesRead } = await handle.read(buffer, 0, to - from, from);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
};

/** Transcripts kept in memory at most: a console that stays up for weeks drops the oldest readings first. */
const READINGS_KEPT = 500;

type Reading = { offset: number; rest: Buffer; calls: Map<string, Call> };

/**
 * Reads the usage of transcripts that only ever grow. The figures are asked for
 * every few seconds while a run works, and a transcript read whole each time
 * costs as much as the run is long, on the thread that answers the hooks. Only
 * the bytes added since the last reading are read, and a file whose size did
 * not move, every finished subagent for one, is not opened at all. A file that
 * shrank was written again and is read from its start.
 */
export function createUsageReader(access: TranscriptAccess = diskAccess) {
  const readings = new Map<string, Reading>();
  return async function usageOf(file: string, sidechain = false): Promise<Omit<SessionUsage, "sessionId"> | undefined> {
    const size = await access.size(file);
    if (size === undefined) return undefined;
    const key = `${sidechain ? "side" : "main"}:${file}`;
    let reading = readings.get(key);
    if (!reading || size < reading.offset) reading = { offset: 0, rest: Buffer.alloc(0), calls: new Map() };
    if (size > reading.offset) {
      const added = Buffer.concat([reading.rest, await access.read(file, reading.offset, size)]);
      // Only whole lines are counted: the end of a line still being written waits for the next reading.
      const end = added.lastIndexOf(0x0a) + 1;
      addCalls(reading.calls, added.subarray(0, end).toString("utf8"), sidechain);
      reading.rest = added.subarray(end);
      reading.offset = size;
    }
    readings.delete(key);
    readings.set(key, reading);
    if (readings.size > READINGS_KEPT) readings.delete(readings.keys().next().value as string);
    // A last line without its line break is a whole line when the file was closed on it: counted, without being kept.
    return totals(reading.rest.length > 0 ? addCalls(new Map(reading.calls), reading.rest.toString("utf8"), sidechain) : reading.calls);
  };
}

const usageOf = createUsageReader();

/** The directory Claude Code keeps the transcripts of a working directory in. */
export function transcriptDirectory(cwd: string, configDirectory = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude")) {
  return path.join(configDirectory, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));
}

async function subagentUsage(sessionFile: string, read: ReturnType<typeof createUsageReader>): Promise<SessionUsage[]> {
  const sessionId = path.basename(sessionFile, ".jsonl");
  const directory = path.join(path.dirname(sessionFile), sessionId, "subagents");
  const files = (await readdir(directory).catch(() => [] as string[])).filter((name) => /^agent-.+\.jsonl$/.test(name));
  return Promise.all(files.map(async (name) => {
    const agentId = name.slice("agent-".length, -".jsonl".length);
    const usage = await read(path.join(directory, name), true) ?? usageFromTranscript("", { sidechain: true });
    const meta = await readFile(path.join(directory, `agent-${agentId}.meta.json`), "utf8").then((content) => JSON.parse(content) as Record<string, unknown>).catch(() => undefined);
    const agentType = typeof meta?.agentType === "string" ? meta.agentType : undefined;
    return { sessionId, agentId, ...(agentType ? { agentType } : {}), ...usage };
  }));
}

/**
 * Every session of a run, the pilot's first. The transcript the hooks named is
 * read when there is one; a run whose working directory is its own (`isolated`)
 * is also found from that directory alone, which is what lets a run of an
 * earlier process be measured, and picks up a session resumed under a new file.
 */
export async function readSessionUsage({ transcriptPath, cwd, isolated }: UsageSource, read = usageOf): Promise<SessionUsage[]> {
  const files = new Set<string>();
  if (transcriptPath) files.add(transcriptPath);
  if (isolated && cwd) {
    const directory = transcriptPath ? path.dirname(transcriptPath) : transcriptDirectory(cwd);
    for (const name of await readdir(directory).catch(() => [] as string[])) if (name.endsWith(".jsonl")) files.add(path.join(directory, name));
  }
  const sessions: SessionUsage[] = [];
  for (const file of files) {
    const usage = await read(file);
    if (usage === undefined) continue;
    sessions.push({ sessionId: path.basename(file, ".jsonl"), ...usage }, ...await subagentUsage(file, read));
  }
  return sessions;
}

/**
 * The report `claude -p --output-format json` prints as its last line when it
 * ends: `modelUsage` holds every model the session called, the main one and
 * the small ones Claude Code calls on its own, `usage` only the main one.
 */
export function headlessUsage(stdout: string): HeadlessUsage | undefined {
  const line = stdout.trimEnd().split("\n").at(-1);
  if (!line) return undefined;
  let report: Record<string, unknown>;
  try { report = JSON.parse(line) as Record<string, unknown>; } catch { return undefined; }
  if (typeof report !== "object" || report === null || report.type !== "result") return undefined;
  const byModel = typeof report.modelUsage === "object" && report.modelUsage !== null ? Object.entries(report.modelUsage as Record<string, Record<string, unknown>>) : [];
  const usage = report.usage as Record<string, unknown> | undefined;
  const entries = byModel.length > 0
    ? byModel.map(([, figures]) => ({ input: count(figures?.inputTokens), output: count(figures?.outputTokens), cacheRead: count(figures?.cacheReadInputTokens), cacheWrite: count(figures?.cacheCreationInputTokens) }))
    : usage ? [{ input: count(usage.input_tokens), output: count(usage.output_tokens), cacheRead: count(usage.cache_read_input_tokens), cacheWrite: count(usage.cache_creation_input_tokens) }] : [];
  if (entries.length === 0) return undefined;
  const sum = (key: "input" | "output" | "cacheRead" | "cacheWrite") => entries.reduce((total, entry) => total + entry[key], 0);
  const tokens = { input: sum("input"), output: sum("output"), cacheRead: sum("cacheRead"), cacheWrite: sum("cacheWrite") };
  return {
    tokens: { ...tokens, total: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite },
    models: byModel.map(([model]) => model),
    ...defined({ turns: typeof report.num_turns === "number" ? report.num_turns : undefined, costUsd: typeof report.total_cost_usd === "number" ? report.total_cost_usd : undefined }),
  };
}
