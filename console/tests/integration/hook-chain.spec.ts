import { expect, test } from "@playwright/test";
import { createGitCheckout } from "../fixtures";
import { resetRun, sendAndWait, startRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

type Run = { state: { branch?: string; activities: { title: string; detail?: string }[] } };

test("should apply a hook the session emits itself, through the address and the secret the console gave it", async ({ page, request }) => {
  const checkout = createGitCheckout("hook-chain");
  await page.goto("/");
  const runId = await startRun(page, request, checkout.directory, checkout.issueUrl);
  const state = async () => (await (await request.get(`/api/runs/${encodeURIComponent(runId)}`)).json() as Run).state;
  expect((await state()).branch).toBeUndefined();

  // Typed into the session: the stand-in hands it to the real hooks/emit.mjs, which posts it like Claude Code's hook would.
  const hook = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "chain-1", session_id: "chain", tool_input: { command: "git switch -c feat/7-hook-chain" } };
  await sendAndWait(page, { type: "terminal.input", runId, data: `fake-hook:${JSON.stringify(hook)}\r` }, "harness");

  await expect.poll(async () => (await state()).branch).toBe("feat/7-hook-chain");
  expect((await state()).activities.find((activity) => activity.title === "Working branch")?.detail).toBe("feat/7-hook-chain");
});
