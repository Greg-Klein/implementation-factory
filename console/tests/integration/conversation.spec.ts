import { expect, test } from "@playwright/test";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGitCheckout, hookToken } from "../fixtures";
import { expectDemoCompleted, resetRun, runDemoToCompletion, startDemoRun, startRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should show the dialogue and keep the terminal one click away", async ({ page }) => {
  await page.goto("/?demo=1");

  const conversation = page.getByRole("log", { name: "Conversation" });
  const composer = page.getByLabel("Instruction pour Claude");
  await expect(conversation.getByText("Lecture du ticket GitLab simulé…")).toBeVisible();
  await expect(composer).toBeVisible();

  await page.getByRole("tab", { name: "Terminal" }).click();
  await expect(composer).toBeHidden();

  await page.getByRole("tab", { name: "Conversation" }).click();
  await expect(composer).toBeVisible();
});

test("should send a typed instruction into the conversation", async ({ page }) => {
  await page.goto("/?demo=1");

  const conversation = page.getByRole("log", { name: "Conversation" });
  await page.getByLabel("Instruction pour Claude").fill("reste sur desktop");
  await page.getByRole("button", { name: "Envoyer l’instruction" }).click();

  await expect(conversation.getByText("reste sur desktop")).toBeVisible();
  await expect(conversation.getByText("Instruction prise en compte. La démonstration ne modifie aucun dépôt.")).toBeVisible();
  await expect(page.getByLabel("Instruction pour Claude")).toHaveValue("");
});

