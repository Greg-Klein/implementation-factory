import { expect, test } from "@playwright/test";
import { resetRun, runDemoToCompletion } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should keep the reports by source behind the criteria, and enlarge a screenshot in place", async ({ page }) => {
  await runDemoToCompletion(page);
  await page.getByRole("tab", { name: "Preuves" }).click();

  await page.getByText("Rapports par source").click();
  const reports = page.locator("details", { hasText: "Rapports par source" });
  await expect(reports.getByRole("heading", { name: /Tests & vérifications/ })).toBeVisible();
  await expect(reports.getByText("Aucune preuve écrite pour ce run.")).toHaveCount(1);
  await expect(reports.getByText("qa-evidence.json v2", { exact: false }).first()).toBeVisible();

  await reports.getByRole("button", { name: "Agrandir la capture assets/panneau-preferences.png" }).first().click();
  const lightbox = page.getByRole("dialog", { name: "assets/panneau-preferences.png" });
  await expect(lightbox.getByRole("img", { name: "assets/panneau-preferences.png" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(lightbox).toBeHidden();
});
