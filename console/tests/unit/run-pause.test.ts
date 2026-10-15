import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describeQueue, runLockKey, runTakesSlot, sessionsToReleaseForQueue, type ScheduleContext } from "../../server/domain";
import { evaluateRunHealth } from "../../server/run-health";
import { normalizeArchivedRun } from "../../server/run-incidents";
import type { QueuedRun } from "../../server/types";

// Watchers are never started here, and chokidar ships as ESM only.
jest.mock("chokidar", () => ({ __esModule: true, default: { watch: () => ({ on: () => undefined, close: async () => undefined }) } }));

const storage = mkdtempSync(path.join(os.tmpdir(), "factory-pause-"));
process.env.IMPL_DATA_DIR = storage;

let readWorkflowState: typeof import("../../server/artifacts").readWorkflowState;
let processHook: typeof import("../../server/hooks").processHook;
let RunSession: typeof import("../../server/run-session").RunSession;
let healthInput: typeof import("../../server/run-monitor").healthInput;

beforeAll(async () => {
  ({ readWorkflowState } = await import("../../server/artifacts"));
  ({ processHook } = await import("../../server/hooks"));
  ({ RunSession } = await import("../../server/run-session"));
  ({ healthInput } = await import("../../server/run-monitor"));
});
afterAll(() => rmSync(storage, { recursive: true, force: true }));

const state = (revision: number, workflow: string, extra: object = {}) => JSON.stringify({ schemaVersion: 1, revision, state: workflow, ...extra });
const paused = (revision: number) => state(revision, "paused", { step: "2", nextAction: { kind: "await_dependency", description: "Attendre le merge du #226." } });

let session: InstanceType<typeof RunSession>;
const hook = (payload: Record<string, unknown>) => processHook(session, { runId: session.id, payload });

beforeEach(() => {
  session = new RunSession("demo-pause", { status: "running", phase: 2, sessionActive: true });
  readWorkflowState(session, state(2, "working", { step: "2" }));
});

describe("a pause the user asked for", () => {
  it("should pause the run instead of completing it", () => {
    readWorkflowState(session, paused(3));
    hook({ hook_event_name: "Stop" });
    expect(session.state).toMatchObject({ status: "paused", phase: 2 });
    expect(session.state.endedAt).toBeNull();
    expect(session.state.activities.map((activity) => activity.title)).not.toContain("Workflow completed");
  });

  it("should give back its slot and raise no incident while it waits", () => {
    readWorkflowState(session, paused(3));
    hook({ hook_event_name: "Stop" });
    expect(runTakesSlot(session.state)).toBe(false);
    expect(evaluateRunHealth(healthInput(session), Date.now() + 24 * 3_600_000)).toEqual({ health: "healthy" });
  });

  it("should go back to work at the step the workflow declares, and follow its agents again", () => {
    readWorkflowState(session, paused(3));
    hook({ hook_event_name: "Stop" });
    hook({ hook_event_name: "SubagentStart", agent_type: "implementation-factory:developer", agent_id: "ignored" });
    expect(session.state.agents).toEqual([]);
    readWorkflowState(session, state(4, "working", { step: "5" }));
    expect(session.state).toMatchObject({ status: "running", phase: 5 });
    expect(session.signals.pilotIdleSince).toBeUndefined();
    hook({ hook_event_name: "SubagentStart", agent_type: "implementation-factory:developer", agent_id: "dev-1" });
    expect(session.state.agents.at(-1)).toMatchObject({ id: "dev-1", status: "running" });
    expect(session.state.reopenings ?? []).toEqual([]);
  });

  it("should not pause a run whose session is gone", () => {
    session.state.sessionActive = false;
    readWorkflowState(session, paused(3));
    expect(session.state.status).toBe("running");
  });

  it("should read an archived paused run as stopped, since nothing can resume it", () => {
    readWorkflowState(session, paused(3));
    expect(normalizeArchivedRun(JSON.parse(JSON.stringify(session.state)), session.id)?.status).toBe("stopped");
  });
});

describe("the queue behind a paused run", () => {
  it("should keep a conflicting ticket waiting for the paused one", () => {
    const repository = "/work/shop";
    const url = (iid: number) => `https://gitlab.com/acme/shop/-/issues/${iid}`;
    const entry: QueuedRun = { id: "q101", cwd: repository, repository, issueUrl: url(101), instruction: "", queuedAt: "2026-10-01T10:00:00.000Z", batchId: "batch-1" };
    const run = { id: "run-98", cwd: `${repository}/.claude/worktrees/run-98`, repository, issueUrl: url(98), status: "paused" as const };
    const context: ScheduleContext = { runs: [run], edges: [{ repository, a: url(98), b: url(101), kind: "overlap", reason: "Tickets 98 and 101 change the same file." }] };
    const [view] = describeQueue([entry], new Map([[runLockKey(run), run.id]]), context);
    expect(view).toMatchObject({ reason: "conflict", blockedBy: "run-98" });
  });

  it("should keep the session of a paused run open when a launch of its ticket is queued", () => {
    const repository = "/work/shop";
    const issueUrl = "https://gitlab.com/acme/shop/-/issues/98";
    const held = { id: "run-98", cwd: `${repository}/.claude/worktrees/run-98`, repository, issueUrl, sessionActive: true };
    const queue = [{ cwd: repository, repository, issueUrl }];
    expect(sessionsToReleaseForQueue([{ ...held, status: "paused" }], queue)).toEqual([]);
    expect(sessionsToReleaseForQueue([{ ...held, status: "completed" }], queue)).toEqual(["run-98"]);
  });
});
