import { expect, test } from "@playwright/test";
import { resetRun, runDemoToCompletion } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should keep the reports by source behind the criteria, and enlarge a screenshot in place", async ({ page }) => {
  await runDemoToCompletion(page);
  await page.getByRole("tab", { name: "Evidence" }).click();

  await page.getByText("Reports by source").click();
  const reports = page.locator("details", { hasText: "Reports by source" });
  await expect(reports.getByRole("heading", { name: /Tests & checks/ })).toBeVisible();
  await expect(reports.getByRole("heading", { name: /Design conformance/ })).toBeVisible();
  // The demo writes all three sources, and the QA verdict reads in French, not as a raw token.
  await expect(reports.getByText("No evidence written for this run.")).toHaveCount(0);
  await expect(reports.getByRole("heading", { name: /Tests & checks/ })).toContainText("Failed");
  await expect(reports.getByText("qa-evidence.json v2", { exact: false }).first()).toBeVisible();

  await reports.getByRole("button", { name: "Enlarge screenshot assets/panneau-preferences.png" }).first().click();
  const lightbox = page.getByRole("dialog", { name: "assets/panneau-preferences.png" });
  await expect(lightbox.getByRole("img", { name: "assets/panneau-preferences.png" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(lightbox).toBeHidden();
});
