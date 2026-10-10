import { afterAll, describe, expect, it } from "@jest/globals";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDirectory = mkdtempSync(path.join(os.tmpdir(), "run-persistence-"));
process.env.IMPL_DATA_DIR = dataDirectory;

afterAll(() => rmSync(dataDirectory, { recursive: true, force: true }));

describe("run archive persistence", () => {
  it("should keep the latest state and a whole file when publications follow each other closely", async () => {
    const { RunSession } = await import("../../server/run-session");
    const session = new RunSession("run-persist", { status: "running", phase: 1, cwd: "/work/repo" });
    for (let phase = 2; phase <= 9; phase += 1) {
      session.state.phase = phase;
      void session.persist();
    }
    await session.persist();
    const runDirectory = path.join(dataDirectory, "runs", "run-persist");
    const archived = JSON.parse(readFileSync(path.join(runDirectory, "run.json"), "utf8")) as { phase: number };
    expect(archived.phase).toBe(9);
    expect(readdirSync(runDirectory).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("should keep the repository and the worktree of a run apart from where its session ran", async () => {
    const { RunSession } = await import("../../server/run-session");
    const { normalizeArchivedRun } = await import("../../server/run-incidents");
    const worktree = { path: "/work/repo/.claude/worktrees/run-worktree", state: "kept" as const, detail: "Worktree kept: unpushed changes", dependencies: "clone" as const };
    const session = new RunSession("run-worktree", { status: "stopped", phase: 5, cwd: worktree.path, repository: "/work/repo", worktree, archiveSyncedAt: "2026-10-03T10:00:00.000Z" });
    await session.persist();
    const raw = JSON.parse(readFileSync(path.join(dataDirectory, "runs", "run-worktree", "run.json"), "utf8")) as unknown;
    const restored = normalizeArchivedRun(raw, "run-worktree");
    expect(restored).toMatchObject({ cwd: worktree.path, repository: "/work/repo", worktree, archiveSyncedAt: "2026-10-03T10:00:00.000Z" });
    expect(new RunSession("run-worktree", restored).summary()).toMatchObject({ repository: "/work/repo", worktree });
  });

  it("should keep what the figures of a run are measured from", async () => {
    const { normalizeArchivedRun } = await import("../../server/run-incidents");
    const measured = {
      userWaits: [{ reason: "question", from: "2026-10-05T10:02:00.000Z", to: "2026-10-05T10:04:00.000Z" }], phaseArrivals: { 1: "2026-10-05T10:00:00.000Z" },
      reopenings: [{ from: "2026-10-05T11:00:00.000Z" }], reviewTier: 1, factory: { version: "0.10.0", commit: "c89a860" }, baseCommit: "a50714c",
      baseBranch: "feat-1", ticketBaseBranch: "develop", transcriptPath: "/home/.claude/projects/p/s.jsonl",
    };
    expect(normalizeArchivedRun({ status: "running", cwd: "/w", ...measured }, "r")).toMatchObject(measured);
  });

  it("should keep the review confidence of a run, the note of its delivery and its feedback count through a restart", async () => {
    const { RunSession } = await import("../../server/run-session");
    const { normalizeArchivedRun } = await import("../../server/run-incidents");
    const { buildRunMetrics, confidenceCalibration } = await import("../../server/run-metrics");
    const confidence = { score: 4, reasons: [{ rule: "sensitive_path", minus: 1, detail: "1 sensitive file changed." }, { rule: "incident_open", cap: 4, count: 2, detail: "2 incidents still open." }] };
    const session = new RunSession("run-confidence", { status: "completed", phase: 10, cwd: "/work/repo", startedAt: "2026-10-10T10:00:00.000Z", endedAt: "2026-10-10T10:30:00.000Z", confidence, confidenceAtDelivery: 4, feedbackCount: 2 });
    await session.persist();
    const restored = normalizeArchivedRun(JSON.parse(readFileSync(path.join(dataDirectory, "runs", "run-confidence", "run.json"), "utf8")) as unknown, "run-confidence")!;
    expect(restored).toMatchObject({ confidence, confidenceAtDelivery: 4, feedbackCount: 2 });
    expect(new RunSession("run-confidence", restored).summary().confidence).toBe(4);
    // What a restart writes again for a run whose figures were not final: the note still counts in the calibration.
    const figures = buildRunMetrics({ state: restored, usage: [], at: "2026-10-10T11:00:00.000Z" });
    expect(figures.outcome).toMatchObject({ confidence: 4, confidenceAtDelivery: 4, feedback: 2 });
    expect(confidenceCalibration([figures, { ...figures, runId: "b" }, { ...figures, runId: "c" }])).toEqual([{ score: 4, runs: 3, reopened: 0, feedback: 3 }]);
  });

  it("should keep a zero note and drop a confidence field that is not what it should be", async () => {
    const { normalizeArchivedRun } = await import("../../server/run-incidents");
    const archived = (fields: object) => normalizeArchivedRun({ status: "completed", cwd: "/w", ...fields }, "r")!;
    expect(archived({ confidence: { score: 0, reasons: [] }, confidenceAtDelivery: 0 })).toMatchObject({ confidence: { score: 0, reasons: [] }, confidenceAtDelivery: 0 });
    const damaged = archived({ confidence: { score: 9, reasons: [] }, confidenceAtDelivery: "4", feedbackCount: -1 });
    expect(damaged).not.toHaveProperty("confidence");
    expect(damaged).not.toHaveProperty("confidenceAtDelivery");
    expect(damaged).not.toHaveProperty("feedbackCount");
    expect(archived({ confidence: { score: 3 } }).confidence).toEqual({ score: 3, reasons: [] });
    expect(archived({ confidence: { score: 2, reasons: [null, { rule: "gate_failed", minus: 1 }, { rule: "x", detail: "No effect." }, { rule: "retired_rule", cap: 2, detail: "Kept as stored." }] } }).confidence)
      .toEqual({ score: 2, reasons: [{ rule: "retired_rule", cap: 2, detail: "Kept as stored." }] });
  });

  it("should read the checkout of a run archived before worktrees from its cwd", async () => {
    const { RunSession } = await import("../../server/run-session");
    const { normalizeArchivedRun } = await import("../../server/run-incidents");
    const restored = normalizeArchivedRun({ id: "run-legacy", status: "completed", phase: 10, cwd: "/work/legacy", issueUrl: "https://gitlab.com/acme/legacy/-/issues/3" }, "run-legacy");
    expect(restored).not.toHaveProperty("repository");
    expect(restored).not.toHaveProperty("worktree");
    expect(new RunSession("run-legacy", restored).summary()).toMatchObject({ cwd: "/work/legacy", repository: "/work/legacy" });
  });
});
