import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunSession } from "../../server/run-session";

const storage = mkdtempSync(path.join(os.tmpdir(), "harness-gate-log-"));
process.env.IMPL_DATA_DIR = storage;
let runtime: typeof import("../../server/run-metrics-runtime");

beforeAll(async () => { runtime = await import("../../server/run-metrics-runtime"); });
afterAll(() => rmSync(storage, { recursive: true, force: true }));

const session = (id: string) => ({ id, metricsChain: Promise.resolve() }) as unknown as RunSession;
const line = (second: number, step: string, ms: number) => JSON.stringify({ at: `2026-10-03T10:00:0${second}.000Z`, agentId: "a1", step, result: "pass", ms });
const kept = (id: string) => readFileSync(path.join(storage, "runs", id, "gate-log.jsonl"), "utf8");

describe("the copy of the stop gate's log", () => {
  it("should add the new lines only when the log grows", async () => {
    const run = session("run-grows");
    const source = path.join(storage, "grows.jsonl");
    writeFileSync(source, `${line(1, "type-check", 20)}\n`);
    await runtime.keepGateLog(run, source);
    writeFileSync(source, `${line(1, "type-check", 20)}\n${line(2, "lint", 5)}\n`);
    await runtime.keepGateLog(run, source);
    await runtime.keepGateLog(run, source);
    expect(kept("run-grows")).toBe(`${line(1, "type-check", 20)}\n${line(2, "lint", 5)}\n`);
  });

  it("should keep the earlier lines when the workflow starts the log again", async () => {
    const run = session("run-restarts");
    const source = path.join(storage, "restarts.jsonl");
    writeFileSync(source, `${line(1, "type-check", 20)}\n`);
    await runtime.keepGateLog(run, source);
    writeFileSync(source, `${line(3, "type-check", 40)}\n`);
    await runtime.keepGateLog(run, source);
    expect(kept("run-restarts")).toBe(`${line(1, "type-check", 20)}\n${line(3, "type-check", 40)}\n`);
  });

  it("should give an archived run the gate times of its kept log", async () => {
    const directory = path.join(storage, "runs", "run-archived");
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "gate-log.jsonl"), `${line(1, "type-check", 20)}\n${line(2, "lint", 5)}\n`);
    writeFileSync(path.join(directory, "run.json"), JSON.stringify({ id: "run-archived", issueUrl: "https://gitlab.com/g/p/-/issues/1", status: "completed", phase: 10, startedAt: "2026-10-03T10:00:00.000Z", endedAt: "2026-10-03T10:20:00.000Z", cwd: path.join(storage, "gone"), agents: [], artifacts: [] }));
    await runtime.backfillRunMetrics(path.join(storage, "runs"));
    const metrics = JSON.parse(readFileSync(path.join(directory, "metrics.json"), "utf8"));
    expect(metrics.time.gate).toEqual({ ms: 25, steps: [{ step: "type-check", runs: 1, ms: 20 }, { step: "lint", runs: 1, ms: 5 }] });
  });
});