test("should say a message is on its way while the session is still talking", async ({ page }) => {
  await page.goto("/?demo=1");

  const conversation = page.getByRole("log", { name: "Conversation" });
  await expect(conversation.getByText("Claude réfléchit…")).toBeVisible();
  // Waiting is not enough: the hint says what the wait is on.
  await expect(conversation.getByText("Lecture du ticket GitLab", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();
  await expect(conversation.getByText("Délégation à developer", { exact: true })).toBeVisible();
  await expectDemoCompleted(page);

  // The run is over: nothing is being written any more, and no action is claimed.
  await expect(conversation.getByText("Claude réfléchit…")).toBeHidden();
});

test("should hand back the launch form after a finished run", async ({ page }) => {
  await runDemoToCompletion(page);

  await page.getByRole("button", { name: "Nouveau run" }).click();

  await expect(page.getByRole("button", { name: "Lancer l’implémentation" })).toBeVisible();
  await expect(page.getByRole("log", { name: "Conversation" })).toBeHidden();
});

test("should clear the launch form fields when starting a new run", async ({ page }) => {
  await page.goto("/");

  // Filled before the ticket URL so the project auto-detection (debounced,
  // and only kicking in while the project field is empty) never overwrites it.
  await page.getByLabel("Répertoire du projet").fill("acme-dashboard");
  await page.getByLabel("Ticket GitLab").fill("https://gitlab.com/acme/demo/-/issues/217");
  await page.getByLabel("Instruction particulière").fill("reste sur desktop");

  // Trigger the demo through the socket directly: a fresh navigation to
  // /?demo=1 would reload the page and lose the values just typed above.
  await startDemoRun(page);

  await expect(page.getByText("Décision requise")).toBeVisible();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();
  await expectDemoCompleted(page);

  await page.getByRole("button", { name: "Nouveau run" }).click();

  await expect(page.getByLabel("Ticket GitLab")).toHaveValue("");
  await expect(page.getByLabel("Répertoire du projet")).toHaveValue("");
  await expect(page.getByLabel("Instruction particulière")).toHaveValue("");
});

test("should clear the launch form fields when a finished run is closed", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Répertoire du projet").fill("acme-dashboard");
  await page.getByLabel("Ticket GitLab").fill("https://gitlab.com/acme/demo/-/issues/217");
  await page.getByLabel("Instruction particulière").fill("reste sur desktop");

  await startDemoRun(page);

  await expect(page.getByText("Décision requise")).toBeVisible();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();
  await expectDemoCompleted(page);

  await page.getByRole("button", { name: "Fermer" }).click();

  await expect(page.getByRole("button", { name: "Lancer l’implémentation" })).toBeVisible();
  await expect(page.getByLabel("Ticket GitLab")).toHaveValue("");
  await expect(page.getByLabel("Répertoire du projet")).toHaveValue("");
  await expect(page.getByLabel("Instruction particulière")).toHaveValue("");
});

test("should size the instruction field when another run is opened from another tab", async ({ page }) => {
  await page.goto("/?demo=1");
  // The tab the user leaves a run on is the tab the next one is opened on, and
  // the conversation is mounted hidden for as long as that lasts.
  await page.getByRole("tab", { name: "Terminal" }).click();
  await page.getByRole("button", { name: "Arrêter" }).click();

  // A second simulated run, which the page does not open on its own: with two
  // runs in the list, picking one for the user would be guessing.
  await startDemoRun(page);
  await page.getByRole("button", { name: /^Ouvrir le run/ }).first().click();

  const composer = page.getByLabel("Instruction pour Claude");
  await expect(composer).toBeVisible();
  // The placeholder fits on its line: a field measured while hidden is written
  // down to its own padding and scrolls over a single empty line.
  expect(await composer.evaluate((field) => field.scrollHeight > field.clientHeight)).toBe(false);
});

test("should offer a jump back to the last message after scrolling up", async ({ page }) => {
  await runDemoToCompletion(page);

  const conversation = page.getByRole("log", { name: "Conversation" });
  const jump = page.getByRole("button", { name: "Aller au dernier message" });
  await expect(jump).toBeHidden();
  expect(await conversation.evaluate((list) => list.scrollHeight > list.clientHeight + 80)).toBe(true);

  await conversation.evaluate((list) => { list.scrollTop = 0; });
  await expect(jump).toBeVisible();

  await jump.click();
  await expect(jump).toBeHidden();
  expect(await conversation.evaluate((list) => list.scrollHeight - list.scrollTop - list.clientHeight)).toBeLessThan(80);
});

test("should read the dialogue from a transcript created after the first hook, in a directory that did not exist yet", async ({ page, request }) => {
  // Claude Code keeps the transcripts of a working directory in a directory of
  // its own, created with the first one. A run in a fresh worktree therefore
  // names, in its first hook, a file whose directory is not there yet.
  const root = path.join(os.tmpdir(), "implementation-harness-tests", "transcripts");
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const transcript = path.join(root, "fresh-worktree", "session.jsonl");
  const line = (uuid: string, text: string) => `${JSON.stringify({ type: "assistant", uuid, timestamp: new Date().toISOString(), isSidechain: false, message: { role: "assistant", content: [{ type: "text", text }] } })}\n`;
  const hook = async (runId: string, hookId: string) => expect((await request.post(`/api/hooks?token=${hookToken}`, { data: { runId, hookId, payload: { hook_event_name: "PreToolUse", tool_name: "Read", tool_use_id: hookId, tool_input: { file_path: "app.ts" }, transcript_path: transcript } } })).ok()).toBe(true);
  const messages = async (runId: string) => ((await (await request.get(`/api/runs/${encodeURIComponent(runId)}`)).json()) as { state: { messages: { text: string }[] } }).state.messages.map((message) => message.text);

  const checkout = createGitCheckout("late-transcript");
  await page.goto("/");
  const runId = await startRun(page, request, checkout.directory, checkout.issueUrl);
  await hook(runId, "late-1");

  mkdirSync(path.dirname(transcript), { recursive: true });
  writeFileSync(transcript, line("m1", "Ticket lu, je crée la branche."));
  await expect.poll(() => messages(runId)).toEqual(["Ticket lu, je crée la branche."]);

  // What is appended afterwards is what the early watcher never saw.
  appendFileSync(transcript, line("m2", "Branche créée, je planifie."));
  await expect.poll(() => messages(runId)).toEqual(["Ticket lu, je crée la branche.", "Branche créée, je planifie."]);
  await page.getByRole("button", { name: /Ouvrir le run late-transcript/ }).click();
  await expect(page.getByText("Branche créée, je planifie.")).toBeVisible();
});
