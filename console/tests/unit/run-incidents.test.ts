import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunIncident, RunState } from "../../server/types";

// Watchers are never started here, and chokidar ships as ESM only.
jest.mock("chokidar", () => ({ __esModule: true, default: { watch: () => ({ on: () => undefined, close: async () => undefined }) } }));

const storage = mkdtempSync(path.join(os.tmpdir(), "harness-incidents-"));
process.env.IMPL_DATA_DIR = storage;
const runsDirectory = path.join(storage, "runs");

let incidents: typeof import("../../server/run-incidents");
let monitor: typeof import("../../server/run-monitor");
let health: typeof import("../../server/run-health");
let RunSession: typeof import("../../server/run-session").RunSession;
let RunRegistry: typeof import("../../server/registry").RunRegistry;
let RunArchive: typeof import("../../server/run-archive").RunArchive;
let reconcileInterruptedRuns: typeof import("../../server/context").reconcileInterruptedRuns;

beforeAll(async () => {
  incidents = await import("../../server/run-incidents");
  monitor = await import("../../server/run-monitor");
  health = await import("../../server/run-health");
  ({ RunSession } = await import("../../server/run-session"));
  ({ RunRegistry } = await import("../../server/registry"));
  ({ RunArchive } = await import("../../server/run-archive"));
  ({ reconcileInterruptedRuns } = await import("../../server/context"));
});
afterAll(() => rmSync(storage, { recursive: true, force: true }));

const T0 = Date.UTC(2026, 8, 27, 10, 0, 0);
const policy = { tickMs: 15_000, turnEndGraceMs: 60_000, artifactGraceMs: 30_000, suspicionMs: 600_000, resumeGraceMs: 120_000 };

/** A live run whose pilot handed control back at T0 with nothing running. */
function idleRun(id: string) {
  const session = new RunSession(id, { status: "running", phase: 5, cwd: `/work/${id}`, sessionActive: true, startedAt: new Date(T0 - 60_000).toISOString() });
  session.signals.pilotIdleSince = T0;
  session.signals.lastExecutionAt = T0;
  session.signals.lastProgressAt = T0;
  return session;
}

/** A registry holding one run, the way launch() would have left it, without a real session behind it. */
function registryWith(session: InstanceType<typeof RunSession>, submitted: string[] = []) {
  const registry = new RunRegistry();
  (registry as unknown as { register(session: unknown): unknown }).register(session);
  session.engine = { write: () => undefined, submit: (text) => submitted.push(text), resize: () => undefined, kill: () => undefined };
  registry.monitor.stop();
  return registry;
}

describe("the life of an incident", () => {
  const candidate = (fingerprint: string) => ({ kind: "no_next_action" as const, fingerprint, title: "Plus aucune action en cours", reason: "r", observations: [{ kind: "turn", detail: "d" }], suggestedActions: ["dismiss" as const] });
  const context = { runId: "run", now: "2026-09-27T10:02:00.000Z", outcome: () => "Claude Code a repris la main" };

  it("should open one incident per stable cause, however often it is evaluated", () => {
    const first = incidents.reconcileIncidents([], candidate("no_next_action:1"), context);
    expect(first.opened).toHaveLength(1);
    const again = incidents.reconcileIncidents(first.incidents, candidate("no_next_action:1"), context);
    expect(again).toMatchObject({ opened: [], resolved: [], changed: false });
    expect(again.incidents).toHaveLength(1);
  });

  it("should move the revision when what it observed changed, and only then", () => {
    const first = incidents.reconcileIncidents([], candidate("no_next_action:1"), context);
    const updated = incidents.reconcileIncidents(first.incidents, { ...candidate("no_next_action:1"), observations: [{ kind: "turn", detail: "autre" }] }, context);
    expect(updated.changed).toBe(true);
    expect(updated.incidents[0].revision).toBe(2);
  });

  it("should resolve an incident once its cause is gone, and never reopen a dismissed one", () => {
    const first = incidents.reconcileIncidents([], candidate("no_next_action:1"), context);
    const resolved = incidents.reconcileIncidents(first.incidents, undefined, context);
    expect(resolved.resolved[0]).toMatchObject({ status: "resolved", resolution: { outcome: "Claude Code a repris la main" } });
    const dismissed: RunIncident[] = [{ ...first.incidents[0], status: "dismissed" }];
    expect(incidents.reconcileIncidents(dismissed, candidate("no_next_action:1"), context)).toMatchObject({ opened: [], changed: false });
  });

  it("should never resolve a lost session on its own", () => {
    const lost = incidents.reconcileIncidents([], { ...candidate("lost_session:1"), kind: "lost_session" }, context);
    expect(incidents.reconcileIncidents(lost.incidents, undefined, context).incidents[0].status).toBe("open");
  });
});

