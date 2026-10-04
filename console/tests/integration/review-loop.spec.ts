import { expect, test } from "@playwright/test";
import { currentRunState, expectDemoCompleted, resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should loop through requested changes, then open a draft merge request while a criterion still fails", async ({ page, request }) => {
  await page.goto("/?demo=1");
  await expect(page.getByText("Decision required")).toBeVisible();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Keep critical alerts" }).click();
  await page.getByRole("button", { name: "Send to Claude" }).click();

  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Review 1/2: changes requested on the fallback and its test coverage.")).toBeVisible();
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Looping back to implementation: fixing the fallback and adding the missing test…")).toBeVisible();
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Review 2/2: the findings from the first round are resolved, but AC4 is still failed. Loop limit reached: the merge request will go out as a draft.")).toBeVisible();
  await expectDemoCompleted(page);
  // A criterion still failing at the loop limit ships as a draft, and says so.
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Simulated draft merge request ready. End of the demonstration.")).toBeVisible();

  await expect.poll(() => currentRunState(request)).toMatchObject({
    status: "completed",
    phase: 10,
    artifacts: expect.arrayContaining(["senior-review-round-1.md", "senior-review-round-2.md", "mr-description.md"]),
    agents: expect.arrayContaining([
      expect.objectContaining({ name: "developer", status: "completed" }),
      expect.objectContaining({ name: "senior-reviewer", status: "completed" }),
    ]),
  });
});
