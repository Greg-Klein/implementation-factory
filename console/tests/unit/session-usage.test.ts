import { afterEach, describe, expect, it } from "@jest/globals";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createUsageReader, headlessUsage, readSessionUsage, transcriptDirectory, usageFromTranscript, type TranscriptAccess } from "../../server/engine/usage";

const call = (id: string, usage: Record<string, number>, extra: Record<string, unknown> = {}) => JSON.stringify({
  type: "assistant", timestamp: "2026-10-03T11:50:37.000Z", ...extra,
  message: { id, model: "claude-opus-5-5", usage, ...(extra.message as object | undefined) },
});

describe("usage read from a transcript", () => {
  it("should count a call written on several lines once, with its last figures", () => {
    const usage = usageFromTranscript([
      call("msg_1", { input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 16 }),
      call("msg_1", { input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 290 }),
      JSON.stringify({ type: "user", message: { content: "ok" } }),
      call("msg_2", { input_tokens: 3, cache_read_input_tokens: 400, cache_creation_input_tokens: 10, output_tokens: 20 }),
    ].join("\n"));
    expect(usage).toMatchObject({ calls: 2, inputTokens: 5, outputTokens: 310, cacheReadTokens: 500, cacheWriteTokens: 60, model: "claude-opus-5-5" });
  });

  it("should report the context of the first call and the largest one", () => {
    const usage = usageFromTranscript([
      call("msg_1", { input_tokens: 2, cache_read_input_tokens: 28_000, cache_creation_input_tokens: 44_000, output_tokens: 1 }),
      call("msg_2", { input_tokens: 2, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 1_000, output_tokens: 1 }),
    ].join("\n"));
    expect(usage.firstContextTokens).toBe(72_002);
    expect(usage.peakContextTokens).toBe(91_002);
  });

  it("should ignore a half-written line, a line the client wrote for itself and the lines of a subagent", () => {
    const usage = usageFromTranscript([
      "{\"type\":\"assistant\",\"message\":{\"id\":\"msg_0\",\"usage\":{\"input_tok",
      call("msg_1", { output_tokens: 10 }, { message: { model: "<synthetic>" } }),
      call("msg_2", { output_tokens: 10 }, { isSidechain: true }),
      call("msg_3", { output_tokens: 7 }),
    ].join("\n"));
    expect(usage).toMatchObject({ calls: 1, outputTokens: 7 });
  });

  it("should report nothing for an empty transcript", () => {
    expect(usageFromTranscript("")).toMatchObject({ calls: 0, firstContextTokens: 0, peakContextTokens: 0 });
  });
});