describe("the health monitor on a live run", () => {
  it("should raise a single incident and a single activity, then resolve it when the pilot acts again", async () => {
    const session = idleRun("run-monitor");
    await monitor.applyHealth(session, T0 + 30_000, policy);
    expect(session.state.incidents ?? []).toEqual([]);
    expect(session.state.status).toBe("running");
    await monitor.applyHealth(session, T0 + 61_000, policy);
    await monitor.applyHealth(session, T0 + 90_000, policy);
    expect(session.state.incidents).toHaveLength(1);
    expect(session.state.status).toBe("attention");
    expect(session.state.health).toMatchObject({ health: "stalled", title: "Plus aucune action en cours" });
    expect(session.state.activities.filter((entry) => entry.title === "Plus aucune action en cours")).toHaveLength(1);
    // Terminal output is not a resumption.
    session.appendTerminal("⠋ Thinking…");
    await monitor.applyHealth(session, T0 + 95_000, policy);
    expect(session.state.incidents![0].status).toBe("open");
    health.recordEngineSignal(session.signals, { kind: "tool.start", tool: "Read", toolUseId: "r1", background: false, endReported: false }, T0 + 100_000);
    await monitor.applyHealth(session, T0 + 100_000, policy);
    expect(session.state.incidents![0]).toMatchObject({ status: "resolved", resolution: { outcome: "Claude Code a repris la main" } });
    expect(session.state.status).toBe("running");
  });

  it("should persist the incident, so it survives the next crash", async () => {
    const session = idleRun("run-persisted");
    await monitor.applyHealth(session, T0 + 61_000, policy);
    const archived = JSON.parse(readFileSync(path.join(runsDirectory, "run-persisted", "run.json"), "utf8")) as RunState;
    expect(archived.incidents?.[0]).toMatchObject({ kind: "no_next_action", status: "open" });
    expect(archived.schemaVersion).toBe(incidents.RUN_SCHEMA_VERSION);
  });

  it("should not evaluate a run that left the registry", async () => {
    const session = idleRun("run-closed");
    await session.dispose();
    expect(await monitor.applyHealth(session, T0 + 61_000, policy)).toBe(false);
    expect(session.state.incidents).toBeUndefined();
  });

  it("should stop its ticks and refuse later evaluations once stopped", async () => {
    const session = idleRun("run-shutdown");
    const watcher = new monitor.RunMonitor(() => [session], policy, () => T0 + 61_000);
    watcher.stop();
    await watcher.tick();
    expect(await watcher.evaluate(session)).toBe(false);
    expect(session.state.incidents).toBeUndefined();
  });

  it("should restart its graces after the machine slept instead of opening an incident on wake-up", async () => {
    const session = idleRun("run-sleep");
    let now = T0 + 1_000;
    const watcher = new monitor.RunMonitor(() => [session], policy, () => now);
    await watcher.tick();
    now = T0 + 30 * 60_000;
    await watcher.tick();
    expect(session.signals.resumedAt).toBe(now);
    expect(session.state.incidents ?? []).toEqual([]);
    watcher.stop();
  });
});

