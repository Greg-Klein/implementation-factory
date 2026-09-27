import { expect, test } from "@playwright/test";
import { resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should move the plan tasks across the board as developers take and finish them", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("tab", { name: "Suivi" }).click();
  await expect(page.getByTestId("tracking-empty")).toBeVisible();

  await page.getByRole("tab", { name: "Conversation" }).click();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();
  await page.getByRole("tab", { name: "Suivi" }).click();

  const board = page.getByTestId("tracking-board");
  await expect(board.getByTestId("tracking-card")).toHaveCount(4);
  await expect(page.getByTestId("tracking-column-in_progress").getByTestId("tracking-card-assignee").first()).toContainText(/ · Dev$/);
  await expect(page.getByTestId("tracking-column-done").locator('[data-task-id="T1"]')).toBeVisible();
  await expect(page.getByTestId("tracking-column-done").locator('[data-task-id="T1"]').getByTestId("tracking-card-assignee")).toHaveText("Léa · Dev");
  // public/ is served by the custom server's Next handler: a missing picture would fall back to the initial.
  await expect.poll(() => page.getByTestId("tracking-column-done").locator('[data-task-id="T1"] img[alt="Léa"]').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByTestId("tracking-column-done").getByTestId("tracking-card")).toHaveCount(4);
});
