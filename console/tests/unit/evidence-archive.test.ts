import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { acceptanceInputKind, confinedPath, containedRelativePath, diskStorage, EvidenceArchive, memoryStorage } from "../../server/evidence-archive";

const criteria = JSON.stringify({ schemaVersion: 1, revision: 1, criteria: [{ id: "AC1", text: "Le filtre est conservé" }] });
const qa = (round: number, verdict: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  schemaVersion: 2, source: "qa", round, criteriaRevision: 1, codeSnapshot: { atStart: "snap-a", atEnd: "snap-a" },
  items: [{ id: `Q-R${round}`, label: "Filtre conservé", verdict, criterionIds: ["AC1"], screenshot: "assets/result.png", ...extra }],
});

function memoryArchive() {
  const files = new Map<string, Buffer>();
  const put = (name: string, content: string) => files.set(name, Buffer.from(content));
  const archive = new EvidenceArchive(memoryStorage((name) => files.get(name)), () => "2026-09-27T10:00:00.000Z");
  archive.currentSnapshot = { id: "snap-a", capturedAt: "2026-09-27T10:00:00.000Z" };
  archive.rememberSnapshot("snap-a", "2026-09-27T10:00:00.000Z");
  return { archive, files, put };
}

describe("evidence archive", () => {
  it("should recognize the documents coverage is computed from", () => {
    expect(acceptanceInputKind("acceptance-criteria.json")).toBe("criteria");
    expect(acceptanceInputKind("planner-output.json")).toBe("plan");
    expect(acceptanceInputKind("dev-evidence-T3.json")).toBe("evidence");
    expect(acceptanceInputKind("qa-report.md")).toBeUndefined();
  });

  it("should add nothing when the same content is seen twice", async () => {
    const { archive, put } = memoryArchive();
    put("acceptance-criteria.json", criteria);
    expect(await archive.ingest("acceptance-criteria.json")).toBe(true);
    expect(await archive.ingest("acceptance-criteria.json")).toBe(false);
    expect(archive.versions).toHaveLength(1);
  });

  it("should keep the last valid version when a report is caught half written", async () => {
    const { archive, put } = memoryArchive();
    put("acceptance-criteria.json", criteria);
    put("assets/result.png", "png-1");
    put("qa-evidence.json", qa(1, "pass"));
    await archive.ingest("acceptance-criteria.json");
    await archive.ingest("qa-evidence.json");
    put("qa-evidence.json", qa(2, "fail").slice(0, 40));
    expect(await archive.ingest("qa-evidence.json")).toBe(true);
    const view = archive.view();
    expect(archive.versions.filter((version) => version.file === "qa-evidence.json")).toHaveLength(1);
    expect(view.criteria[0].status).toBe("verified");
    expect(view.diagnostics.some((diagnostic) => diagnostic.file === "qa-evidence.json" && diagnostic.message.includes("Invalid or incomplete JSON"))).toBe(true);
  });

  it("should keep a round one capture distinct from the round two capture of the same name", async () => {
    const { archive, put } = memoryArchive();
    put("acceptance-criteria.json", criteria);
    await archive.ingest("acceptance-criteria.json");
    put("assets/result.png", "png-round-1");
    put("qa-evidence.json", qa(1, "fail"));
    await archive.ingest("qa-evidence.json");
    put("assets/result.png", "png-round-2");
    put("qa-evidence.json", qa(2, "pass", { supersedes: ["Q-R1"] }));
    await archive.ingest("qa-evidence.json");
    expect((await archive.read("evidence/qa-evidence.json/v1/assets/result.png"))?.toString()).toBe("png-round-1");
    expect((await archive.read("evidence/qa-evidence.json/v2/assets/result.png"))?.toString()).toBe("png-round-2");
    const check = archive.view().criteria[0].checks[0];
    expect(check.status).toBe("verified");
    expect(check.history[0]).toMatchObject({ id: "Q-R1", verdict: "fail" });
  });

  it("should drop a round copy's anomalies once the live report corrects them", async () => {
    const { archive, put } = memoryArchive();
    put("acceptance-criteria.json", criteria);
    put("assets/result.png", "png");
    await archive.ingest("acceptance-criteria.json");
    put("qa-evidence.json", qa(1, "measured live"));
    await archive.ingest("qa-evidence.json");
    put("qa-evidence-round1.json", qa(1, "measured live"));
    await archive.ingest("qa-evidence-round1.json");
    expect(archive.view().diagnostics.filter((diagnostic) => diagnostic.message.includes("Unknown verdict"))).toHaveLength(1);
    put("qa-evidence.json", qa(1, "pass"));
    await archive.ingest("qa-evidence.json");
    const view = archive.view();
    expect(view.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toEqual([]);
    expect(view.criteria[0].status).toBe("verified");
  });

  it("should archive a capture that arrives after the report naming it", async () => {
    const { archive, put } = memoryArchive();
    put("qa-evidence.json", qa(1, "pass"));
    await archive.ingest("qa-evidence.json");
    expect(archive.pendingAttachments()).toEqual(["assets/result.png"]);
    put("assets/result.png", "late");
    expect(await archive.retryPendingAttachments()).toBe(true);
    expect(archive.pendingAttachments()).toEqual([]);
    expect(archive.serves("evidence/qa-evidence.json/v1/assets/result.png")).toBe(true);
  });

  it("should archive a capture named from the repository root", async () => {
    const { archive, put } = memoryArchive();
    put("acceptance-criteria.json", criteria);
    put("assets/result.png", "png");
    put("qa-evidence.json", qa(1, "pass", { screenshot: ".claude/tasks/assets/result.png" }));
    await archive.ingest("acceptance-criteria.json");
    await archive.ingest("qa-evidence.json");
    expect(archive.pendingAttachments()).toEqual([]);
    expect((await archive.read("evidence/qa-evidence.json/v1/assets/result.png"))?.toString()).toBe("png");
    expect(archive.view().criteria[0].checks[0].status).toBe("verified");
  });

  it("should still reconstruct the run once the task directory is gone", async () => {
    const { archive, files, put } = memoryArchive();
    put("acceptance-criteria.json", criteria);
    put("assets/result.png", "png");
    put("qa-evidence.json", qa(1, "pass"));
    await archive.ingest("acceptance-criteria.json");
    await archive.ingest("qa-evidence.json");
    files.clear();
    expect(archive.view().criteria[0].status).toBe("verified");
    expect(await archive.read("evidence/qa-evidence.json/v1.json")).toBeDefined();
  });

  it("should refuse to archive or serve anything outside what it wrote", async () => {
    const { archive, put } = memoryArchive();
    put("qa-evidence.json", qa(1, "pass", { screenshot: "../../etc/passwd" }));
    await archive.ingest("qa-evidence.json");
    expect(archive.versions[0].attachments[0].archived).toBe(false);
    expect(await archive.read("evidence/index.json")).toBeUndefined();
    expect(containedRelativePath("../x.png")).toBeUndefined();
    expect(containedRelativePath("/etc/passwd")).toBeUndefined();
    expect(containedRelativePath("./assets/a.png")).toBe("assets/a.png");
    expect(containedRelativePath(".claude/tasks/")).toBeUndefined();
  });

  it("should serialise concurrent steps in the order they were asked", async () => {
    const { archive } = memoryArchive();
    const order: number[] = [];
    await Promise.all([
      archive.serialize(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); order.push(1); }),
      archive.serialize(async () => { order.push(2); }),
      archive.serialize(async () => { throw new Error("boom"); }).catch(() => order.push(3)),
      archive.serialize(async () => { order.push(4); }),
    ]);
    expect(order).toEqual([1, 2, 3, 4]);
  });
});

