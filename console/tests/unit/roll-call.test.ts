import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { rmSync } from "node:fs";
import { runScript, task, taskFixture } from "./task-scripts";

type Gate = { task?: string; verdict: string; agentId?: string; reason?: string; steps?: { step: string }[]; files?: string[] };
type Answer = { ok: boolean; missing: string[]; named: string[]; unknown: string[]; gates: Gate[]; unattributed: Gate[]; notes: string[] };

let fixture: ReturnType<typeof taskFixture>;

function call() {
  const { status, answer } = runScript("roll-call.mjs", fixture.cwd);
  return { status, ...(answer as Answer) };
}

function line(agentId: string, result: string, files: string[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({ at: "2026-01-01T00:00:00.000Z", agent: "implementation-harness:developer", agentId, retry: false, root: ".", step: "type-check", command: "npx tsc --noEmit", result, files, ...extra });
}

function gateOf(id: string) {
  return call().gates.find((gate) => gate.task === id);
}

beforeEach(() => {
  fixture = taskFixture("roll-call-");
  fixture.write("planner-output.json", { criteria_revision: 1, tasks: [task("T1", ["src/a.ts"]), task("T2", ["src/b/"])] });
  fixture.write("developer-report-T1.md", "done");
  fixture.write("developer-report-T2.md", "done");
});
afterEach(() => rmSync(fixture.cwd, { recursive: true, force: true }));

describe("the roll call of the plan", () => {
  it("should hold when every task has its report", () => {
    expect(call()).toMatchObject({ status: 0, ok: true, missing: [], named: [], unknown: [] });
  });

  it("should name the task that has no report", () => {
    rmSync(`${fixture.tasks}/developer-report-T2.md`);
    expect(call()).toMatchObject({ status: 1, ok: false, missing: ["T2"], gates: [{ task: "T1" }] });
  });

  it("should count as named, not missing, a task the merged report speaks of", () => {
    rmSync(`${fixture.tasks}/developer-report-T2.md`);
    fixture.write("developer-report.md", "T2 was not run: T1 covers it.");
    expect(call()).toMatchObject({ status: 0, ok: true, missing: [], named: ["T2"] });
  });

  it("should name a report whose suffix the plan does not carry, and accept a rework", () => {
    fixture.write("developer-report-T3.md", "drifted");
    fixture.write("developer-report-rework1.md", "rework");
    expect(call()).toMatchObject({ status: 1, ok: false, unknown: ["developer-report-T3.md"] });
  });

  it("should say the plan is missing rather than call an empty roll", () => {
    rmSync(`${fixture.tasks}/planner-output.json`);
    expect(call()).toMatchObject({ status: 1, ok: false, notes: ["planner-output.json is missing"] });
  });

  it("should not count a task as named because the report of another one cites it", () => {
    rmSync(`${fixture.tasks}/developer-report-T2.md`);
    fixture.write("developer-report.md", "<!-- section: T1 -->\n# T1\n\nT2 will wire it into the view.\n<!-- end section: T1 -->\n");
    expect(call()).toMatchObject({ status: 1, missing: ["T2"], named: [] });
  });

  it("should accept the fresh suffix of a continuation and a report the merged file ties to its task", () => {
    fixture.write("developer-report-T1b.md", "continuation");
    fixture.write("developer-report-T12.md", "another id, not a suffix of T1");
    fixture.write("developer-report-wiring.md", "drifted");
    expect(call()).toMatchObject({ status: 1, unknown: ["developer-report-T12.md", "developer-report-wiring.md"] });
    fixture.write("developer-report.md", "wiring implemented T2, T12 implemented T1.\n");
    expect(call()).toMatchObject({ status: 0, ok: true, unknown: [] });
  });
});

describe("the gate verdict of a task", () => {
  it("should be unchecked when no gate line names one of its files", () => {
    fixture.write("gate-log.jsonl", `${line("a1", "pass", ["src/other.ts"])}\n`);
    expect(gateOf("T1")).toEqual({ task: "T1", verdict: "unchecked", reason: "no gate line names a file of this task" });
    expect(call().status).toBe(0);
  });

  it("should pass when every check of the agent that edited its files passed", () => {
    fixture.write("gate-log.jsonl", [line("a1", "pass", ["src/a.ts"]), line("a1", "pass", ["src/a.ts"], { step: "lint" }), line("a2", "pass", ["src/b/list.ts"])].join("\n"));
    expect(gateOf("T1")).toEqual({ task: "T1", verdict: "pass", agent: "implementation-harness:developer", agentId: "a1" });
    expect(gateOf("T2")).toMatchObject({ verdict: "pass", agentId: "a2" });
  });

  it("should read the stop that followed a send-back, not the failure that caused it", () => {
    fixture.write("gate-log.jsonl", [line("a1", "fail", ["src/a.ts"]), line("a1", "pass", ["src/a.ts"], { retry: true })].join("\n"));
    expect(gateOf("T1")).toMatchObject({ verdict: "pass" });
  });

  it("should fail, with the step, when the agent failed again after being sent back", () => {
    fixture.write("gate-log.jsonl", [line("a1", "fail", ["src/a.ts"]), line("a1", "fail", ["src/a.ts"], { retry: true })].join("\n"));
    const result = call();
    expect(result.gates[0]).toMatchObject({ verdict: "fail", steps: [{ step: "type-check", root: ".", command: "npx tsc --noEmit" }] });
  });

  it("should say sent back while the agent has not stopped a second time", () => {
    fixture.write("gate-log.jsonl", line("a1", "fail", ["src/a.ts"]));
    expect(call()).toMatchObject({ gates: [{ verdict: "sent_back" }, { verdict: "unchecked" }] });
  });

  it("should be unchecked on an inconclusive or skipped check, and when no check ran", () => {
    fixture.write("gate-log.jsonl", [line("a1", "pass", ["src/a.ts"]), line("a1", "inconclusive", ["src/a.ts"], { step: "lint", detail: "type errors outside" }), line("a2", "none", ["src/b/x.ts"], { step: "no check found" })].join("\n"));
    expect(gateOf("T1")).toMatchObject({ verdict: "unchecked", reason: "a check was inconclusive or skipped", steps: [{ step: "lint", detail: "type errors outside" }] });
    expect(gateOf("T2")).toMatchObject({ verdict: "unchecked", reason: "no check ran" });
  });

  it("should take the verdict of the last agent that edited the task's files", () => {
    fixture.write("gate-log.jsonl", [line("a1", "pass", ["src/a.ts"]), line("r1", "fail", ["src/a.ts"]), line("r1", "fail", ["src/a.ts"], { retry: true })].join("\n"));
    expect(gateOf("T1")).toMatchObject({ verdict: "fail", agentId: "r1" });
  });

  it("should judge the last stop of an agent that was continued after a send-back", () => {
    const stops = [line("a1", "fail", ["src/a.ts"]), line("a1", "fail", ["src/a.ts"], { retry: true })];
    fixture.write("gate-log.jsonl", [...stops, line("a1", "pass", ["src/a.ts"])].join("\n"));
    expect(gateOf("T1")).toMatchObject({ verdict: "pass" });
    fixture.write("gate-log.jsonl", [line("a1", "fail", ["src/a.ts"]), line("a1", "pass", ["src/a.ts"], { retry: true }), line("a1", "fail", ["src/a.ts"])].join("\n"));
    expect(gateOf("T1")).toMatchObject({ verdict: "sent_back" });
  });

  it("should not let a peer that passed on its own file cover a failure in the same scope", () => {
    fixture.write("planner-output.json", { criteria_revision: 1, tasks: [task("T1", ["app/[locale]/home/page.tsx"]), task("T2", ["app/"])] });
    const home = "app/[locale]/home/page.tsx";
    fixture.write("gate-log.jsonl", [line("a1", "fail", [home]), line("a1", "fail", [home], { retry: true }), line("a2", "pass", ["app/[locale]/settings/page.tsx"])].join("\n"));
    expect(call()).toMatchObject({ gates: [{ task: "T1", verdict: "fail", agentId: "a1" }, { task: "T2", verdict: "fail", agentId: "a1" }], unattributed: [] });
  });

  it("should list a failure on files no task claims instead of dropping it", () => {
    fixture.write("planner-output.json", { criteria_revision: 1, tasks: [task("T1", []), task("T2", ["src/b/"])] });
    fixture.write("gate-log.jsonl", [line("a1", "fail", ["src/stores/index.ts"]), line("a1", "fail", ["src/stores/index.ts"], { retry: true }), line("a2", "pass", ["lib/x.ts"])].join("\n"));
    const result = call();
    expect(result.gates).toEqual([{ task: "T1", verdict: "unchecked", reason: "no gate line names a file of this task" }, { task: "T2", verdict: "unchecked", reason: "no gate line names a file of this task" }]);
    expect(result.unattributed).toEqual([{ agent: "implementation-harness:developer", agentId: "a1", verdict: "fail", steps: [{ step: "type-check", root: ".", command: "npx tsc --noEmit" }], files: ["src/stores/index.ts"] }]);
  });

  it("should count the lines it cannot read and judge on the others", () => {
    fixture.write("gate-log.jsonl", [line("a1", "pass", ["src/a.ts"]), "{ half a line", JSON.stringify({ result: "pass" })].join("\n"));
    const result = call();
    expect(result.notes).toEqual(["2 lines of gate-log.jsonl could not be read"]);
    expect(result.gates[0]).toMatchObject({ verdict: "pass" });
  });
});
