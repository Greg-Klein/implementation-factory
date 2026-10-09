import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WebSocket } from "ws";

// Watchers are never started here, and chokidar ships as ESM only.
jest.mock("chokidar", () => ({ __esModule: true, default: { watch: () => ({ on: () => undefined, close: async () => undefined }) } }));

const storage = mkdtempSync(path.join(os.tmpdir(), "factory-failures-"));
process.env.IMPL_DATA_DIR = storage;
const queueFile = path.join(storage, "queue.json");

let context: typeof import("../../server/context");
let RunRegistry: typeof import("../../server/registry").RunRegistry;

/** A page, as far as a broadcast can tell: every message it was sent, parsed. */
const received: { type: string; title?: string; detail?: string }[] = [];
const page = { readyState: 1, send: (serialized: string) => { received.push(JSON.parse(serialized)); } } as unknown as WebSocket;
let logged: jest.SpiedFunction<typeof console.error>;

beforeAll(async () => {
  context = await import("../../server/context");
  ({ RunRegistry } = await import("../../server/registry"));
  context.clients.set(page, {});
});
beforeEach(() => {
  received.length = 0;
  logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());
afterAll(() => {
  context.clients.delete(page);
  rmSync(storage, { recursive: true, force: true });
});

describe("a failure nobody awaits", () => {
  it("should be logged every time and shown once per kind", () => {
    const failed = context.reportFailure("Run not saved in this test", "run-1");
    failed(new Error("ENOSPC: no space left on device"));
    failed(new Error("ENOSPC: no space left on device"));
    context.reportFailure("Run not saved in this test", "run-2")("disk gone");
    expect(logged.mock.calls.map(([line]) => line)).toEqual([
      "[implementation-factory] Run not saved in this test (run-1): ENOSPC: no space left on device",
      "[implementation-factory] Run not saved in this test (run-1): ENOSPC: no space left on device",
      "[implementation-factory] Run not saved in this test (run-2): disk gone",
    ]);
    expect(received).toEqual([expect.objectContaining({ type: "notice", level: "attention", title: "Run not saved in this test", detail: "run-1: ENOSPC: no space left on device" })]);
  });

  it("should tell a missing file from one that cannot be read", () => {
    expect(context.isMissingFile(Object.assign(new Error("no such file"), { code: "ENOENT" }))).toBe(true);
    expect(context.isMissingFile(Object.assign(new Error("permission denied"), { code: "EACCES" }))).toBe(false);
    expect(context.isMissingFile(new SyntaxError("Unexpected end of JSON input"))).toBe(false);
  });
});

describe("the queue file found at start", () => {
  const registry = () => {
    const created = new RunRegistry();
    created.monitor.stop();
    return created;
  };
  const entry = { id: "q1", cwd: "/work/shop", repository: "/work/shop", issueUrl: "https://gitlab.com/acme/shop/-/issues/101", instruction: "", queuedAt: "2026-10-01T10:00:00.000Z" };

  it("should start empty and say nothing when there is no file", async () => {
    rmSync(queueFile, { force: true });
    const restored = registry();
    await restored.restoreQueue();
    expect(restored.snapshot().queued).toEqual([]);
    expect(logged).not.toHaveBeenCalled();
  });

  it("should load the queue it wrote", async () => {
    writeFileSync(queueFile, JSON.stringify({ version: 2, queue: [entry], tickets: [], edges: [], watches: [] }));
    const restored = registry();
    await restored.restoreQueue();
    expect(restored.snapshot().queued.map((queued) => queued.id)).toEqual(["q1"]);
  });

  it("should keep aside a file it cannot read instead of writing over it", async () => {
    const half = '{"version":2,"queue":[{"id":"q1","cwd":"/work/sh';
    writeFileSync(queueFile, half);
    const restored = registry();
    await restored.restoreQueue();
    expect(restored.snapshot().queued).toEqual([]);
    const aside = readdirSync(storage).filter((name) => name.startsWith("queue.json.unreadable-"));
    expect(aside).toHaveLength(1);
    expect(readFileSync(path.join(storage, aside[0]!), "utf8")).toBe(half);
    expect(readdirSync(storage)).not.toContain("queue.json");
    expect(received.map((message) => message.title)).toEqual(["Queue unreadable, started empty"]);
  });
});
