import { expect, test } from "@playwright/test";
import { resetRun, runDemoToCompletion } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should tell a finished run apart from a running one in the run list", async ({ page }) => {
  await runDemoToCompletion(page);
  const row = page.getByRole("button", { name: /^Open run/ }).first();
  await expect(row.getByText("Completed", { exact: true })).toBeVisible();
  await expect(row.locator(".status-breathe")).toHaveCount(0);
});
