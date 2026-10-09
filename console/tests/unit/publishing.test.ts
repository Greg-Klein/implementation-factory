import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WebSocket } from "ws";
import { appendTerminalOutput } from "../../lib/terminal-output";
import type { RunState } from "../../server/types";

// Watchers are never started here, and chokidar ships as ESM only.
jest.mock("chokidar", () => ({ __esModule: true, default: { watch: () => ({ on: () => undefined, close: async () => undefined }) } }));

const storage = mkdtempSync(path.join(os.tmpdir(), "factory-publishing-"));
process.env.IMPL_DATA_DIR = storage;

let context: typeof import("../../server/context");
let health: typeof import("../../server/run-health");
let RunSession: typeof import("../../server/run-session").RunSession;
let RunRegistry: typeof import("../../server/registry").RunRegistry;

beforeAll(async () => {
  context = await import("../../server/context");
  health = await import("../../server/run-health");
  ({ RunSession } = await import("../../server/run-session"));
  ({ RunRegistry } = await import("../../server/registry"));
});
afterAll(() => rmSync(storage, { recursive: true, force: true }));

const saved = (id: string) => JSON.parse(readFileSync(path.join(storage, "runs", id, "run.json"), "utf8")) as RunState;

describe("a run written to disk", () => {
  it("should write a burst of changes as the first state and the last, not once per change", async () => {
    const session = new RunSession("run-burst", { status: "running", phase: 1, cwd: "/work/run-burst", startedAt: "2026-10-06T10:00:00.000Z" });
    const copies = jest.spyOn(session, "archivedState");
    let last: Promise<void> = Promise.resolve();
    for (let phase = 1; phase <= 60; phase += 1) {
      session.state.phase = phase;
      last = session.persist();
    }
    await last;
    expect(copies).toHaveBeenCalledTimes(2);
    expect(saved("run-burst").phase).toBe(60);
  });

  it("should have on disk the state a caller awaited, and write again for a change that comes after", async () => {
    const session = new RunSession("run-awaited", { status: "running", phase: 2, cwd: "/work/run-awaited", startedAt: "2026-10-06T10:00:00.000Z" });
    await session.persist();
    expect(saved("run-awaited").phase).toBe(2);
    session.state.phase = 7;
    await session.persist();
    expect(saved("run-awaited").phase).toBe(7);
  });
});

describe("the list of runs sent to every page", () => {
  it("should be sent again only when it says something new", () => {
    const received: { type: string }[] = [];
    const page = { readyState: 1, send: (serialized: string) => { received.push(JSON.parse(serialized)); } } as unknown as WebSocket;
    context.clients.set(page, {});
    try {
      const registry = new RunRegistry();
      registry.monitor.stop();
      registry.publishSnapshot();
      registry.publishSnapshot();
      expect(received.filter((message) => message.type === "factory")).toHaveLength(1);

      const session = new RunSession("run-listed", { status: "running", phase: 1, cwd: "/work/run-listed", startedAt: "2026-10-06T10:00:00.000Z" });
      (registry as unknown as { register(session: unknown): unknown }).register(session);
      registry.publishSnapshot();
      registry.publishSnapshot();
      const lists = received.filter((message) => message.type === "factory") as { type: string; snapshot: { runs: { id: string }[] } }[];
      expect(lists.map((message) => message.snapshot.runs.map((run) => run.id))).toEqual([[], ["run-listed"]]);
    } finally {
      context.clients.delete(page);
    }
  });
});

describe("a wait on the user", () => {
  const T0 = Date.UTC(2026, 9, 6, 10, 0, 0);
  const policy = { tickMs: 15_000, turnEndGraceMs: 60_000, artifactGraceMs: 30_000, suspicionMs: 600_000, resumeGraceMs: 120_000 };

  it("should be dated from the question, the same at every evaluation", () => {
    const input = {
      status: "attention" as const, sessionActive: true, stoppedBy: null, pendingQuestion: true, waitingSince: T0,
      agents: [], artifacts: [], signals: health.healthSignalsView(health.createSignals(T0)),
    };
    const first = health.evaluateRunHealth(input, T0 + 15_000, policy);
    const later = health.evaluateRunHealth(input, T0 + 3_600_000, policy);
    expect(first.wait).toMatchObject({ reason: "user_question", since: "2026-10-06T10:00:00.000Z" });
    expect(later.wait).toEqual(first.wait);
  });
});

describe("the terminal output kept for a replay", () => {
  it("should be cut back to its limit only once it ran past the slack", () => {
    expect(appendTerminalOutput("abcdefgh", "ij", 8)).toBe("cdefghij");
    expect(appendTerminalOutput("abcdefgh", "ij", 8, 4)).toBe("abcdefghij");
    expect(appendTerminalOutput("abcdefghijkl", "m", 8, 4)).toBe("fghijklm");
  });
});
