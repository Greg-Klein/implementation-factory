import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { rmSync } from "node:fs";
import { REGISTRY, runScript, task, taskFixture } from "./task-scripts";

type Answer = { ok: boolean; problems: string[]; notes: string[]; batches: string[][]; sequential: { tasks: string[]; paths: string[] }[] };

let fixture: ReturnType<typeof taskFixture>;

function check(tasks: unknown[], plan: Record<string, unknown> = {}, registry: unknown = REGISTRY) {
  fixture.write("planner-output.json", { criteria_revision: 1, tasks, ...plan });
  if (registry) fixture.write("acceptance-criteria.json", registry);
  const { status, answer } = runScript("plan-batches.mjs", fixture.cwd);
  return { status, ...(answer as Answer) };
}

beforeEach(() => { fixture = taskFixture("plan-batches-"); });
afterEach(() => rmSync(fixture.cwd, { recursive: true, force: true }));

describe("the plan check", () => {
  it("should run together the tasks whose files are disjoint and keep apart the two that share one", () => {
    const result = check([task("T1", ["src/store.ts"]), task("T2", ["src/hook.ts"]), task("T3", ["src/store.ts", "src/view.tsx"])]);
    expect(result).toMatchObject({ status: 0, ok: true, batches: [["T1", "T2"], ["T3"]] });
    expect(result.sequential).toEqual([{ tasks: ["T1", "T3"], paths: ["src/store.ts"] }]);
  });

  it("should never put a task in the batch of one it depends on, though their files are disjoint", () => {
    const result = check([task("T1", ["a.ts"]), task("T2", ["b.ts"], { dependencies: ["T1"] }), task("T3", ["c.ts"])]);
    expect(result.batches).toEqual([["T1", "T3"], ["T2"]]);
  });

  it("should read a directory and a pattern as holding the files under them", () => {
    const result = check([task("T1", ["src/ui/"]), task("T2", ["src/ui/button.tsx"]), task("T3", ["tests/**/*.spec.ts"]), task("T4", ["tests/e2e/login.spec.ts"])]);
    expect(result.batches).toEqual([["T1", "T3"], ["T2", "T4"]]);
  });

  it("should not take a file for another one whose name starts the same way", () => {
    expect(check([task("T1", ["src/list.ts"]), task("T2", ["src/list.test.ts"])]).batches).toEqual([["T1", "T2"]]);
  });

  it("should take for one file two paths spelled differently", () => {
    const spellings = ["src/a.ts (new)", "src/a.ts:10-40", "/src/a.ts", "./src/x/../a.ts", "src/A.ts"];
    for (const spelling of spellings) expect(check([task("T1", ["src/a.ts"]), task("T2", [spelling])]).batches).toEqual([["T1"], ["T2"]]);
  });

  it("should read a bracket as part of a name, not as a pattern", () => {
    expect(check([task("T1", ["app/[locale]/home/page.tsx"]), task("T2", ["app/[locale]/settings/page.tsx"])]).batches).toEqual([["T1", "T2"]]);
  });

  it("should run two tasks that share a file in the order of the plan, even when a later one is free", () => {
    const result = check([task("T1", ["a.ts"]), task("T2", ["a.ts", "b.ts"]), task("T3", ["b.ts"]), task("T4", ["c.ts"])]);
    expect(result.batches).toEqual([["T1", "T4"], ["T2"], ["T3"]]);
  });

  it("should let a dependency win over the order of the plan on a shared file", () => {
    expect(check([task("T1", ["a.ts"], { dependencies: ["T2"] }), task("T2", ["a.ts"])]).batches).toEqual([["T2"], ["T1"]]);
  });

  it("should read file_paths and technical_notes written as one text", () => {
    const registry = { ...REGISTRY, criteria: [{ id: "AC1" }, { id: "AC2" }] };
    const result = check([task("T1", ["a.ts"]), { ...task("T2", []), file_paths: "a.ts" }], { technical_notes: "AC2 is left to the next ticket." }, registry);
    expect(result).toMatchObject({ ok: true, batches: [["T1"], ["T2"]], notes: ["AC2 is served by no task and named in technical_notes"] });
  });

  it("should run more than three disjoint tasks in batches of three", () => {
    const result = check(["a", "b", "c", "d"].map((name, index) => task(`T${index + 1}`, [`${name}.ts`])));
    expect(result.batches).toEqual([["T1", "T2", "T3"], ["T4"]]);
  });

  it("should run alone a task that names no file", () => {
    const result = check([task("T1", ["a.ts"]), task("T2", []), task("T3", ["c.ts"])]);
    expect(result.batches).toEqual([["T1", "T3"], ["T2"]]);
    expect(result.notes).toContain("T2 names no file_paths and runs alone");
  });

  it("should refuse a plan whose dependencies form a loop or name an unknown task", () => {
    const loop = check([task("T1", ["a.ts"], { dependencies: ["T2"] }), task("T2", ["b.ts"], { dependencies: ["T1"] })]);
    expect(loop).toMatchObject({ status: 1, ok: false, batches: [] });
    expect(loop.problems).toEqual(["T1, T2 wait on each other: the dependencies form a loop"]);
    expect(check([task("T1", ["a.ts"], { dependencies: ["T9"] })]).problems).toEqual(["T1 depends on T9, which the plan does not hold"]);
  });

  it("should refuse a criterion the registry does not hold and one no task serves", () => {
    const registry = { ...REGISTRY, criteria: [{ id: "AC1" }, { id: "AC2" }] };
    const result = check([task("T1", ["a.ts"], { criterion_ids: ["AC1", "AC7"] })], {}, registry);
    expect(result.status).toBe(1);
    expect(result.problems).toEqual(["T1 cites AC7, which the registry does not hold", "AC2 is served by no task and technical_notes does not say why"]);
  });

  it("should accept a criterion no task serves once technical_notes names it, and not on a longer id", () => {
    const registry = { ...REGISTRY, criteria: [{ id: "AC1" }, { id: "AC2" }] };
    const named = check([task("T1", ["a.ts"])], { technical_notes: ["AC2 is verified after deployment only."] }, registry);
    expect(named).toMatchObject({ ok: true, notes: ["AC2 is served by no task and named in technical_notes"] });
    expect(check([task("T1", ["a.ts"])], { technical_notes: ["AC21 is out of scope."] }, registry).ok).toBe(false);
  });

  it("should refuse a plan written for another revision of the criteria", () => {
    const result = check([task("T1", ["a.ts"])], {}, { ...REGISTRY, revision: 2 });
    expect(result.problems).toEqual(["the plan was written for revision 1 of the criteria, the registry is at revision 2"]);
  });

  it("should report a missing registry and a task without an id, and still order the rest", () => {
    const result = check([task("T1", ["a.ts"]), { title: "no id" }], {}, null);
    expect(result.status).toBe(1);
    expect(result.problems).toEqual(["task 2 of planner-output.json has no id", "acceptance-criteria.json is missing: the registry is written before the plan"]);
    expect(result.batches).toEqual([["T1"]]);
  });

  it("should tell a plan that cannot be parsed from one that is not there", () => {
    expect((runScript("plan-batches.mjs", fixture.cwd).answer as Answer).problems).toEqual(["planner-output.json is missing"]);
    fixture.write("planner-output.json", "{ not json");
    expect((runScript("plan-batches.mjs", fixture.cwd).answer as Answer).problems[0]).toMatch(/^planner-output\.json cannot be read: /);
  });
});
