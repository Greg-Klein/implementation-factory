import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spooledHooks } from "../../server/domain";

// The transcript follower is never reached here, and its watcher ships as ESM only.
jest.mock("chokidar", () => ({ __esModule: true, default: { watch: () => ({ on: () => undefined, close: async () => undefined }) } }));

const storage = mkdtempSync(path.join(os.tmpdir(), "harness-hook-bridge-"));
process.env.IMPL_DATA_DIR = storage;
let bridge: typeof import("../../server/hook-bridge");
let RunSession: typeof import("../../server/run-session").RunSession;

beforeAll(async () => {
  bridge = await import("../../server/hook-bridge");
  ({ RunSession } = await import("../../server/run-session"));
});
afterAll(() => rmSync(storage, { recursive: true, force: true }));

const start = (id: string, agentId: string, hookId?: string) => ({
  runId: "run", ...(hookId ? { hookId } : {}),
  payload: { hook_event_name: "SubagentStart", agent_type: "implementation-harness:developer", agent_id: agentId },
});
const stop = (agentId: string, hookId?: string) => ({
  runId: "run", ...(hookId ? { hookId } : {}),
  payload: { hook_event_name: "SubagentStop", agent_type: "implementation-harness:developer", agent_id: agentId },
});

describe("hooks a session could not post", () => {
  it("should read the spool in order and skip a line torn by a crash", () => {
    const text = `${JSON.stringify(start("run", "a1"))}\n{"runId":"run","payl\n\n${JSON.stringify(stop("a1"))}\n`;
    expect(spooledHooks(text).map((body) => (body.payload as { hook_event_name: string }).hook_event_name)).toEqual(["SubagentStart", "SubagentStop"]);
    expect(spooledHooks("[1]\nnull\n")).toEqual([]);
  });

  it("should apply a hook once when a retry or the spool delivers it again", () => {
    const session = new RunSession("run-dedupe", { status: "running", phase: 1, sessionActive: true });
    bridge.receiveHook(session, start("run", "a1", "hook-1"));
    bridge.receiveHook(session, stop("a1", "hook-2"));
    bridge.receiveHook(session, start("run", "a1", "hook-1"));
    expect(session.state.agents).toEqual([expect.objectContaining({ id: "a1", status: "completed" })]);
  });

  it("should apply a spooled agent stop late instead of leaving the agent running", async () => {
    const session = new RunSession("run-spool", { status: "running", phase: 1, sessionActive: true });
    bridge.receiveHook(session, start("run", "a1", "live-1"));
    const spool = bridge.hookSpoolPath(session.id);
    mkdirSync(path.dirname(spool), { recursive: true });
    writeFileSync(spool, `${JSON.stringify(stop("a1", "spooled-1"))}\n`);
    await bridge.drainHookSpool(session);
    expect(session.state.agents[0]).toEqual(expect.objectContaining({ id: "a1", status: "completed" }));
    expect(existsSync(spool)).toBe(false);
    await expect(bridge.drainHookSpool(session)).resolves.toBeUndefined();
  });
});

describe("the hook emitter", () => {
  const emitter = path.resolve(__dirname, "../../../hooks/emit.mjs");
  const emit = (url: string, spool: string, payload: object) => new Promise<string>((resolve) => {
    const child = spawn(process.execPath, [emitter], { env: { ...process.env, IMPL_HARNESS_HOOK_URL: url, IMPL_HOOK_SPOOL: spool, IMPL_RUN_ID: "run" }, stdio: ["pipe", "pipe", "ignore"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("exit", () => resolve(output));
    child.stdin.end(JSON.stringify(payload));
  });

  it("should spool an event the harness could not take, and only then", async () => {
    const spool = path.join(storage, "emit-spool.jsonl");
    const received: string[] = [];
    const server = createServer((request, response) => {
      let body = ""; request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => { received.push(body); response.writeHead(received.length === 1 ? 503 : 200).end("{}"); });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    await emit(`http://127.0.0.1:${port}/api/hooks`, spool, { hook_event_name: "SubagentStop", agent_id: "a1" });
    server.close();
    // Refused once, taken on the retry, with the same identifier both times.
    expect(received).toHaveLength(2);
    expect(JSON.parse(received[0]!).hookId).toBe(JSON.parse(received[1]!).hookId);
    expect(existsSync(spool)).toBe(false);

    await emit(`http://127.0.0.1:${port}/api/hooks`, spool, { hook_event_name: "SubagentStop", agent_id: "a1" });
    const spooled = spooledHooks(readFileSync(spool, "utf8"));
    expect(spooled).toEqual([expect.objectContaining({ runId: "run", hookId: expect.any(String), payload: { hook_event_name: "SubagentStop", agent_id: "a1" } })]);
  });

  it("should wait for the answer to a question and hand it back to Claude Code", async () => {
    const hookOutput = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { answers: { q: "a" } } } };
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => { setTimeout(() => response.writeHead(200).end(JSON.stringify({ ok: true, hookOutput })), 3_000); });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    const output = await emit(`http://127.0.0.1:${port}/api/hooks`, path.join(storage, "answer-spool.jsonl"), { hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: {} });
    server.close();
    expect(JSON.parse(output)).toEqual(hookOutput);
  }, 10_000);

  it("should never spool a question, which only the live request can answer", async () => {
    const spool = path.join(storage, "question-spool.jsonl");
    await emit("http://127.0.0.1:1/api/hooks", spool, { hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: {} });
    expect(existsSync(spool)).toBe(false);
  });
});