describe("sessions of a run", () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const project = () => {
    root = mkdtempSync(path.join(os.tmpdir(), "usage-"));
    const directory = path.join(root, "projects", "run");
    mkdirSync(path.join(directory, "session-a", "subagents"), { recursive: true });
    writeFileSync(path.join(directory, "session-a.jsonl"), call("msg_1", { output_tokens: 100 }));
    writeFileSync(path.join(directory, "session-a", "subagents", "agent-a1.jsonl"), call("msg_2", { output_tokens: 40 }, { isSidechain: true }));
    writeFileSync(path.join(directory, "session-a", "subagents", "agent-a1.meta.json"), JSON.stringify({ agentType: "implementation-factory:developer" }));
    return directory;
  };

  it("should read the pilot and each subagent, named after its type", async () => {
    const directory = project();
    const sessions = await readSessionUsage({ transcriptPath: path.join(directory, "session-a.jsonl"), cwd: "/elsewhere", isolated: false });
    expect(sessions).toEqual([
      expect.objectContaining({ sessionId: "session-a", outputTokens: 100 }),
      expect.objectContaining({ sessionId: "session-a", agentId: "a1", agentType: "implementation-factory:developer", outputTokens: 40 }),
    ]);
    expect(sessions[0]!.agentId).toBeUndefined();
  });

  it("should add a second session of the same directory only when that directory belongs to the run", async () => {
    const directory = project();
    writeFileSync(path.join(directory, "session-b.jsonl"), call("msg_9", { output_tokens: 5 }));
    const source = { transcriptPath: path.join(directory, "session-a.jsonl"), cwd: "/elsewhere" };
    expect(await readSessionUsage({ ...source, isolated: false })).toHaveLength(2);
    expect(await readSessionUsage({ ...source, isolated: true })).toHaveLength(3);
  });

  it("should read only what a transcript gained since the last reading, and nothing of one that did not move", async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "usage-"));
    const file = path.join(root, "session.jsonl");
    const lines = [call("msg_1", { output_tokens: 100 }), call("msg_2", { output_tokens: 30 }), call("msg_2", { output_tokens: 45 })].map((line) => (line.endsWith("\n") ? line : `${line}\n`));
    const ranges: [number, number][] = [];
    const access: TranscriptAccess = {
      size: async (target) => (existsSync(target) ? statSync(target).size : undefined),
      read: async (target, from, to) => { ranges.push([from, to]); return readFileSync(target).subarray(from, to); },
    };
    const usageOf = createUsageReader(access);

    writeFileSync(file, lines[0]!);
    expect(await usageOf(file)).toMatchObject({ calls: 1, outputTokens: 100 });
    expect(await usageOf(file)).toMatchObject({ calls: 1, outputTokens: 100 });
    expect(ranges).toEqual([[0, lines[0]!.length]]);

    // A line caught half written is not counted yet, and is not lost either.
    const half = Math.floor(lines[1]!.length / 2);
    writeFileSync(file, lines[0] + lines[1]!.slice(0, half));
    expect(await usageOf(file)).toMatchObject({ calls: 1, outputTokens: 100 });
    writeFileSync(file, lines[0]! + lines[1] + lines[2]);
    expect(await usageOf(file)).toEqual(usageFromTranscript(lines.join("")));
    expect(await usageOf(file)).toMatchObject({ calls: 2, outputTokens: 145 });
    expect(ranges).toEqual([[0, lines[0]!.length], [lines[0]!.length, lines[0]!.length + half], [lines[0]!.length + half, lines.join("").length]]);

    // Written again from scratch: read from its start.
    writeFileSync(file, lines[1]!);
    expect(await usageOf(file)).toMatchObject({ calls: 1, outputTokens: 30 });
    expect(await usageOf(path.join(root, "missing.jsonl"))).toBeUndefined();
  });

  it("should report nothing when the transcript is gone", async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "usage-"));
    expect(await readSessionUsage({ transcriptPath: path.join(root, "missing.jsonl"), cwd: root, isolated: false })).toEqual([]);
  });

  it("should name the directory of a working directory the way the agent does", () => {
    expect(transcriptDirectory("/Users/me/repo/.claude/worktrees/2026-10-03T11-50-33-908Z-9d20ddb0", "/Users/me/.claude"))
      .toBe("/Users/me/.claude/projects/-Users-me-repo--claude-worktrees-2026-10-03T11-50-33-908Z-9d20ddb0");
  });
});

describe("the end report of a headless session", () => {
  const report = (fields: Record<string, unknown>) => JSON.stringify({ type: "result", subtype: "success", num_turns: 7, total_cost_usd: 0.42, ...fields });

  it("should add up every model the session called, the small ones Claude Code calls on its own included", () => {
    const stdout = `${report({
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 1 },
      modelUsage: {
        "claude-opus-5-5": { inputTokens: 10, outputTokens: 200, cacheReadInputTokens: 3_000, cacheCreationInputTokens: 400 },
        "claude-haiku-5-5": { inputTokens: 5, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 100 },
      },
    })}\n`;
    expect(headlessUsage(stdout)).toEqual({
      tokens: { input: 15, output: 220, cacheRead: 3_000, cacheWrite: 500, total: 3_735 },
      models: ["claude-opus-5-5", "claude-haiku-5-5"], turns: 7, costUsd: 0.42,
    });
  });

  it("should fall back on the main usage when the report names no model", () => {
    expect(headlessUsage(report({ usage: { input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 10, cache_creation_input_tokens: 20 } }))?.tokens)
      .toEqual({ input: 2, output: 4, cacheRead: 10, cacheWrite: 20, total: 36 });
  });

  it("should read nothing from a session killed before its report, or from a last line that is not one", () => {
    expect(headlessUsage("")).toBeUndefined();
    expect(headlessUsage('{"type":"result","usage":')).toBeUndefined();
    expect(headlessUsage(JSON.stringify({ type: "assistant", usage: { input_tokens: 3 } }))).toBeUndefined();
  });
});
