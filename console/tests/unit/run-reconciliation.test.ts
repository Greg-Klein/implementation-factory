import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { reconcileInterruptedRuns } from "../../server/context";
import type { RunState } from "../../server/types";

let runsDirectory: string;

function writeRun(runId: string, overrides: Partial<RunState>) {
  const runDir = path.join(runsDirectory, runId);
  mkdirSync(runDir, { recursive: true });
  const state: RunState = { id: runId, status: "running", phase: 3, cwd: "/repo", issueUrl: "", instruction: "", startedAt: "2026-09-09T08:18:30.710Z", endedAt: null, agents: [], activities: [], messages: [], artifacts: [], sessionActive: false, ...overrides };
  writeFileSync(path.join(runDir, "run.json"), JSON.stringify(state, null, 2));
}

function readRun(runId: string): RunState {
  return JSON.parse(readFileSync(path.join(runsDirectory, runId, "run.json"), "utf8")) as RunState;
}

beforeEach(() => { runsDirectory = mkdtempSync(path.join(os.tmpdir(), "impl-runs-")); });
afterEach(() => rmSync(runsDirectory, { recursive: true, force: true }));

// The defect this guards: ctx.state starts empty on every boot, so a run a
// crash or a restart caught mid-flight keeps reading "running" on disk
// forever — nothing is ever left to write its real outcome.
describe("reconciling runs orphaned by a server restart", () => {
  it("should close a run stuck in progress and explain why", async () => {
    writeRun("run-a", { status: "running" });
    await reconcileInterruptedRuns(runsDirectory);
    const state = readRun("run-a");
    expect(state.status).toBe("failed");
    expect(state.endedAt).not.toBeNull();
    expect(state.error).toMatch(/restarted/);
    expect(state.activities[0]?.title).toBe("Run interrupted by a server restart");
  });

  it("should close every non-terminal status, starting and attention included", async () => {
    writeRun("run-starting", { status: "starting" });
    writeRun("run-attention", { status: "attention" });
    await reconcileInterruptedRuns(runsDirectory);
    expect(readRun("run-starting").status).toBe("failed");
    expect(readRun("run-attention").status).toBe("failed");
  });

  it("should leave a run that already reached a terminal status untouched", async () => {
    writeRun("run-done", { status: "completed", endedAt: "2026-09-09T09:00:00.000Z" });
    writeRun("run-failed", { status: "failed", endedAt: "2026-09-09T09:00:00.000Z", error: "already recorded" });
    await reconcileInterruptedRuns(runsDirectory);
    expect(readRun("run-done")).toEqual(expect.objectContaining({ status: "completed", endedAt: "2026-09-09T09:00:00.000Z" }));
    expect(readRun("run-failed")).toEqual(expect.objectContaining({ status: "failed", error: "already recorded" }));
  });

  it("should close the agents the interrupted run left running", async () => {
    writeRun("run-agents", { status: "running", agents: [
      { id: "a1", name: "implementation-harness:developer", status: "running", startedAt: "2026-09-09T08:20:00.000Z" },
      { id: "a2", name: "Explore", status: "completed", startedAt: "2026-09-09T08:19:00.000Z", endedAt: "2026-09-09T08:19:40.000Z" },
    ] });
    await reconcileInterruptedRuns(runsDirectory);
    const agents = readRun("run-agents").agents;
    expect(agents[0]).toEqual(expect.objectContaining({ id: "a1", status: "abandoned" }));
    expect(agents[0]!.endedAt).not.toBeUndefined();
    expect(agents[1]).toEqual(expect.objectContaining({ id: "a2", status: "completed", endedAt: "2026-09-09T08:19:40.000Z" }));
  });

  it("should do nothing when the runs directory does not exist yet", async () => {
    await expect(reconcileInterruptedRuns(path.join(runsDirectory, "missing"))).resolves.toBeUndefined();
  });

  it("should skip a run directory without a readable run.json", async () => {
    mkdirSync(path.join(runsDirectory, "run-empty"), { recursive: true });
    await expect(reconcileInterruptedRuns(runsDirectory)).resolves.toBeUndefined();
  });
});
