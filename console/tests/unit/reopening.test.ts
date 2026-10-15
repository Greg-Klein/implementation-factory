import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { phaseOfWorkflow, reopeningOpen, terminalExitStatus } from "../../server/domain";
import { interruptRun } from "../../server/run-incidents";

// Watchers are never started here, and chokidar ships as ESM only.
jest.mock("chokidar", () => ({ __esModule: true, default: { watch: () => ({ on: () => undefined, close: async () => undefined }) } }));

const storage = mkdtempSync(path.join(os.tmpdir(), "factory-reopening-"));
process.env.IMPL_DATA_DIR = storage;

let readWorkflowState: typeof import("../../server/artifacts").readWorkflowState;
let processHook: typeof import("../../server/hooks").processHook;
let RunSession: typeof import("../../server/run-session").RunSession;

beforeAll(async () => {
  ({ readWorkflowState } = await import("../../server/artifacts"));
  ({ processHook } = await import("../../server/hooks"));
  ({ RunSession } = await import("../../server/run-session"));
});
afterAll(() => rmSync(storage, { recursive: true, force: true }));

const MERGE_REQUEST = "https://gitlab.com/g/p/-/merge_requests/1";
const FIRST_END = "2026-10-14T08:35:22.896Z";
const state = (revision: number, workflow: string, extra: object = {}) => JSON.stringify({ schemaVersion: 1, revision, state: workflow, ...extra });
const delivered = (revision: number) => state(revision, "completed", { step: "10", result: { delivery: "merge_request", mergeRequestUrl: MERGE_REQUEST } });

// A demonstration identifier keeps the completion out of the self-improvement loop.
let session: InstanceType<typeof RunSession>;
const hook = (payload: Record<string, unknown>) => processHook(session, { runId: session.id, payload });

beforeEach(() => {
  session = new RunSession("demo-reopening", { status: "running", phase: 9, sessionActive: true, mergeRequestUrl: MERGE_REQUEST });
  readWorkflowState(session, delivered(10));
  hook({ hook_event_name: "Stop" });
  session.state.endedAt = FIRST_END;
});

describe("a change asked after the final report", () => {
  it("should put the run back in progress at the step the workflow declares", () => {
    expect(session.state).toMatchObject({ status: "completed", phase: 10 });
    readWorkflowState(session, state(11, "working", { step: "8" }));
    expect(session.state).toMatchObject({ status: "running", phase: 8 });
    readWorkflowState(session, state(12, "working", { step: "5" }));
    expect(session.state.phase).toBe(5);
  });

  it("should follow the agents of the change, then close the run again on its first end", () => {
    readWorkflowState(session, state(11, "working", { step: "8" }));
    hook({ hook_event_name: "SubagentStart", agent_type: "implementation-factory:qa-reviewer", agent_id: "qa-3" });
    expect(session.state.agents.at(-1)).toMatchObject({ id: "qa-3", status: "running" });
    hook({ hook_event_name: "SubagentStop", agent_type: "implementation-factory:qa-reviewer", agent_id: "qa-3" });
    hook({ hook_event_name: "Stop" });
    readWorkflowState(session, delivered(13));
    expect(session.state).toMatchObject({ status: "completed", phase: 10, endedAt: FIRST_END });
    expect(session.state.reopenings).toEqual([{ from: expect.any(String), to: expect.any(String) }]);
  });

  it("should leave a run whose session is gone as it ended", () => {
    session.state.sessionActive = false;
    readWorkflowState(session, state(11, "working", { step: "8" }));
    expect(session.state).toMatchObject({ status: "completed", phase: 10 });
  });
});

describe("the phase of a reopened run", () => {
  it("should go back to the declared step only while a reopening is open", () => {
    expect(phaseOfWorkflow(10, { step: "8" }, true)).toBe(8);
    expect(phaseOfWorkflow(10, { step: "8" }, false)).toBe(10);
    expect(phaseOfWorkflow(10, {}, true)).toBe(10);
  });

  it("should call a reopening open until it has an end", () => {
    expect(reopeningOpen({})).toBe(false);
    expect(reopeningOpen({ reopenings: [{ from: FIRST_END }] })).toBe(true);
    expect(reopeningOpen({ reopenings: [{ from: FIRST_END, to: FIRST_END }] })).toBe(false);
  });
});

describe("a session that ends during a reopening", () => {
  it("should keep the run delivered, whether it crashed or was stopped", () => {
    expect(terminalExitStatus(0, false, false, true)).toBe("completed");
    expect(terminalExitStatus(1, false, false, true)).toBe("completed");
    expect(terminalExitStatus(0, true, false, true)).toBe("completed");
    expect(terminalExitStatus(0, false, false, false)).toBe("failed");
  });
});

describe("a console restart during a reopening", () => {
  it("should close the run as delivered, with its first end and no lost session", () => {
    readWorkflowState(session, state(11, "working", { step: "8" }));
    hook({ hook_event_name: "SubagentStart", agent_type: "implementation-factory:qa-reviewer", agent_id: "qa-3" });
    const interrupted = interruptRun(session.state, "2026-10-14T09:00:00.000Z");
    expect(interrupted).toMatchObject({ status: "completed", endedAt: FIRST_END, sessionActive: false });
    expect(interrupted.incidents ?? []).not.toContainEqual(expect.objectContaining({ kind: "lost_session" }));
    expect(interrupted.agents.find((agent) => agent.id === "qa-3")?.status).not.toBe("running");
  });

  it("should still fail a run interrupted before its final report", () => {
    session = new RunSession("demo-interrupted", { status: "running", phase: 6, sessionActive: true });
    const interrupted = interruptRun(session.state, "2026-10-14T09:00:00.000Z");
    expect(interrupted.status).toBe("failed");
    expect(interrupted.incidents).toContainEqual(expect.objectContaining({ kind: "lost_session" }));
  });
});
