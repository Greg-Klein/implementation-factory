import { expect, test } from "@playwright/test";
import { artifact, currentRun, currentRunState, resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should keep the document reader open until clarification requires an answer", async ({ page, request }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/?demo=1");
  await page.getByRole("tab", { name: "Evidence" }).click();
  const documents = page.getByRole("button", { name: /Generated documents/ });
  await expect(documents).toContainText("1");
  await documents.click();

  const reader = page.getByRole("dialog", { name: "Generated documents" });
  await expect(reader.getByText("IH-42 · Notification preferences")).toBeVisible();
  await expect(reader.getByText("The workflow continues in the background")).toBeVisible();
  await expect(reader.getByText("Claude is waiting for 2 answers")).toBeVisible();

  expect(await currentRunState(request)).toMatchObject({ phase: 2, status: "attention" });
  await expect(reader).toBeVisible();

  await reader.getByRole("button", { name: "Answer" }).click();
  await expect(reader).toBeHidden();
  await expect(page.getByRole("tab", { name: "Conversation" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Decision required")).toBeVisible();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Keep critical alerts" }).click();
  await page.getByRole("button", { name: "Send to Claude" }).click();

  // Ticket context, criteria registry, plan and planner output.
  await expect(documents).toContainText("4");
  await documents.click();
  await reader.getByRole("button", { name: "implementation-plan.md" }).click();
  await expect(reader.getByText("Add the preferences model.")).toBeVisible();
  await reader.getByRole("button", { name: "Close" }).click();

  const agents = page.getByRole("region", { name: "Agents" });
  await expect(agents.getByText(/ · Developer$/).first()).toBeVisible();
  await expect(agents.getByText(/ · Senior reviewer$/)).toBeVisible();
  await expect(agents.getByText(/ · Developer$/)).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("should expose only generated documents from the current run", async ({ page, request }) => {
  await page.goto("/?demo=1");
  await expect(page.getByRole("button", { name: /Generated documents/ })).toContainText("1");

  const { id } = await currentRun(request);
  const response = await artifact(request, id, "ticket-context.md");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    path: "ticket-context.md",
    content: expect.stringContaining("Acceptance criteria"),
  });
  expect((await artifact(request, id, "not-generated.md")).status()).toBe(404);
  expect((await artifact(request, id, "../run.json")).status()).toBe(404);
  // A document is only ever read through the run that produced it.
  expect((await artifact(request, "demo-unknown", "ticket-context.md")).status()).toBe(404);
});