describe("evidence archive on disk", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), "evidence-archive-")); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("should refuse a symbolic link that leaves the task directory", async () => {
    const tasks = path.join(root, "repo", ".claude", "tasks");
    mkdirSync(path.join(tasks, "assets"), { recursive: true });
    writeFileSync(path.join(root, "secret.png"), "secret");
    symlinkSync(path.join(root, "secret.png"), path.join(tasks, "assets", "leak.png"));
    writeFileSync(path.join(tasks, "assets", "ok.png"), "ok");
    const storage = diskStorage(() => tasks, path.join(root, "data", "run-1"));
    expect(await storage.readSource("assets/leak.png")).toBeUndefined();
    expect((await storage.readSource("assets/ok.png"))?.toString()).toBe("ok");
    expect(await confinedPath(tasks, "../../secret.png")).toBeUndefined();
  });

  it("should keep two runs apart", async () => {
    const tasks = (name: string) => path.join(root, name, ".claude", "tasks");
    for (const name of ["one", "two"]) {
      mkdirSync(tasks(name), { recursive: true });
      writeFileSync(path.join(tasks(name), "acceptance-criteria.json"), JSON.stringify({ schemaVersion: 1, criteria: [{ id: `AC-${name}`, text: name }] }));
    }
    const one = new EvidenceArchive(diskStorage(() => tasks("one"), path.join(root, "data", "one")));
    const two = new EvidenceArchive(diskStorage(() => tasks("two"), path.join(root, "data", "two")));
    await one.ingest("acceptance-criteria.json");
    await two.ingest("acceptance-criteria.json");
    expect(one.view().criteria.map((criterion) => criterion.id)).toEqual(["AC-one"]);
    expect(two.view().criteria.map((criterion) => criterion.id)).toEqual(["AC-two"]);
  });
});
