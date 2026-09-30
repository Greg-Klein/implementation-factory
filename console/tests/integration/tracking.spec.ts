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

test("should open the detail of a plan task from its card, and close it", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();
  await page.getByRole("tab", { name: "Suivi" }).click();

  // The demo moves the cards across columns: the card is clicked once the board has settled.
  await expect(page.getByTestId("tracking-column-done").getByTestId("tracking-card")).toHaveCount(4);
  const card = page.locator('[data-testid="tracking-card"][data-task-id="T2"] button');
  await card.click();
  const detail = page.getByRole("dialog", { name: "Créer le panneau de réglages" });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("Ajoute aux réglages un panneau Notifications");
  await expect(detail.getByText("Le bouton Enregistrer se désactive pendant l’envoi.")).toBeHidden();
  await detail.getByText("Détail pour le développeur").click();
  await expect(detail.getByText("Le bouton Enregistrer se désactive pendant l’envoi.", { exact: false })).toBeVisible();
  await expect(detail.locator("code", { hasText: "usePreferences()" })).toBeVisible();
  await expect(detail).toContainText("src/settings/NotificationsPanel.tsx");
  await expect(detail).toContainText("AC2");

  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  await expect(card).toBeFocused();

  await card.click();
  await detail.getByRole("button", { name: "Fermer" }).click();
  await expect(detail).toBeHidden();
});
