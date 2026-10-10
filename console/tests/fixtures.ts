import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Discovery reads real .git/config files, so the integration suite needs a real
 * checkout. Committing a nested .git directory would turn the fixture into an
 * embedded repository, so it is built outside the working tree instead.
 */
export const checkoutsRoot = path.join(os.tmpdir(), "implementation-factory-tests", "checkouts");
/** The hook secret the suite's server is started with, so a test can post hooks the way a session does. */
export const controlToken = "integration-control-token-0123456789abcdef";
export const hookToken = "integration-hook-token";
export const sampleCheckout = path.join(checkoutsRoot, "repo");
export const sampleProject = "group/repo";

export function createSampleCheckout() {
  mkdirSync(path.join(sampleCheckout, ".git"), { recursive: true });
  writeFileSync(
    path.join(sampleCheckout, ".git", "config"),
    `[remote "origin"]\n\turl = https://gitlab.com/${sampleProject}.git\n`,
  );
  return sampleCheckout;
}

/** Checkouts under this directory get the folder trust dialog from the stand-in `claude`, as a directory Claude Code never saw would. */
export const untrustedRoot = path.join(checkoutsRoot, "untrusted");

/** Where the suite's console keeps its runs, away from the developer's own history. */
export const dataDirectory = path.join(os.tmpdir(), "implementation-factory-tests", "data");
/** A `claude` that only waits at its prompt, put first on the console's PATH. See tests/fake-claude/claude. */
export const fakeClaudeDirectory = fileURLToPath(new URL("./fake-claude", import.meta.url));

/**
 * A real git checkout, for the runs that go through the actual session path:
 * every run takes a git worktree of its repository and the code snapshot
 * utility hashes a working tree, neither of which the bare `.git/config` of
 * the sample checkout can give. It carries what a developer's checkout holds
 * and a fresh worktree lacks: an ignored `node_modules` and an ignored `.env`.
 */
