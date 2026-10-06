import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { runScript, task, taskFixture } from "./task-scripts";

type Answer = {
  ok: boolean;
  evidence: { sources: number; items: number; added: number; written: boolean; conflicts: { id: string; file: string }[]; invalid: { file: string; reason: string }[] };
  report: { sections: string[]; written: boolean };
  recipe: { sections: string[]; written: boolean };
  notes: string[];
};

let fixture: ReturnType<typeof taskFixture>;

function merge() {
  const { status, answer } = runScript("merge-outputs.mjs", fixture.cwd);
  return { status, ...(answer as Answer) };
}

function read(name: string) {
  return readFileSync(path.join(fixture.tasks, name), "utf8");
}

function merged() {
  return JSON.parse(read("dev-evidence.json")) as { schemaVersion: number; source: string; criteriaRevision?: number; items: Record<string, unknown>[] };
}

function evidence(items: Record<string, unknown>[], criteriaRevision = 1) {
  return { schemaVersion: 2, source: "developer", criteriaRevision, producer: { role: "developer" }, items };
}

function item(id: string, extra: Record<string, unknown> = {}) {
  return { id, label: `measure ${id}`, verdict: "measured", criterionIds: ["AC1"], codeSnapshotId: "snap-1", ...extra };
}

beforeEach(() => {
  fixture = taskFixture("merge-outputs-");
  fixture.write("planner-output.json", { criteria_revision: 1, tasks: [task("T1", ["a.ts"]), task("T2", ["b.ts"]), task("T10", ["c.ts"])] });
});
afterEach(() => rmSync(fixture.cwd, { recursive: true, force: true }));