describe("actions on an incident", () => {
  async function openedRun(id: string) {
    const session = idleRun(id);
    await monitor.applyHealth(session, T0 + 61_000, policy);
    const incident = session.state.incidents![0];
    return { session, incident };
  }

  it("should submit one continuation however many windows ask for it", async () => {
    const { session, incident } = await openedRun("run-continue");
    const submitted: string[] = [];
    const registry = registryWith(session, submitted);
    const request = { runId: session.id, incidentId: incident.id, expectedRevision: incident.revision, action: "request_continuation" as const };
    const [first, second] = await Promise.all([
      registry.incidentAction({ ...request, requestId: "window-a" }),
      registry.incidentAction({ ...request, requestId: "window-b" }),
    ]);
    expect(first.outcome).toBe("done");
    expect(second.outcome).toBe("refused");
    expect(second.message).toMatch(/situation a changé/);
    expect(submitted).toEqual([incidents.CONTINUATION_INSTRUCTION]);
    // The same request sent again is answered, not run again.
    expect(await registry.incidentAction({ ...request, requestId: "window-a" })).toMatchObject({ outcome: "duplicate" });
    expect(submitted).toHaveLength(1);
    // Asked is not resumed: the incident stays open until the pilot is seen acting.
    const current = session.state.incidents![0];
    expect(current).toMatchObject({ status: "open", continuation: { requestId: "window-a" } });
    expect(current.decisions).toEqual([expect.objectContaining({ requestId: "window-a", outcome: "done" })]);
    health.recordEngineSignal(session.signals, { kind: "tool.start", tool: "Read", toolUseId: "r1", background: false, endReported: false }, T0 + 70_000);
    await monitor.applyHealth(session, T0 + 70_000, policy);
    expect(session.state.incidents![0].resolution?.outcome).toBe("Reprise observée après la demande de continuation");
  });

  it("should refuse a continuation once the session started working again between display and click", async () => {
    const { session, incident } = await openedRun("run-stale");
    const submitted: string[] = [];
    const registry = registryWith(session, submitted);
    session.state.agents = [{ id: "a1", name: "implementation-harness:developer", status: "running", startedAt: new Date(T0).toISOString() }];
    const result = await registry.incidentAction({ runId: session.id, incidentId: incident.id, expectedRevision: incident.revision, requestId: "r1", action: "request_continuation" });
    expect(result).toMatchObject({ outcome: "refused" });
    expect(result.message).toMatch(/un agent est actif/);
    expect(submitted).toEqual([]);
  });

  it("should write the decision before its effect", async () => {
    const { session, incident } = await openedRun("run-decision");
    const registry = registryWith(session);
    let onDisk: RunState | undefined;
    session.engine!.submit = () => { onDisk = JSON.parse(readFileSync(path.join(runsDirectory, session.id, "run.json"), "utf8")) as RunState; };
    await registry.incidentAction({ runId: session.id, incidentId: incident.id, expectedRevision: incident.revision, requestId: "r-first", action: "request_continuation" });
    expect(onDisk?.incidents?.[0].decisions).toEqual([expect.objectContaining({ requestId: "r-first", outcome: "pending" })]);
  });

  it("should close an incident as a false positive only with a reason", async () => {
    const { session, incident } = await openedRun("run-dismiss");
    const registry = registryWith(session);
    const request = { runId: session.id, incidentId: incident.id, expectedRevision: incident.revision, action: "dismiss" as const };
    expect(await registry.incidentAction({ ...request, requestId: "d0" })).toMatchObject({ outcome: "refused" });
    expect(await registry.incidentAction({ ...request, requestId: "d1", reason: "Il attendait ma réponse dans le chat" })).toMatchObject({ outcome: "done" });
    expect(session.state.incidents![0]).toMatchObject({ status: "dismissed", resolution: { outcome: "Classé comme faux positif", detail: "Il attendait ma réponse dans le chat" } });
    await monitor.applyHealth(session, T0 + 120_000, policy);
    expect(session.state.incidents).toHaveLength(1);
    expect(session.state.health?.health).toBe("healthy");
  });
});

