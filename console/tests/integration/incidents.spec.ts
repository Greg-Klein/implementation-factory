import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createGitCheckout, fakeClaudeInputDirectory, hookToken, interruptedRunId } from "../fixtures";
import { resetRun, startRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

type Incident = { id: string; kind: string; status: string; revision: number; decisions: { requestId: string; outcome: string }[]; resolution?: { outcome: string }; continuation?: { requestId: string } };

let hookSequence = 0;
/** A hook as the session would post it: with the secret, and an id of its own. */
async function postHook(request: APIRequestContext, runId: string, payload: Record<string, unknown>) {
  const response = await request.post(`/api/hooks?token=${hookToken}`, { data: { runId, hookId: `hook-${Date.now()}-${hookSequence++}`, payload } });
  expect(response.ok()).toBe(true);
}

async function incidents(request: APIRequestContext, runId: string) {
  const body = await (await request.get(`/api/runs/${encodeURIComponent(runId)}`)).json() as { state: { incidents?: Incident[] } };
  return body.state.incidents ?? [];
}

async function openRun(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Ouvrir le run/ }).first().click();
}

/** What the stand-in session received on its terminal, the only trace of a submission. */
function submissions(runId: string) {
  const log = path.join(fakeClaudeInputDirectory, `${runId}.log`);
  return existsSync(log) ? readFileSync(log, "utf8").split("Reprends le workflow").length - 1 : 0;
}

test("should find a pilot with nothing next, send one continuation for two windows, and close the incident once the pilot acts", async ({ page, context, request }) => {
  const checkout = createGitCheckout("incident-continue");
  await page.goto("/");
  const runId = await startRun(page, request, checkout.directory, checkout.issueUrl);
  // The pilot hands control back with nothing running, nothing asked, nothing declared.
  await postHook(request, runId, { hook_event_name: "Stop" });

  const second = await context.newPage();
  await openRun(page);
  await openRun(second);
  const band = page.getByRole("region", { name: "Plus aucune action en cours" });
  await expect(band).toBeVisible();
  await expect(second.getByRole("region", { name: "Plus aucune action en cours" })).toBeVisible();
  await expect(band.getByText(/sans agent actif, sans question/)).toBeVisible();
  await expect(page).toHaveTitle(/Attention requise/);
  // Nobody asked anything: the badge says the run is stuck, not that it is the user's turn.
  await expect(page.getByLabel("Progression du run").getByText("Sans suite", { exact: true })).toBeVisible();

  // Two windows, one click each, at the same time. Whichever lands first, the other
  // button may already be gone: the first answer reaches every window. The single
  // submission checked below is what proves one click went through, and only one.
  await Promise.all([page, second].map((window) =>
    window.getByRole("button", { name: "Demander la continuation" }).click({ timeout: 3_000 }).catch(() => undefined)));
  await expect(second.getByText(/Continuation demandée à/)).toBeVisible();
  await expect(band.getByText(/Continuation demandée à/)).toBeVisible();
  await expect.poll(() => submissions(runId)).toBe(1);
  const [incident] = await incidents(request, runId);
  expect(incident.status).toBe("open");
  expect(incident.decisions.filter((decision) => decision.outcome === "done")).toHaveLength(1);
  // Nothing is resolved on the request alone: only once the pilot is seen acting.
  await postHook(request, runId, { hook_event_name: "PreToolUse", tool_name: "Read", tool_use_id: "read-1", tool_input: { file_path: ".claude/tasks/planner-output.json" } });
  await expect(band).toHaveCount(0);
  await expect.poll(async () => (await incidents(request, runId))[0]?.resolution?.outcome).toBe("Reprise observée après la demande de continuation");
  expect(submissions(runId)).toBe(1);
  await second.close();
});

