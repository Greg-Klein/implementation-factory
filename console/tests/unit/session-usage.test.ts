import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { readSessionUsage, transcriptDirectory, usageFromTranscript } from "../../server/engine/usage";

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
    writeFileSync(path.join(directory, "session-a", "subagents", "agent-a1.meta.json"), JSON.stringify({ agentType: "implementation-harness:developer" }));
    return directory;
  };

  it("should read the pilot and each subagent, named after its type", async () => {
    const directory = project();
    const sessions = await readSessionUsage({ transcriptPath: path.join(directory, "session-a.jsonl"), cwd: "/elsewhere", isolated: false });
    expect(sessions).toEqual([
      expect.objectContaining({ sessionId: "session-a", outputTokens: 100 }),
      expect.objectContaining({ sessionId: "session-a", agentId: "a1", agentType: "implementation-harness:developer", outputTokens: 40 }),
    ]);
    expect(sessions[0].agentId).toBeUndefined();
  });

  it("should add a second session of the same directory only when that directory belongs to the run", async () => {
    const directory = project();
    writeFileSync(path.join(directory, "session-b.jsonl"), call("msg_9", { output_tokens: 5 }));
    const source = { transcriptPath: path.join(directory, "session-a.jsonl"), cwd: "/elsewhere" };
    expect(await readSessionUsage({ ...source, isolated: false })).toHaveLength(2);
    expect(await readSessionUsage({ ...source, isolated: true })).toHaveLength(3);
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
