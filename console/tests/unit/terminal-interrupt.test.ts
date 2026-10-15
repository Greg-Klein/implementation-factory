import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { carriesInterrupt, exitFollowsInterrupt, INTERRUPT_EXIT_WINDOW_MS } from "../../server/domain";

// Watchers are never started here, and chokidar ships as ESM only.
jest.mock("chokidar", () => ({ __esModule: true, default: { watch: () => ({ on: () => undefined, close: async () => undefined }) } }));

const storage = mkdtempSync(path.join(os.tmpdir(), "factory-interrupt-"));
process.env.IMPL_DATA_DIR = storage;

let RunSession: typeof import("../../server/run-session").RunSession;
let registry: InstanceType<typeof import("../../server/registry").RunRegistry>;
const exited: InstanceType<typeof RunSession>[] = [];

beforeAll(async () => {
  ({ RunSession } = await import("../../server/run-session"));
  const { RunRegistry } = await import("../../server/registry");
  registry = new RunRegistry();
  registry.monitor.stop();
});
afterEach(() => { jest.restoreAllMocks(); });
// What each exit started in the background writes under the data directory, which must outlive it.
afterAll(async () => {
  await Promise.all(exited.map((session) => session.serializeHealth(async () => undefined)));
  await registry.drain();
  rmSync(storage, { recursive: true, force: true });
});

describe("an interrupt typed in the run's terminal", () => {
  it("should recognise the interrupt character alone or among other input", () => {
    expect(carriesInterrupt("\u0003")).toBe(true);
    expect(carriesInterrupt("\u001b[I\u0003")).toBe(true);
    expect(carriesInterrupt("hello\r")).toBe(false);
  });

  it("should count an exit as the user's only within the window that follows the interrupt", () => {
    expect(exitFollowsInterrupt(null, 1_000)).toBe(false);
    expect(exitFollowsInterrupt(1_000, 1_000 + INTERRUPT_EXIT_WINDOW_MS)).toBe(true);
    expect(exitFollowsInterrupt(1_000, 1_001 + INTERRUPT_EXIT_WINDOW_MS)).toBe(false);
    expect(exitFollowsInterrupt(1_000, 999)).toBe(false);
  });
});

describe("a session that exits after input typed in its terminal", () => {
  const exitAfter = (id: string, input: string, delayMs: number) => {
    const session = new RunSession(id, { status: "running", phase: 1, sessionActive: true });
    const written: string[] = [];
    session.engine = { write: (data: string) => { written.push(data); }, submit: () => undefined, resize: () => undefined, kill: () => undefined, answerPrompt: () => false };
    (registry as unknown as { register(session: unknown): unknown }).register(session);
    const typedAt = 1_760_000_000_000;
    const clock = jest.spyOn(Date, "now").mockReturnValue(typedAt);
    registry.terminalInput(id, input);
    clock.mockReturnValue(typedAt + delayMs);
    (registry as unknown as { handleExit(session: unknown, code: number): void }).handleExit(session, 0);
    exited.push(session);
    return { session, written };
  };

  it("should end the run stopped by the user when the exit follows a Ctrl-C", () => {
    const { session, written } = exitAfter("demo-interrupt-quick", "\u001b[I\u0003", 2_000);
    expect(written).toEqual(["\u001b[I\u0003"]);
    expect(session.stoppedBy).toBe("user");
    expect(session.state.status).toBe("stopped");
    expect(session.state.error).toBeUndefined();
    expect(session.state.activities.map((activity) => activity.title)).toContain("Session stopped by the user");
  });

  it("should fail the run when the exit comes long after the Ctrl-C", () => {
    const { session } = exitAfter("demo-interrupt-late", "\u0003", INTERRUPT_EXIT_WINDOW_MS + 1_000);
    expect(session.stoppedBy).toBeNull();
    expect(session.state.status).toBe("failed");
  });

  it("should fail the run when the exit follows ordinary input", () => {
    const { session } = exitAfter("demo-interrupt-none", "yes\r", 1_000);
    expect(session.stoppedBy).toBeNull();
    expect(session.state.status).toBe("failed");
  });
});
