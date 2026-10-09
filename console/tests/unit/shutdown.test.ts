import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunState } from "../../server/types";

// Watchers are never started here, and chokidar ships as ESM only.
jest.mock("chokidar", () => ({ __esModule: true, default: { watch: () => ({ on: () => undefined, close: async () => undefined }) } }));

const storage = mkdtempSync(path.join(os.tmpdir(), "factory-shutdown-"));
process.env.IMPL_DATA_DIR = storage;

let RunSession: typeof import("../../server/run-session").RunSession;
let RunRegistry: typeof import("../../server/registry").RunRegistry;
let processHook: typeof import("../../server/hooks").processHook;

beforeAll(async () => {
  ({ RunSession } = await import("../../server/run-session"));
  ({ RunRegistry } = await import("../../server/registry"));
  ({ processHook } = await import("../../server/hooks"));
});
afterAll(() => rmSync(storage, { recursive: true, force: true }));

const savedRun = (id: string) => JSON.parse(readFileSync(path.join(storage, "runs", id, "run.json"), "utf8")) as RunState;

describe("the console shutting down", () => {
  it("should stop a run in progress, keep its worktree for the next start and leave it on disk as it stopped", async () => {
    const registry = new RunRegistry();
    registry.monitor.stop();
    const session = new RunSession("run-working", {
      status: "running", phase: 5, cwd: "/work/shop/.claude/worktrees/run-working", repository: "/work/shop", sessionActive: true,
      issueUrl: "https://gitlab.com/acme/shop/-/issues/101", startedAt: "2026-10-06T10:00:00.000Z",
      worktree: { path: "/work/shop/.claude/worktrees/run-working", state: "active" },
    });
    let killed = 0;
    session.engine = { write: () => undefined, submit: () => undefined, resize: () => undefined, kill: () => { killed += 1; }, answerPrompt: () => false };
    (registry as unknown as { register(session: unknown): unknown }).register(session);
    // A question nobody will answer any more: the hook that carries it is let go, not left waiting on a dead console.
    const parked = processHook(session, { runId: session.id, payload: {
      hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "q1",
      tool_input: { questions: [{ question: "Which base?", header: "Base", options: [{ label: "main" }] }] },
    } });
    expect(session.state.pendingQuestion?.id).toBe("q1");

    await registry.shutdown();

    await expect(parked).resolves.toBeUndefined();
    expect(killed).toBe(1);
    expect(registry.snapshot().runs).toEqual([]);
    const saved = savedRun("run-working");
    expect(saved).toMatchObject({
      status: "stopped", sessionActive: false,
      worktree: { path: "/work/shop/.claude/worktrees/run-working", state: "kept", detail: "Worktree kept: console stopped before the end of the run" },
    });
    expect(saved.pendingQuestion).toBeUndefined();
    expect(saved.endedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(saved.activities.map((activity) => activity.title)).toContain("Session stopped when the application closed");
  });

  it("should leave a finished run with its outcome, and still close its session", async () => {
    const registry = new RunRegistry();
    registry.monitor.stop();
    const session = new RunSession("run-done", {
      status: "completed", phase: 10, cwd: "/work/shop/.claude/worktrees/run-done", repository: "/work/shop", sessionActive: true,
      issueUrl: "https://gitlab.com/acme/shop/-/issues/102", startedAt: "2026-10-06T10:00:00.000Z", endedAt: "2026-10-06T11:00:00.000Z",
    });
    let killed = 0;
    session.engine = { write: () => undefined, submit: () => undefined, resize: () => undefined, kill: () => { killed += 1; }, answerPrompt: () => false };
    (registry as unknown as { register(session: unknown): unknown }).register(session);

    await registry.shutdown();

    expect(killed).toBe(1);
    expect(savedRun("run-done")).toMatchObject({ status: "completed", endedAt: "2026-10-06T11:00:00.000Z", sessionActive: false });
  });
});
