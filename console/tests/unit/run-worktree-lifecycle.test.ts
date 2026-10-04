import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunState, WorkflowState } from "../../server/types";

// Watchers are never started here, and chokidar ships as ESM only.
jest.mock("chokidar", () => ({ __esModule: true, default: { watch: () => ({ on: () => undefined, close: async () => undefined }) } }));

const storage = realpathSync(mkdtempSync(path.join(os.tmpdir(), "harness-run-worktrees-")));
process.env.IMPL_DATA_DIR = path.join(storage, "data");
const runsDirectory = path.join(storage, "data", "runs");

let lifecycle: typeof import("../../server/run-worktrees");
let RunSession: typeof import("../../server/run-session").RunSession;
let RunArchive: typeof import("../../server/run-archive").RunArchive;
let RunRegistry: typeof import("../../server/registry").RunRegistry;

beforeAll(async () => {
  lifecycle = await import("../../server/run-worktrees");
  ({ RunSession } = await import("../../server/run-session"));
  ({ RunArchive } = await import("../../server/run-archive"));
  ({ RunRegistry } = await import("../../server/registry"));
});
afterAll(() => rmSync(storage, { recursive: true, force: true }));

const MR = "https://gitlab.com/group/repo/-/merge_requests/3";
const ISSUE = "https://gitlab.com/group/repo/-/issues/1";
const completedWorkflow: WorkflowState = { schemaVersion: 1, revision: 9, state: "completed", result: { delivery: "merge_request", mergeRequestUrl: MR, blockers: [] }, receivedAt: "2026-10-03T10:00:00.000Z" };

let repository: string;
let counter = 0;

