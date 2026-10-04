import { expect, test } from "@playwright/test";
import { currentRun, resetRun } from "./helpers";
import { hookToken } from "../fixtures";

test.beforeEach(async ({ page }) => resetRun(page));

test("should return structured answers to a waiting Claude Code hook", async ({ page, request }) => {
  await page.goto("/?demo=1");
  const conversation = page.getByRole("log", { name: "Conversation" });
  // The demo parks on its own clarification, and nothing it schedules can
  // replace the question posted below while the test answers it.
  await expect(conversation.getByText("Decision required")).toBeVisible();
  await expect.poll(async () => (await currentRun(request)).id).toMatch(/^demo-/);
  const run = await currentRun(request);
  const question = "Should the regression test be required?";
  const questions = [{
    header: "Tests",
    question,
    options: [
      { label: "Yes", description: "Require the test." },
      { label: "No", description: "Continue without it." },
    ],
    multiSelect: false,
  }];

  const hookResponse = request.post(`/api/hooks?token=${hookToken}`, { data: {
    runId: run.id,
    payload: {
      hook_event_name: "PreToolUse",
      tool_name: "AskUserQuestion",
      tool_use_id: "question-test",
      tool_input: { questions },
    },
  } });

  await expect(conversation.getByText(question)).toBeVisible();
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await page.getByRole("button", { name: "Send to Claude" }).click();

  expect((await (await hookResponse).json()).hookOutput).toEqual({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { questions, answers: { [question]: "Yes" } },
    },
  });
});
