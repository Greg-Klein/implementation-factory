import { expect, test } from "@playwright/test";
import { resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should stop showing an agent as active once the run is over", async ({ page }) => {
  await page.goto("/?demo=1");
  await expect(page.getByText("Decision required")).toBeVisible();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Keep critical alerts" }).click();
  await page.getByRole("button", { name: "Send to Claude" }).click();

  const agents = page.getByRole("region", { name: "Agents" });
  await expect(agents.getByText("1 active", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Stop" }).click();

  // The stop event can never arrive for an agent whose session is gone, so one
  // still running is abandoned rather than left spinning a timer for good.
  await expect(agents).toBeHidden();
});