function git(directory: string, ...args: string[]) {
  return execFileSync("git", ["-C", directory, "-c", "user.email=test@example.com", "-c", "user.name=Test", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

beforeEach(() => {
  counter += 1;
  repository = path.join(storage, `repo-${counter}`);
  const remote = path.join(storage, `remote-${counter}.git`);
  mkdirSync(repository);
  execFileSync("git", ["init", "-q", "--bare", remote]);
  git(repository, "init", "-q", "-b", "main");
  writeFileSync(path.join(repository, ".gitignore"), "node_modules/\n");
  writeFileSync(path.join(repository, "app.ts"), "export const answer = 42;\n");
  git(repository, "add", ".");
  git(repository, "commit", "-q", "-m", "init");
  git(repository, "remote", "add", "origin", remote);
  git(repository, "push", "-q", "-u", "origin", "main");
  mkdirSync(path.join(repository, "node_modules", "dep"), { recursive: true });
  writeFileSync(path.join(repository, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
});
afterEach(() => rmSync(runsDirectory, { recursive: true, force: true }));

/** A run whose session is gone, in the worktree the console prepared for it, with a pushed ticket branch. */
async function finishedRun(id: string, overrides: Partial<RunState> = {}) {
  const { worktree } = await lifecycle.prepareRunWorktree(repository, id);
  git(worktree.path, "checkout", "-q", "-b", `feat/${id}`);
  writeFileSync(path.join(worktree.path, "app.ts"), "export const answer = 43;\n");
  git(worktree.path, "commit", "-q", "-am", "feat: answer");
  git(worktree.path, "push", "-q", "-u", "origin", `feat/${id}`);
  const session = new RunSession(id, {
    status: "completed", phase: 10, cwd: worktree.path, repository, worktree, issueUrl: ISSUE, sessionActive: false,
    startedAt: "2026-10-03T09:00:00.000Z", endedAt: "2026-10-03T10:00:00.000Z",
    mergeRequestUrl: MR, workflow: completedWorkflow, archiveSyncedAt: "2026-10-03T10:00:30.000Z", ...overrides,
  });
  return { session, worktree: worktree.path };
}

function writeRun(state: RunState) {
  mkdirSync(path.join(runsDirectory, state.id!), { recursive: true });
  writeFileSync(path.join(runsDirectory, state.id!, "run.json"), JSON.stringify(state, null, 2));
}
const readRun = (id: string) => JSON.parse(readFileSync(path.join(runsDirectory, id, "run.json"), "utf8")) as RunState;

describe("the worktree a run starts in", () => {
  it("should be created under the repository, filled from the checkout, and reported as active", async () => {
    const prepared = await lifecycle.prepareRunWorktree(repository, "run-start");
    expect(prepared.worktree).toMatchObject({ path: path.join(repository, ".claude", "worktrees", "run-start"), state: "active", dependencies: "clone" });
    expect(existsSync(path.join(prepared.worktree.path, "node_modules", "dep", "index.js"))).toBe(true);
    expect(prepared.summary).toContain("1 dependency directory cloned");
    expect(git(repository, "status", "--porcelain")).toBe("");
  });

  it("should fail rather than hand back a path when the repository cannot take a worktree", async () => {
    const plain = path.join(storage, `plain-${counter}`);
    mkdirSync(plain);
    await expect(lifecycle.prepareRunWorktree(plain, "run-plain")).rejects.toThrow();
  });
});

describe("what becomes of the worktree when the session is gone", () => {
  it("should remove it once the run delivered, and keep the branch", async () => {
    const { session, worktree } = await finishedRun("run-delivered");
    await lifecycle.settleRunWorktree(session);
    expect(session.state.worktree).toMatchObject({ state: "removed", detail: "Worktree removed" });
    expect(existsSync(worktree)).toBe(false);
    expect(git(repository, "rev-parse", "--verify", "feat/run-delivered")).toBeTruthy();
    expect(existsSync(path.join(repository, "node_modules", "dep", "index.js"))).toBe(true);
    expect(session.state.activities[0].title).toBe("Worktree removed");
  });

  it("should keep it, with the reason, when the run opened no merge request", async () => {
    const { session, worktree } = await finishedRun("run-stopped", { status: "stopped", mergeRequestUrl: undefined, workflow: undefined });
    await lifecycle.settleRunWorktree(session);
    expect(session.state.worktree).toMatchObject({ state: "kept", detail: "Worktree kept: no merge request" });
    expect(existsSync(worktree)).toBe(true);
  });

  it("should keep it when commits never reached the remote", async () => {
    const { session, worktree } = await finishedRun("run-unpushed");
    writeFileSync(path.join(worktree, "app.ts"), "export const answer = 44;\n");
    git(worktree, "commit", "-q", "-am", "fix: later");
    await lifecycle.settleRunWorktree(session);
    expect(session.state.worktree).toMatchObject({ state: "kept", detail: "Worktree kept: unpushed changes" });
    expect(existsSync(worktree)).toBe(true);
  });

  it("should keep it until the archive of the evidence is confirmed", async () => {
    const { session } = await finishedRun("run-unsynced", { archiveSyncedAt: undefined });
    await lifecycle.settleRunWorktree(session);
    expect(session.state.worktree).toMatchObject({ state: "kept", detail: "Worktree kept: evidence archive not confirmed" });
  });

  it("should touch nothing while the session is still open", async () => {
    const { session, worktree } = await finishedRun("run-open", { sessionActive: true });
    await lifecycle.settleRunWorktree(session);
    expect(session.state.worktree?.state).toBe("active");
    expect(existsSync(worktree)).toBe(true);
  });

  it("should say the same thing once, however many times it is asked", async () => {
    const { session } = await finishedRun("run-twice", { status: "stopped", mergeRequestUrl: undefined });
    await lifecycle.settleRunWorktree(session);
    await lifecycle.settleRunWorktree(session);
    expect(session.state.activities.filter((entry) => entry.title === "Worktree kept")).toHaveLength(1);
  });
});

describe("a removal the user asks for", () => {
  it("should remove a kept worktree that holds nothing to lose without asking", async () => {
    const { session, worktree } = await finishedRun("run-manual", { status: "stopped", mergeRequestUrl: undefined });
    await lifecycle.settleRunWorktree(session);
    await expect(lifecycle.removeWorktreeOnRequest(session, false)).resolves.toMatchObject({ outcome: "removed" });
    expect(existsSync(worktree)).toBe(false);
    expect(session.state.worktree?.state).toBe("removed");
    expect(git(repository, "rev-parse", "--verify", "feat/run-manual")).toBeTruthy();
  });

  it("should ask for a confirmation when work is uncommitted, and remove nothing until it comes", async () => {
    const { session, worktree } = await finishedRun("run-dirty", { status: "failed", mergeRequestUrl: undefined });
    writeFileSync(path.join(worktree, "draft.md"), "to pick up again\n");
    const asked = await lifecycle.removeWorktreeOnRequest(session, false);
    expect(asked).toMatchObject({ outcome: "confirm", risks: ["uncommitted changes"] });
    expect(asked.message).toContain("the branch and its commits stay");
    expect(existsSync(path.join(worktree, "draft.md"))).toBe(true);
    await expect(lifecycle.removeWorktreeOnRequest(session, true)).resolves.toMatchObject({ outcome: "removed" });
    expect(existsSync(worktree)).toBe(false);
    expect(git(repository, "rev-parse", "--verify", "feat/run-dirty")).toBeTruthy();
  });

  it("should ask for a confirmation when commits are not on the remote", async () => {
    const { session, worktree } = await finishedRun("run-local");
    writeFileSync(path.join(worktree, "app.ts"), "export const answer = 45;\n");
    git(worktree, "commit", "-q", "-am", "fix: local only");
    await expect(lifecycle.removeWorktreeOnRequest(session, false)).resolves.toMatchObject({ outcome: "confirm", risks: ["unpushed changes"] });
    expect(existsSync(worktree)).toBe(true);
  });

  it("should refuse while the session lives, forced or not", async () => {
    const { session, worktree } = await finishedRun("run-live", { status: "running", sessionActive: true });
    await expect(lifecycle.removeWorktreeOnRequest(session, true)).resolves.toMatchObject({ outcome: "refused" });
    expect(existsSync(worktree)).toBe(true);
  });

  it("should refuse a path the harness did not create, whatever the archive claims", async () => {
    const { session } = await finishedRun("run-forged", { status: "stopped" });
    session.state.worktree = { path: repository, state: "kept" };
    await expect(lifecycle.removeWorktreeOnRequest(session, true)).resolves.toMatchObject({ outcome: "refused" });
    expect(existsSync(path.join(repository, "app.ts"))).toBe(true);
  });

  it("should record a worktree that already vanished as removed", async () => {
    const { session, worktree } = await finishedRun("run-gone", { status: "stopped", mergeRequestUrl: undefined });
    rmSync(worktree, { recursive: true, force: true });
    await expect(lifecycle.removeWorktreeOnRequest(session, false)).resolves.toMatchObject({ outcome: "removed" });
    expect(session.state.worktree?.state).toBe("removed");
    expect(git(repository, "worktree", "list")).not.toContain("run-gone");
  });

  it("should remove the worktree of an archived run through the registry, then let the run leave the list", async () => {
    const { session } = await finishedRun("run-archived", { status: "stopped", mergeRequestUrl: undefined });
    await lifecycle.settleRunWorktree(session);
    await session.persist();
    const registry = new RunRegistry();
    registry.monitor.stop();
    await registry.archive.load(runsDirectory);
    expect(registry.snapshot().archived.map((run) => run.id)).toEqual(["run-archived"]);
    await expect(registry.removeWorktree("run-archived", false)).resolves.toMatchObject({ outcome: "removed" });
    expect(registry.snapshot().archived).toEqual([]);
    expect(readRun("run-archived").worktree?.state).toBe("removed");
    await expect(registry.removeWorktree("run-unknown", false)).resolves.toMatchObject({ outcome: "refused" });
  });
});

describe("worktrees found at startup", () => {
  it("should prune a worktree whose directory vanished and record it as removed", async () => {
    const { session, worktree } = await finishedRun("run-vanished", { status: "failed", mergeRequestUrl: undefined });
    writeRun(session.archivedState());
    rmSync(worktree, { recursive: true, force: true });
    expect(git(repository, "worktree", "list")).toContain("run-vanished");
    await lifecycle.reconcileRunWorktrees(runsDirectory);
    expect(readRun("run-vanished").worktree).toMatchObject({ state: "removed", detail: "Worktree not found on disk" });
    expect(git(repository, "worktree", "list")).not.toContain("run-vanished");
  });

  it("should keep a worktree still on disk with its reason, and put its run back in the list", async () => {
    const { session, worktree } = await finishedRun("run-left", { status: "failed", mergeRequestUrl: undefined });
    writeRun(session.archivedState());
    await lifecycle.reconcileRunWorktrees(runsDirectory);
    expect(readRun("run-left").worktree).toMatchObject({ state: "kept", detail: "Worktree kept: no merge request" });
    expect(existsSync(worktree)).toBe(true);
    const archive = new RunArchive();
    await archive.load(runsDirectory);
    expect(archive.list()).toEqual([expect.objectContaining({ id: "run-left", archived: true, repository, worktree: expect.objectContaining({ state: "kept" }) })]);
  });

  it("should remove the worktree of a run that delivered before the console went down", async () => {
    const { session, worktree } = await finishedRun("run-late");
    writeRun(session.archivedState());
    await lifecycle.reconcileRunWorktrees(runsDirectory);
    expect(readRun("run-late").worktree?.state).toBe("removed");
    expect(existsSync(worktree)).toBe(false);
    const archive = new RunArchive();
    await archive.load(runsDirectory);
    expect(archive.list()).toEqual([]);
  });

  it("should leave runs without a worktree, and unreadable archives, alone", async () => {
    writeRun({ id: "run-old", status: "completed", phase: 10, cwd: repository, issueUrl: ISSUE, instruction: "", startedAt: null, endedAt: null, agents: [], activities: [], messages: [], artifacts: [], sessionActive: false });
    mkdirSync(path.join(runsDirectory, "run-broken"), { recursive: true });
    writeFileSync(path.join(runsDirectory, "run-broken", "run.json"), "{");
    const before = readFileSync(path.join(runsDirectory, "run-old", "run.json"), "utf8");
    await expect(lifecycle.reconcileRunWorktrees(runsDirectory)).resolves.toBeUndefined();
    expect(readFileSync(path.join(runsDirectory, "run-old", "run.json"), "utf8")).toBe(before);
    await expect(lifecycle.reconcileRunWorktrees(path.join(runsDirectory, "missing"))).resolves.toBeUndefined();
  });
});