describe("the merge of the developers' evidence", () => {
  it("should copy every item unchanged, in the order of the plan", () => {
    fixture.write("dev-evidence-T10.json", evidence([item("T10-E1")]));
    fixture.write("dev-evidence-T2.json", evidence([item("T2-E1", { supersedes: ["T2-E0"], note: "kept as written" })]));
    fixture.write("dev-evidence-T1.json", evidence([item("T1-E1"), item("T1-E2")]));
    expect(merge()).toMatchObject({ status: 0, ok: true, evidence: { sources: 3, items: 4, added: 4, written: true } });
    expect(merged()).toEqual({
      schemaVersion: 2, source: "developer", criteriaRevision: 1,
      items: [item("T1-E1"), item("T1-E2"), item("T2-E1", { supersedes: ["T2-E0"], note: "kept as written" }), item("T10-E1")],
    });
  });

  it("should change nothing when it runs a second time", () => {
    fixture.write("dev-evidence-T1.json", evidence([item("T1-E1")]));
    merge();
    const first = read("dev-evidence.json");
    expect(merge()).toMatchObject({ ok: true, evidence: { items: 1, added: 0, written: false } });
    expect(read("dev-evidence.json")).toBe(first);
    expect(readdirSync(fixture.tasks).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("should keep the items of an earlier batch when a later one adds its own", () => {
    fixture.write("dev-evidence-T1.json", evidence([item("T1-E1")]));
    merge();
    rmSync(path.join(fixture.tasks, "dev-evidence-T1.json"));
    fixture.write("dev-evidence-rework1.json", evidence([item("rework1-E1", { supersedes: ["T1-E1"] })]));
    expect(merge()).toMatchObject({ ok: true, evidence: { items: 2, added: 1 } });
    expect(merged().items.map((entry) => entry.id)).toEqual(["T1-E1", "rework1-E1"]);
  });

  it("should refuse an id that comes back with another content, name it and keep the first", () => {
    fixture.write("dev-evidence-T1.json", evidence([item("T1-E1", { actual: "12px" })]));
    merge();
    fixture.write("dev-evidence-T1.json", evidence([item("T1-E1", { actual: "16px" }), item("T1-E2")]));
    const result = merge();
    expect(result).toMatchObject({ status: 1, ok: false, evidence: { conflicts: [{ id: "T1-E1", file: "dev-evidence-T1.json" }], added: 1 } });
    expect(merged().items).toEqual([item("T1-E1", { actual: "12px" }), item("T1-E2")]);
  });

  it("should take for the same item one whose fields are written in another order", () => {
    fixture.write("dev-evidence-T1.json", evidence([{ id: "T1-E1", label: "a", verdict: "measured" }]));
    merge();
    fixture.write("dev-evidence-T1.json", evidence([{ verdict: "measured", label: "a", id: "T1-E1" }]));
    expect(merge()).toMatchObject({ ok: true, evidence: { conflicts: [], added: 0 } });
  });

  it("should leave on an item the older criteria revision it was read under", () => {
    fixture.write("dev-evidence-T1.json", evidence([item("T1-E1")], 1));
    fixture.write("dev-evidence-T2.json", evidence([item("T2-E1")], 2));
    merge();
    expect(merged()).toMatchObject({ criteriaRevision: 2, items: [{ ...item("T1-E1"), criteriaRevision: 1 }, item("T2-E1")] });
    expect(merged().items[1]).not.toHaveProperty("criteriaRevision");
    expect(merge()).toMatchObject({ ok: true, evidence: { written: false, conflicts: [] } });
  });

  it("should name a file it cannot read and an item without an id, and merge the rest", () => {
    fixture.write("dev-evidence-T1.json", "{ not json");
    fixture.write("dev-evidence-T2.json", evidence([{ label: "no id" }, item("T2-E1")]));
    const result = merge();
    expect(result.status).toBe(1);
    expect(result.evidence.invalid).toEqual([{ file: "dev-evidence-T1.json", reason: expect.any(String) }, { file: "dev-evidence-T2.json", reason: "item 1 has no id" }]);
    expect(merged().items).toEqual([item("T2-E1")]);
  });

  it("should keep aside a merged file it cannot read before writing it again", () => {
    fixture.write("dev-evidence.json", "{ half written");
    fixture.write("dev-evidence-T1.json", evidence([item("T1-E1")]));
    const result = merge();
    expect(result.notes).toEqual([expect.stringMatching(/^dev-evidence\.json could not be read whole .*: kept as dev-evidence\.json\.unreadable-\d+, /)]);
    expect(merged().items).toEqual([item("T1-E1")]);
    const aside = readdirSync(fixture.tasks).find((name) => name.startsWith("dev-evidence.json.unreadable-"));
    expect(read(aside ?? "")).toBe("{ half written");
  });

  it("should keep aside a merged file of the wrong shape, and what it held that could be read", () => {
    fixture.write("dev-evidence.json", { schemaVersion: 2, source: "developer", criteriaRevision: 1, items: [item("T1-E1"), { label: "no id" }] });
    fixture.write("dev-evidence-T2.json", evidence([item("T2-E1")]));
    expect(merge()).toMatchObject({ ok: true, notes: [expect.stringMatching(/item 2 has no id.*kept as dev-evidence\.json\.unreadable-\d+,/)] });
    expect(merged().items).toEqual([item("T1-E1"), item("T2-E1")]);
    const aside = readdirSync(fixture.tasks).find((name) => name.startsWith("dev-evidence.json.unreadable-"));
    expect(JSON.parse(read(aside ?? "")).items).toHaveLength(2);
    fixture.write("dev-evidence.json", [item("T9-E1")]);
    merge();
    expect(readdirSync(fixture.tasks).filter((name) => name.startsWith("dev-evidence.json.unreadable-"))).toHaveLength(2);
  });

  it("should write on each item the method and code version its file states once for all", () => {
    const { codeSnapshotId: _own, ...bare } = item("T1-E1");
    fixture.write("dev-evidence-T1.json", { ...evidence([bare, item("T1-E2", { method: "browser" })]), method: "test", codeSnapshot: { atStart: "snap-a", atEnd: "snap-b" } });
    merge();
    expect(merged().items).toEqual([{ ...bare, method: "test", codeSnapshotId: "snap-a", codeSnapshotAtEnd: "snap-b" }, item("T1-E2", { method: "browser" })]);
    expect(merge()).toMatchObject({ ok: true, evidence: { conflicts: [], written: false } });
  });

  it("should read a file that states no criteria revision as written under the first", () => {
    const { criteriaRevision: _none, ...unstated } = evidence([item("T1-E1")]);
    fixture.write("dev-evidence-T1.json", unstated);
    fixture.write("dev-evidence-T2.json", evidence([item("T2-E1")], 2));
    merge();
    expect(merged()).toMatchObject({ criteriaRevision: 2, items: [{ id: "T1-E1", criteriaRevision: 1 }, { id: "T2-E1" }] });
  });

  it("should write no merged file when no developer measured anything", () => {
    expect(merge()).toMatchObject({ ok: true, evidence: { sources: 0, items: 0, written: false } });
    expect(readdirSync(fixture.tasks)).toEqual(["planner-output.json"]);
  });
});

describe("the merge of the developers' reports", () => {
  it("should give each report its section, headed by its task, in the order of the plan", () => {
    fixture.write("developer-report-T2.md", "# Rapport développeur\n\nsecond\n");
    fixture.write("developer-report-T1.md", "# Rapport développeur\n\nfirst\n");
    expect(merge().report).toEqual({ sections: ["T1", "T2"], written: true });
    expect(read("developer-report.md")).toBe([
      "<!-- section: T1 -->", "# T1: Task T1", "", "# Rapport développeur", "", "first", "<!-- end section: T1 -->", "",
      "<!-- section: T2 -->", "# T2: Task T2", "", "# Rapport développeur", "", "second", "<!-- end section: T2 -->", "",
    ].join("\n"));
  });

  it("should replace only the section of the report that changed and keep what the pilot wrote beside them", () => {
    fixture.write("developer-report-T1.md", "first");
    fixture.write("developer-report-T2.md", "second");
    merge();
    fixture.write("developer-report.md", `T10 was not run: T2 covers it.\n\n${read("developer-report.md")}`);
    fixture.write("developer-report-T1.md", "first, measured again for $1 and $&");
    rmSync(path.join(fixture.tasks, "developer-report-T2.md"));
    fixture.write("developer-report-rework1.md", "rework");
    expect(merge().report).toEqual({ sections: ["T1", "rework1"], written: true });
    const text = read("developer-report.md");
    expect(text.startsWith("T10 was not run: T2 covers it.\n\n<!-- section: T1 -->\n# T1: Task T1\n\nfirst, measured again for $1 and $&\n<!-- end section: T1 -->\n")).toBe(true);
    expect(text).toContain("<!-- section: T2 -->\n# T2: Task T2\n\nsecond\n<!-- end section: T2 -->\n");
    expect(text.endsWith("<!-- section: rework1 -->\n# rework1\n\nrework\n<!-- end section: rework1 -->\n")).toBe(true);
    expect(text.match(/<!-- section: /g)).toHaveLength(3);
    expect(merge().report.written).toBe(false);
  });

  it("should assemble the scoped recipes the same way, in a file of their own", () => {
    fixture.write("browser-recipe-T1.md", "open /settings");
    expect(merge().recipe).toEqual({ sections: ["T1"], written: true });
    expect(read("browser-recipe.md")).toBe("<!-- section: T1 -->\n# T1: Task T1\n\nopen /settings\n<!-- end section: T1 -->\n");
    expect(readdirSync(fixture.tasks)).not.toContain("developer-report.md");
  });
});
