import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Watchers are never started here, and chokidar ships as ESM only.
jest.mock("chokidar", () => ({ __esModule: true, default: { watch: () => ({ on: () => undefined, close: async () => undefined }) } }));

const storage = mkdtempSync(path.join(os.tmpdir(), "factory-artifacts-"));
process.env.IMPL_DATA_DIR = storage;

let readArtifact: typeof import("../../server/artifacts").readArtifact;
let RunSession: typeof import("../../server/run-session").RunSession;

beforeAll(async () => {
  ({ readArtifact } = await import("../../server/artifacts"));
  ({ RunSession } = await import("../../server/run-session"));
});
afterAll(() => rmSync(storage, { recursive: true, force: true }));

/** A run whose list of documents is whatever the test says, including paths no run would ever list. */
function runListing(id: string, artifacts: string[]) {
  const archive = path.join(storage, "runs", id, "artifacts");
  mkdirSync(archive, { recursive: true });
  writeFileSync(path.join(archive, "qa-report.md"), "# QA\n");
  writeFileSync(path.join(storage, "runs", id, "run.json"), '{"secret":"ticket content"}');
  return { session: new RunSession(id, { status: "completed", cwd: `/work/${id}`, artifacts }), archive };
}

describe("a document asked of a run", () => {
  it("should serve a document the run archived", async () => {
    const { session } = runListing("run-read", ["qa-report.md"]);
    expect(await readArtifact(session, "qa-report.md")).toEqual({ path: "qa-report.md", content: "# QA\n" });
  });

  it("should refuse a document the run does not list", async () => {
    const { session } = runListing("run-unlisted", []);
    await expect(readArtifact(session, "qa-report.md")).rejects.toThrow("Document not found for this run.");
  });

  it("should refuse a path that leaves the archive even when the run lists it", async () => {
    const outside = ["../run.json", "../../run-read/artifacts/qa-report.md", path.join(storage, "runs", "run-leaving", "run.json")];
    const { session } = runListing("run-leaving", outside);
    for (const artifactPath of outside) await expect(readArtifact(session, artifactPath)).rejects.toThrow("Invalid document path.");
  });

  it("should refuse a link planted in the archive that points outside it", async () => {
    const { session, archive } = runListing("run-linked", ["notes.md"]);
    symlinkSync(path.join(storage, "runs", "run-linked", "run.json"), path.join(archive, "notes.md"));
    await expect(readArtifact(session, "notes.md")).rejects.toThrow("Invalid document path.");
  });
});
