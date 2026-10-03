import { expect, test, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createGitCheckout, fakeClaudeInputDirectory } from "../fixtures";
import { resetRun, runDirectory, sendAndWait, startRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

type Session = { cwd: string; worktree?: string; repository?: string; branch?: string; dependencies?: string };
type Snapshot = { runs: { id: string; repository: string; cwd: string; worktree?: { state: string } }[]; queued: { id: string; reason: string; blockedBy?: string }[] };

const git = (directory: string, ...args: string[]) => execFileSync("git", ["-C", directory, "-c", "user.email=test@example.com", "-c", "user.name=Test", ...args], { encoding: "utf8" }).trim();
const snapshot = async (request: APIRequestContext) => await (await request.get("/api/runs")).json() as Snapshot;

/** What the stand-in session was started with: its directory and the two variables the workflow reads. */
async function sessionOf(runId: string) {
  const file = path.join(fakeClaudeInputDirectory, `${runId}.session.json`);
  await expect.poll(() => existsSync(file)).toBe(true);
  return JSON.parse(readFileSync(file, "utf8")) as Session;
}

test("should run two tickets of one repository side by side, each in a worktree of its own, and queue a second run on the same ticket", async ({ page, request }) => {
  const checkout = createGitCheckout("worktree-parallel");
  const repository = realpathSync(checkout.directory);
  const secondIssue = checkout.issueUrl.replace(/\/1$/, "/2");
  await page.goto("/");
  const first = await startRun(page, request, checkout.directory, checkout.issueUrl);
  const second = await startRun(page, request, checkout.directory, secondIssue);

  for (const runId of [first, second]) {
    const worktree = path.join(repository, ".claude", "worktrees", runId);
    expect(await runDirectory(request, runId)).toBe(worktree);
    // The session runs in the worktree and is told where it is and where it came from.
    expect(await sessionOf(runId)).toMatchObject({ cwd: worktree, worktree, repository, dependencies: "clone" });
    expect((await sessionOf(runId)).branch).toBeTruthy();
    // What a fresh worktree lacks came from the checkout, without an install.
    expect(readFileSync(path.join(worktree, "node_modules", "dep", "index.js"), "utf8")).toContain("1");
    expect(readFileSync(path.join(worktree, ".env"), "utf8")).toBe("SECRET=1\n");
    expect(git(worktree, "status", "--porcelain")).toBe("");
  }
  // The user's checkout is untouched: no branch moved, nothing shows as untracked.
  expect(git(repository, "status", "--porcelain")).toBe("");

  const held = await snapshot(request);
  expect(held.runs.filter((run) => run.repository === repository && run.worktree?.state === "active")).toHaveLength(2);
  // Named after the repository and the ticket, never after the worktree directory.
  await expect(page.getByRole("button", { name: "Ouvrir le run worktree-parallel #1" })).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir le run worktree-parallel #2" }).click();
  const progression = page.getByLabel("Progression du run");
  await expect(progression.getByText("Dépôt", { exact: true })).toBeVisible();
  await expect(progression.getByText(repository, { exact: true })).toBeVisible();
  await expect(progression.getByText(`.claude/worktrees/${second}`, { exact: true })).toBeVisible();

  // The same ticket again waits for the run that holds it, and says so.
  const notice = await sendAndWait<{ type: string; title?: string; detail?: string }>(page, { type: "run.start", cwd: checkout.directory, issueUrl: `${checkout.issueUrl}?tab=notes` }, "notice");
  expect(notice).toMatchObject({ type: "notice", title: "Run mis en file" });
  expect(notice.detail).toContain("Ce ticket est déjà en cours sur worktree-parallel");
  const waiting = await snapshot(request);
  expect(waiting.queued).toEqual([expect.objectContaining({ reason: "ticket", blockedBy: first })]);
  await expect(page.getByRole("group", { name: "Runs en file d'attente" }).getByText("En attente, ticket déjà en cours")).toBeVisible();
  expect(waiting.runs).toHaveLength(2);
});

test("should keep the worktree of a stopped run with its reason, ask before losing work, and remove it without the branch", async ({ page, request }) => {
  const checkout = createGitCheckout("worktree-keep");
  const repository = realpathSync(checkout.directory);
  await page.goto("/");
  const runId = await startRun(page, request, checkout.directory, checkout.issueUrl);
  const worktree = await runDirectory(request, runId);
  // The workflow cut its branch, committed, and left a file it never added.
  git(worktree, "checkout", "-q", "-b", "feat/1");
  writeFileSync(path.join(worktree, "app.ts"), "export const answer = 43;\n");
  git(worktree, "commit", "-q", "-am", "feat: answer");
  const commit = git(worktree, "rev-parse", "HEAD");
  writeFileSync(path.join(worktree, "draft.md"), "à reprendre\n");

  await page.getByRole("button", { name: "Ouvrir le run worktree-keep #1" }).click();
  // No removal while the session works in it.
  await expect(page.getByRole("button", { name: "Supprimer le worktree" })).toHaveCount(0);
  await page.getByRole("button", { name: "Arrêter" }).click();
  const progression = page.getByLabel("Progression du run");
  await expect(progression.getByText("Worktree conservé : aucune merge request, changements non commités, changements non poussés")).toBeVisible();
  expect(existsSync(worktree)).toBe(true);

  await page.getByRole("button", { name: "Supprimer le worktree" }).click();
  const confirmation = page.getByRole("region", { name: "Confirmer la suppression du worktree" });
  await expect(confirmation.getByText(/changements non commités et des changements non poussés/)).toBeVisible();
  await expect(confirmation.getByText(/la branche et ses commits restent/)).toBeVisible();
  await confirmation.getByRole("button", { name: "Annuler" }).click();
  await expect(confirmation).toHaveCount(0);
  expect(existsSync(path.join(worktree, "draft.md"))).toBe(true);

  await page.getByRole("button", { name: "Supprimer le worktree" }).click();
  await confirmation.getByRole("button", { name: "Supprimer quand même" }).click();
  await expect(progression.getByText("Worktree supprimé", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Supprimer le worktree" })).toHaveCount(0);
  expect(existsSync(worktree)).toBe(false);
  // The branch and its commit stay in the repository, and so does the checkout's own node_modules.
  expect(git(repository, "rev-parse", "feat/1")).toBe(commit);
  expect(readFileSync(path.join(repository, "node_modules", "dep", "index.js"), "utf8")).toContain("1");
  expect(git(repository, "worktree", "list")).not.toContain(runId);
});

test("should keep a closed run within reach while its worktree is on disk, then let it go", async ({ page, request }) => {
  const checkout = createGitCheckout("worktree-closed");
  await page.goto("/");
  const runId = await startRun(page, request, checkout.directory, checkout.issueUrl);
  const worktree = await runDirectory(request, runId);
  await page.getByRole("button", { name: "Ouvrir le run worktree-closed #1" }).click();
  await page.getByRole("button", { name: "Arrêter" }).click();
  await expect(page.getByLabel("Progression du run").getByText(/^Worktree conservé/)).toBeVisible();
  await page.getByRole("button", { name: "Fermer", exact: true }).click();

  const leftovers = page.getByRole("group", { name: "Worktrees conservés" });
  const row = leftovers.getByRole("button", { name: "Consulter l’archive du run worktree-closed #1" });
  await expect(row).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir le run worktree-closed #1" })).toHaveCount(0);
  await row.click();
  await page.getByRole("button", { name: "Supprimer le worktree" }).click();
  // Nothing uncommitted, but the commit it sits on was never pushed: still asked.
  await page.getByRole("region", { name: "Confirmer la suppression du worktree" }).getByRole("button", { name: "Supprimer quand même" }).click();
  await expect(row).toHaveCount(0);
  expect(existsSync(worktree)).toBe(false);
});