test("should refuse an action decided on a state that has moved since it was shown", async ({ page, request }) => {
  const checkout = createGitCheckout("incident-stale");
  await page.goto("/");
  const runId = await startRun(page, request, checkout.directory, checkout.issueUrl);
  await postHook(request, runId, { hook_event_name: "Stop" });
  await expect.poll(async () => (await incidents(request, runId)).length).toBe(1);
  const [incident] = await incidents(request, runId);
  const answer = await page.evaluate(({ run, id }) => new Promise<{ outcome: string; message: string }>((resolve, reject) => {
    const socket = new WebSocket(`ws://${window.location.host}/ws`);
    const timeout = window.setTimeout(() => reject(new Error("incident.result timeout")), 5_000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "incident.action", runId: run, incidentId: id, expectedRevision: 0, requestId: "stale-1", action: "request_continuation" })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as { type: string; outcome: string; message: string };
      if (message.type !== "incident.result") return;
      window.clearTimeout(timeout);
      socket.close();
      resolve(message);
    });
  }), { run: runId, id: incident.id });
  expect(answer.outcome).toBe("refused");
  expect(answer.message).toMatch(/situation a changé/);
  expect(submissions(runId)).toBe(0);
});

test("should not call a question left unanswered, nor a working agent, an incident", async ({ page, request }) => {
  const checkout = createGitCheckout("incident-quiet");
  await page.goto("/");
  const runId = await startRun(page, request, checkout.directory, checkout.issueUrl);
  await postHook(request, runId, { hook_event_name: "SubagentStart", agent_type: "implementation-harness:developer", agent_id: "dev-1" });
  await postHook(request, runId, { hook_event_name: "Stop" });
  await page.waitForTimeout(2_500);
  expect(await incidents(request, runId)).toEqual([]);
  // The agent ends, the pilot is woken and asks a question: still nobody stuck.
  await postHook(request, runId, { hook_event_name: "SubagentStop", agent_type: "implementation-harness:developer", agent_id: "dev-1" });
  void request.post(`/api/hooks?token=${hookToken}`, { data: { runId, payload: { hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "q1", tool_input: { questions: [{ question: "Quelle base ?", header: "Branche", options: [{ label: "develop" }] }] } } } }).catch(() => undefined);
  await page.waitForTimeout(2_500);
  expect(await incidents(request, runId)).toEqual([]);
});

test("should show a session lost to a restart as a read-only archive, and let the user close its case", async ({ page }) => {
  await page.goto("/");
  const interrupted = page.getByRole("group", { name: "Runs interrompus" });
  await interrupted.getByRole("button", { name: /Consulter l’archive du run interrupted #7/ }).click();
  const band = page.getByRole("region", { name: "Session interrompue" });
  await expect(band).toBeVisible();
  await expect(page.getByText("Archive", { exact: true })).toBeVisible();
  const progression = page.getByLabel("Progression du run");
  await expect(progression.getByText("Interrompu", { exact: true })).toBeVisible();
  // Dated at its last event (08:20), not at the restart that found it hours later.
  await expect(progression.getByText("20 min 00 s", { exact: true })).toBeVisible();
  // The band already says it: no second red panel, and no hint pointing at a terminal that is gone.
  await expect(page.getByText(/a redémarré ou s'est arrêté pendant/)).toHaveCount(0);
  await expect(page.getByText(/Sa session est fermée/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Vérifier l’onglet Terminal" })).toHaveCount(0);
  // Nothing live to act on: no continuation, no terminal, no stop.
  await expect(band.getByRole("button", { name: "Demander la continuation" })).toHaveCount(0);
  await expect(band.getByRole("button", { name: "Arrêter" })).toHaveCount(0);
  await band.getByRole("button", { name: /Diagnostic/ }).click();
  await expect(band.getByText(/Question restée sans réponse : Faut-il garder l’ancien format/)).toBeVisible();
  await band.getByRole("button", { name: "Classer comme faux positif…" }).click();
  await band.getByPlaceholder("Pourquoi est-ce un faux positif ?").fill("Ticket relancé à la main");
  await band.getByRole("button", { name: "Classer", exact: true }).click();
  await expect(interrupted).toHaveCount(0);
  expect(interruptedRunId).toBeTruthy();
});

test("should play the incident demonstration from the hand-back to the resumed run", async ({ page }) => {
  await page.goto("/?demo=incident");
  const band = page.getByRole("region", { name: "Plus aucune action en cours" });
  await expect(band).toBeVisible();
  await expect(page.getByRole("button", { name: /Ouvrir le run acme-exports/ }).getByText("Plus aucune action en cours")).toBeVisible();
  await band.getByRole("button", { name: "Demander la continuation" }).click();
  await expect(band).toHaveCount(0);
  await expect(page).toHaveTitle("✓ Terminé · Implementation Harness");
});