export function createGitCheckout(name: string, forge: "gitlab" | "github" = "gitlab") {
  const directory = path.join(checkoutsRoot, name);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args], { cwd: directory, stdio: "ignore" });
  git("init", "-q");
  git("remote", "add", "origin", `https://${forge}.com/group/${name}.git`);
  writeFileSync(path.join(directory, "app.ts"), "export const answer = 42;\n");
  writeFileSync(path.join(directory, ".gitignore"), "node_modules/\n.env*\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  mkdirSync(path.join(directory, "node_modules", "dep"), { recursive: true });
  writeFileSync(path.join(directory, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  writeFileSync(path.join(directory, ".env"), "SECRET=1\n");
  return { directory, project: `group/${name}`, issueUrl: forge === "github" ? `https://github.com/group/${name}/issues/1` : `https://gitlab.com/group/${name}/-/issues/1` };
}

/** Where the stand-in `claude` writes what it receives on its terminal, one file per run. */
export const fakeClaudeInputDirectory = path.join(os.tmpdir(), "implementation-factory-tests", "claude-input");

/** The run a restart found in progress, seeded before the suite's console boots. */
export const interruptedRunId = "2026-09-27T08-00-00-000Z-interrupt";

/**
 * What the stand-in `claude` answers when the console asks it to schedule a
 * batch: see the header of tests/fake-claude/claude. Without the file, every
 * ticket is predicted with no edge.
 */
export const scheduleFixtureFile = path.join(os.tmpdir(), "implementation-factory-tests", "schedule-fixture.json");
export function scheduleFixture(fixture?: Record<string, unknown>) {
  if (fixture) writeFileSync(scheduleFixtureFile, JSON.stringify(fixture));
  else rmSync(scheduleFixtureFile, { force: true });
}

/** Where the stand-in `glab` reads the state of a merge request from. See tests/fake-claude/glab. */
export const fakeGlabDirectory = path.join(os.tmpdir(), "implementation-factory-tests", "glab");
/** What GitLab says of a merge request, or nothing at all with `undefined`, as when it cannot be reached. */
export function mergeRequestState(iid: number, state?: "opened" | "merged" | "closed") {
  const file = path.join(fakeGlabDirectory, `merge-request-${iid}`);
  if (state) writeFileSync(file, state);
  else rmSync(file, { force: true });
}

/** The links GitLab lists for an issue, or nothing at all with `undefined`, as when it cannot be reached. */
export function issueLinks(iid: number, links?: { link_type: "blocks" | "is_blocked_by" | "relates_to"; web_url: string }[]) {
  const file = path.join(fakeGlabDirectory, `issue-links-${iid}`);
  if (links) writeFileSync(file, JSON.stringify(links));
  else rmSync(file, { force: true });
}

/** Where the stand-in `gh` reads the state of a pull request from. See tests/fake-claude/gh. */
export const fakeGhDirectory = path.join(os.tmpdir(), "implementation-factory-tests", "gh");
/** What GitHub says of a pull request, or nothing at all with `undefined`, as when it cannot be reached. */
export function pullRequestState(number: number, state?: "open" | "merged" | "closed") {
  const file = path.join(fakeGhDirectory, `pull-request-${number}`);
  if (state) writeFileSync(file, state);
  else rmSync(file, { force: true });
}

/** The checkout of the batch a restart found half analysed, seeded before the suite's console boots. */
export const restoredBatchCheckout = "restored-batch";

/**
 * Hands the suite's console a clean data directory, holding one run an earlier
 * process left mid-flight: its boot has to reconcile it into a read-only
 * archive with an interruption incident, which only a real start can show.
 */
export function prepareDataDirectory() {
  rmSync(dataDirectory, { recursive: true, force: true });
  rmSync(fakeClaudeInputDirectory, { recursive: true, force: true });
  mkdirSync(fakeClaudeInputDirectory, { recursive: true });
  rmSync(fakeGlabDirectory, { recursive: true, force: true });
  mkdirSync(fakeGlabDirectory, { recursive: true });
  rmSync(fakeGhDirectory, { recursive: true, force: true });
  mkdirSync(fakeGhDirectory, { recursive: true });
  scheduleFixture();
  // A batch of two invented tickets the earlier process was still analysing when it went down:
  // the boot has to bring it back as a failed analysis, one ticket at a time.
  const batch = createGitCheckout(restoredBatchCheckout);
  const repository = realpathSync(batch.directory);
  mkdirSync(dataDirectory, { recursive: true });
  writeFileSync(path.join(dataDirectory, "queue.json"), JSON.stringify({
    version: 2,
    queue: [1, 2].map((iid) => ({
      id: `queued-restored-${iid}`, cwd: repository, repository, issueUrl: batch.issueUrl.replace(/\/1$/, `/${iid}`),
      instruction: "", queuedAt: "2026-09-27T08:00:00.000Z", batchId: "batch-restored", analysing: true,
    })),
    tickets: [], edges: [], watches: [],
  }, null, 2));
  const runDirectory = path.join(dataDirectory, "runs", interruptedRunId);
  mkdirSync(runDirectory, { recursive: true });
  writeFileSync(path.join(runDirectory, "run.json"), JSON.stringify({
    id: interruptedRunId, status: "attention", phase: 6, cwd: path.join(checkoutsRoot, "interrupted"), issueUrl: "https://gitlab.com/group/interrupted/-/issues/7",
    ticketTitle: "Corriger l’export des factures", instruction: "", startedAt: "2026-09-27T08:00:00.000Z", endedAt: null,
    agents: [{ id: "a1", name: "implementation-factory:qa-reviewer", status: "running", startedAt: "2026-09-27T08:20:00.000Z" }],
    activities: [{ id: "e1", at: "2026-09-27T08:20:00.000Z", kind: "agent", title: "qa-reviewer démarre" }],
    messages: [], artifacts: ["ticket-context.md"], sessionActive: true,
    pendingQuestion: { id: "q1", questions: [{ question: "Faut-il garder l’ancien format ?", header: "Format", options: [{ label: "Oui" }], multiSelect: false }] },
  }, null, 2));
}
