import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createGitCheckout, fakeClaudeInputDirectory } from "../fixtures";
import { artifact, resetRun, runDirectory, startRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

/**
 * A checkout the stand-in `claude` treats as a directory Claude Code never saw:
 * the session opens on the folder trust dialog, before any hook or transcript.
 */
const untrusted = (name: string) => createGitCheckout(path.join("untrusted", name));

type State = { status: string; sessionActive: boolean; cwd: string; repository?: string; error?: string; sessionPrompt?: { directory: string }; worktree?: { path: string; state: string; detail?: string }; incidents?: unknown[]; activities: { title: string }[] };

async function state(request: APIRequestContext, runId: string) {
  return (await (await request.get(`/api/runs/${encodeURIComponent(runId)}`)).json() as { state: State }).state;
}

async function openRun(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Ouvrir le run/ }).first().click();
}

/**
 * The keys the stand-in session received. The dialog turns focus reporting on,
 * so the terminal of the page also sends its focus changes (`ESC[I`, `ESC[O`)
 * and its answers to the capability queries: none of that is an answer.
 */
function typed(runId: string) {
  const log = path.join(fakeClaudeInputDirectory, `${runId}.log`);
  return existsSync(log) ? readFileSync(log, "utf8").replace(/\u001b\[[IO]|\u001b\[[?>][0-9;]*[a-z]|\u001bP[^\u001b]*\u001b\\/g, "") : "";
}

test("should show the folder trust dialog as a pending decision and continue the session once trusted", async ({ page, request }) => {
  const checkout = untrusted("trust-accept");
  await page.goto("/");
  const runId = await startRun(page, request, checkout.directory, checkout.issueUrl);
  await openRun(page);

  const conversation = page.getByRole("log", { name: "Conversation" });
  const decision = conversation.getByRole("region", { name: "Décision requise" });
  await expect(decision.getByText("Claude Code demande de faire confiance à ce dossier")).toBeVisible();
  // The directory Claude Code asks about is the one its session runs in: the worktree of the run, not the checkout.
  const worktree = await runDirectory(request, runId);
  expect(worktree).toBe(path.join(realpathSync(checkout.directory), ".claude", "worktrees", runId));
  await expect(decision.getByText(worktree, { exact: true })).toBeVisible();
  // Signalled everywhere a question of the workflow is: the tab title, the badge, the row and the tab.
  await expect(page).toHaveTitle("● Claude attend une réponse · Implementation Harness");
  await expect(page.getByLabel("Progression du run").getByText("À toi de jouer", { exact: true })).toBeVisible();
  await expect(page.getByTitle("1 décision en attente")).toBeVisible();
  await page.getByRole("tab", { name: "Terminal" }).click();
  await expect(page.getByRole("img", { name: "décision en attente" })).toBeVisible();
  await expect(page.locator(".xterm-rows")).toContainText("Yes, I trust this folder");
  await page.getByRole("tab", { name: "Conversation" }).click();
  // Nothing was typed for the user while the decision waited.
  expect(typed(runId)).toBe("");
  expect((await state(request, runId)).sessionPrompt?.directory).toBe(worktree);

  await decision.getByRole("button", { name: "Faire confiance et continuer" }).click();
  await expect(decision).toHaveCount(0);
  await expect.poll(() => typed(runId)).toBe("\u001b[B\r");
  await page.getByRole("tab", { name: "Terminal" }).click();
  await expect(page.locator(".xterm-rows")).toContainText("fake claude ready");
  const after = await state(request, runId);
  expect(after).toMatchObject({ status: "running", sessionActive: true });
  expect(after.sessionPrompt).toBeUndefined();
  expect(after.activities.map((activity) => activity.title)).toContain("Confiance accordée au dossier");
  await expect(page).toHaveTitle("1 run en cours · Implementation Harness");
});

test("should end the run as stopped, with its reason, when the folder is refused", async ({ page, request }) => {
  const checkout = untrusted("trust-refuse");
  await page.goto("/");
  const runId = await startRun(page, request, checkout.directory, checkout.issueUrl);
  await openRun(page);

  const decision = page.getByRole("log", { name: "Conversation" }).getByRole("region", { name: "Décision requise" });
  await decision.getByRole("button", { name: "Refuser" }).click();
  await expect(decision).toHaveCount(0);

  await expect.poll(async () => (await state(request, runId)).status).toBe("stopped");
  const after = await state(request, runId);
  expect(after.sessionActive).toBe(false);
  expect(after.error).toBe("Le dossier n'a pas été approuvé : la session s'est fermée avant de démarrer le workflow.");
  expect(after.activities.map((activity) => activity.title)).toEqual(expect.arrayContaining(["Confiance refusée, la session se ferme", "Session fermée, dossier non approuvé"]));
  // The user's decision, not a session lost on the way: no incident, no interruption.
  expect(after.incidents ?? []).toEqual([]);
  expect(typed(runId)).toBe("\u001b");
  await expect(page.getByLabel("Progression du run").getByText("Arrêté", { exact: true })).toBeVisible();
  await expect(page.getByText(/Le dossier n'a pas été approuvé/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Session interrompue" })).toHaveCount(0);
  await expect(page).toHaveTitle("○ Arrêté · Implementation Harness");
  // The worktree created for the run is settled like that of any stopped run: kept, with its reason, and removable from the console.
  await expect.poll(async () => (await state(request, runId)).worktree?.state).toBe("kept");
  const settled = await state(request, runId);
  expect(settled.worktree?.detail).toMatch(/^Worktree conservé : aucune merge request/);
  expect(existsSync(settled.worktree!.path)).toBe(true);
  await expect(page.getByRole("button", { name: "Supprimer le worktree" })).toBeVisible();
});

test("should ask to trust the worktree of the run, and continue the session in that worktree once trusted from the console", async ({ page, request }) => {
  const checkout = untrusted("trust-worktree");
  const repository = realpathSync(checkout.directory);
  const git = (directory: string, ...args: string[]) => execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();
  await page.goto("/");
  const runId = await startRun(page, request, checkout.directory, checkout.issueUrl);
  const worktree = path.join(repository, ".claude", "worktrees", runId);
  await openRun(page);

  // The session was started in the worktree, and the dialog it opens on is about that directory.
  const sessionFile = path.join(fakeClaudeInputDirectory, `${runId}.session.json`);
  await expect.poll(() => existsSync(sessionFile)).toBe(true);
  expect(JSON.parse(readFileSync(sessionFile, "utf8"))).toMatchObject({ cwd: worktree, worktree, repository });
  const decision = page.getByRole("log", { name: "Conversation" }).getByRole("region", { name: "Décision requise" });
  await expect(decision.getByText(worktree, { exact: true })).toBeVisible();
  const waiting = await state(request, runId);
  expect(waiting).toMatchObject({ status: "attention", cwd: worktree, repository, sessionPrompt: { directory: worktree }, worktree: { path: worktree, state: "active" } });
  // The worktree is there while the decision waits, and nothing was typed into it.
  expect(git(repository, "worktree", "list")).toContain(worktree);
  expect(typed(runId)).toBe("");

  await decision.getByRole("button", { name: "Faire confiance et continuer" }).click();
  await expect(decision).toHaveCount(0);
  await expect.poll(() => typed(runId)).toBe("\u001b[B\r");
  await expect.poll(async () => (await state(request, runId)).status).toBe("running");

  // The same session goes on, in the same worktree: what it writes there is what the console reads.
  const tasks = path.join(worktree, ".claude", "tasks");
  mkdirSync(tasks, { recursive: true });
  writeFileSync(path.join(tasks, "ticket-context.md.tmp"), "# Contexte\n\nÉcrit dans le worktree après la confiance.\n");
  renameSync(path.join(tasks, "ticket-context.md.tmp"), path.join(tasks, "ticket-context.md"));
  await expect.poll(async () => (await artifact(request, runId, "ticket-context.md")).status()).toBe(200);
  const after = await state(request, runId);
  expect(after).toMatchObject({ status: "running", sessionActive: true, cwd: worktree, worktree: { path: worktree, state: "active" } });
  expect(after.sessionPrompt).toBeUndefined();
  expect(after.activities.map((activity) => activity.title)).toEqual(expect.arrayContaining(["Worktree créé", "Confiance accordée au dossier"]));
  // The user's checkout was never the session's directory, and nothing was written to it.
  expect(existsSync(path.join(repository, ".claude", "tasks"))).toBe(false);
  expect(git(repository, "status", "--porcelain")).toBe("");
});

test("should drop the decision by itself when the dialog is answered in the terminal", async ({ page, request }) => {
  const checkout = untrusted("trust-terminal");
  await page.goto("/");
  const runId = await startRun(page, request, checkout.directory, checkout.issueUrl);
  await openRun(page);

  const decision = page.getByRole("log", { name: "Conversation" }).getByRole("region", { name: "Décision requise" });
  await expect(decision).toBeVisible();
  await page.getByRole("tab", { name: "Terminal" }).click();
  await page.locator(".xterm").click();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".xterm-rows")).toContainText("❯ Yes, I trust this folder");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("fake claude ready");

  await expect(page.getByRole("img", { name: "décision en attente" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Conversation" }).click();
  await expect(decision).toHaveCount(0);
  const after = await state(request, runId);
  expect(after).toMatchObject({ status: "running", sessionActive: true });
  expect(after.sessionPrompt).toBeUndefined();
  expect(after.activities.map((activity) => activity.title)).toContain("Dossier approuvé dans le terminal");
});

test("should read a refusal typed in the terminal the same way as one from the console", async ({ page, request }) => {
  const checkout = untrusted("trust-terminal-refuse");
  await page.goto("/");
  const runId = await startRun(page, request, checkout.directory, checkout.issueUrl);
  await openRun(page);

  await expect(page.getByRole("log", { name: "Conversation" }).getByRole("region", { name: "Décision requise" })).toBeVisible();
  await page.getByRole("tab", { name: "Terminal" }).click();
  await page.locator(".xterm").click();
  // The dialog opens on "No, exit".
  await page.keyboard.press("Enter");

  await expect.poll(async () => (await state(request, runId)).status).toBe("stopped");
  const after = await state(request, runId);
  expect(after.error).toMatch(/dossier n'a pas été approuvé/);
  expect(after.sessionPrompt).toBeUndefined();
  expect(after.incidents ?? []).toEqual([]);
});

test("should show nothing in a directory that does not open on the dialog", async ({ page, request }) => {
  const checkout = createGitCheckout("trust-known");
  await page.goto("/");
  const runId = await startRun(page, request, checkout.directory, checkout.issueUrl);
  await openRun(page);
  await page.getByRole("tab", { name: "Terminal" }).click();
  await expect(page.locator(".xterm-rows")).toContainText("fake claude ready");
  expect((await state(request, runId)).sessionPrompt).toBeUndefined();
  await page.getByRole("tab", { name: "Conversation" }).click();
  await expect(page.getByRole("region", { name: "Décision requise" })).toHaveCount(0);
});
