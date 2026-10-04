import { expect, test } from "@playwright/test";
import { resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should move the plan tasks across the board as developers take and finish them", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("tab", { name: "Tracking" }).click();
  await expect(page.getByTestId("tracking-empty")).toBeVisible();

  await page.getByRole("tab", { name: "Conversation" }).click();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Keep critical alerts" }).click();
  await page.getByRole("button", { name: "Send to Claude" }).click();
  await page.getByRole("tab", { name: "Tracking" }).click();

  const board = page.getByTestId("tracking-board");
  await expect(board.getByTestId("tracking-card")).toHaveCount(4);
  await expect(page.getByTestId("tracking-column-in_progress").getByTestId("tracking-card-assignee").first()).toContainText(/ · Developer$/);
  await expect(page.getByTestId("tracking-column-done").locator('[data-task-id="T1"]')).toBeVisible();
  await expect(page.getByTestId("tracking-column-done").locator('[data-task-id="T1"]').getByTestId("tracking-card-assignee")).toHaveText("Léa · Developer");
  // public/ is served by the custom server's Next handler: a missing picture would fall back to the initial.
  await expect.poll(() => page.getByTestId("tracking-column-done").locator('[data-task-id="T1"] img[alt="Léa"]').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByTestId("tracking-column-done").getByTestId("tracking-card")).toHaveCount(4);
});

test("should open the detail of a plan task from its card, and close it", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Keep critical alerts" }).click();
  await page.getByRole("button", { name: "Send to Claude" }).click();
  await page.getByRole("tab", { name: "Tracking" }).click();

  // The demo moves the cards across columns: the card is clicked once the board has settled.
  await expect(page.getByTestId("tracking-column-done").getByTestId("tracking-card")).toHaveCount(4);
  const card = page.locator('[data-testid="tracking-card"][data-task-id="T2"] button');
  await card.click();
  const detail = page.getByRole("dialog", { name: "Create the settings panel" });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("Adds a Notifications panel to the settings");
  await expect(detail.getByText("The Save button is disabled while the request is being sent.")).toBeHidden();
  await detail.getByText("Detail for the developer").click();
  await expect(detail.getByText("The Save button is disabled while the request is being sent.", { exact: false })).toBeVisible();
  await expect(detail.locator("code", { hasText: "usePreferences()" })).toBeVisible();
  await expect(detail).toContainText("src/settings/NotificationsPanel.tsx");
  await expect(detail).toContainText("AC2");

  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  await expect(card).toBeFocused();

  await card.click();
  await detail.getByRole("button", { name: "Close" }).click();
  await expect(detail).toBeHidden();
});
