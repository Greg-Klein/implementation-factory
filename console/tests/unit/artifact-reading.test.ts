import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Watchers are never started here, and chokidar ships as ESM only.
jest.mock("chokidar", () => ({ __esModule: true, default: { watch: () => ({ on: () => undefined, close: async () => undefined }) } }));

const storage = mkdtempSync(path.join(os.tmpdir(), "factory-artifacts-"));
process.env.IMPL_DATA_DIR = storage;

let readArtifact: typeof import("../../server/artifacts").readArtifact;
let readVideo: typeof import("../../server/artifacts").readVideo;
let RunSession: typeof import("../../server/run-session").RunSession;

beforeAll(async () => {
  ({ readArtifact, readVideo } = await import("../../server/artifacts"));
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

describe("a video capture asked of a run", () => {
  it("should serve an archived video as bytes with its type", async () => {
    const { session, archive } = runListing("run-video", ["assets/QA-R1-1-checkout.webm"]);
    mkdirSync(path.join(archive, "assets"), { recursive: true });
    writeFileSync(path.join(archive, "assets", "QA-R1-1-checkout.webm"), Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    const video = await readVideo(session, "assets/QA-R1-1-checkout.webm");
    expect(video.contentType).toBe("video/webm");
    expect([...video.content]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  });

  it("should refuse to preview a video as a document", async () => {
    const { session } = runListing("run-video-preview", ["assets/flow.mp4"]);
    await expect(readArtifact(session, "assets/flow.mp4")).rejects.toThrow("A video is played from its own address");
  });

  it("should refuse a document that is not a video", async () => {
    const { session } = runListing("run-video-type", ["qa-report.md"]);
    await expect(readVideo(session, "qa-report.md")).rejects.toThrow("This document is not a video.");
  });

  it("should refuse a video link planted in the archive that points outside it", async () => {
    const { session, archive } = runListing("run-video-linked", ["flow.webm"]);
    symlinkSync(path.join(storage, "runs", "run-video-linked", "run.json"), path.join(archive, "flow.webm"));
    await expect(readVideo(session, "flow.webm")).rejects.toThrow("Invalid document path.");
  });

  it("should refuse a video the run does not list", async () => {
    const { session } = runListing("run-video-unlisted", []);
    await expect(readVideo(session, "assets/flow.webm")).rejects.toThrow("Document not found for this run.");
  });
});
