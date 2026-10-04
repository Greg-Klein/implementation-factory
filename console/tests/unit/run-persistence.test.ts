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

  it("should read the checkout of a run archived before worktrees from its cwd", async () => {
    const { RunSession } = await import("../../server/run-session");
    const { normalizeArchivedRun } = await import("../../server/run-incidents");
    const restored = normalizeArchivedRun({ id: "run-legacy", status: "completed", phase: 10, cwd: "/work/legacy", issueUrl: "https://gitlab.com/acme/legacy/-/issues/3" }, "run-legacy");
    expect(restored).not.toHaveProperty("repository");
    expect(restored).not.toHaveProperty("worktree");
    expect(new RunSession("run-legacy", restored).summary()).toMatchObject({ cwd: "/work/legacy", repository: "/work/legacy" });
  });
});