describe("after a restart", () => {
  function writeRun(runId: string, state: Partial<RunState>) {
    mkdirSync(path.join(runsDirectory, runId), { recursive: true });
    const full: RunState = { id: runId, status: "running", phase: 5, cwd: "/work/repo", issueUrl: "", instruction: "", startedAt: new Date(T0).toISOString(), endedAt: null, agents: [], activities: [], messages: [], artifacts: [], sessionActive: true, ...state };
    writeFileSync(path.join(runsDirectory, runId, "run.json"), JSON.stringify(full));
  }
  const read = (runId: string) => JSON.parse(readFileSync(path.join(runsDirectory, runId, "run.json"), "utf8")) as RunState;

  it("should add one interruption incident, keep an unanswerable question as context only, and do it once", async () => {
    writeRun("run-restart", { status: "attention", pendingQuestion: { id: "q1", questions: [{ question: "Quelle base ?", header: "Branche", options: [{ label: "develop" }], multiSelect: false }] } });
    await reconcileInterruptedRuns(runsDirectory);
    await reconcileInterruptedRuns(runsDirectory);
    const state = read("run-restart");
    expect(state).toMatchObject({ status: "failed", sessionActive: false, health: { health: "interrupted" } });
    expect(state.pendingQuestion).toBeUndefined();
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents![0].observations.find((observation) => observation.kind === "question")?.detail).toMatch(/Quelle base/);
  });

  it("should mark a decision left pending by a crash as an unknown outcome, never replay it", () => {
    const pending: RunIncident = {
      id: "i1", runId: "r", kind: "no_next_action", status: "open", revision: 2, detectedAt: "", updatedAt: "", fingerprint: "f", title: "t", reason: "r",
      observations: [], suggestedActions: [], decisions: [{ requestId: "x", action: "request_continuation", at: "", outcome: "pending" }],
    };
    const state = incidents.normalizeArchivedRun({ status: "failed", cwd: "/w", incidents: [pending] }, "r");
    expect(state?.incidents?.[0].decisions[0]).toMatchObject({ outcome: "unknown" });
  });

  it("should list interrupted runs read only, skip a corrupted archive, and drop a run once its incident is closed", async () => {
    writeRun("run-archived", { status: "running" });
    mkdirSync(path.join(runsDirectory, "run-corrupt"), { recursive: true });
    writeFileSync(path.join(runsDirectory, "run-corrupt", "run.json"), "{ not json");
    await reconcileInterruptedRuns(runsDirectory);
    const archive = new RunArchive();
    await archive.load(runsDirectory);
    const archived = archive.get("run-archived");
    expect(archived?.state).toMatchObject({ archived: true, sessionActive: false });
    expect(archived?.holdsRepository).toBe(false);
    expect(archive.get("run-corrupt")).toBeUndefined();
    expect(archive.list().some((summary) => summary.id === "run-archived" && summary.incident?.kind === "lost_session")).toBe(true);

    const registry = new RunRegistry();
    registry.monitor.stop();
    (registry as unknown as { archive: InstanceType<typeof RunArchive> }).archive.get = archive.get.bind(archive);
    const incident = archived!.state.incidents![0];
    expect(await registry.incidentAction({ runId: archived!.id, incidentId: incident.id, expectedRevision: incident.revision, requestId: "c1", action: "request_continuation" }))
      .toMatchObject({ outcome: "refused" });
    expect(await registry.incidentAction({ runId: archived!.id, incidentId: incident.id, expectedRevision: incident.revision, requestId: "c2", action: "dismiss", reason: "Relancé à la main" }))
      .toMatchObject({ outcome: "done" });
    archive.release(archived!.id);
    expect(archive.get("run-archived")).toBeUndefined();
    expect(read("run-archived").incidents![0].status).toBe("dismissed");
  });
});
