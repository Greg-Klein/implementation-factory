import { expect, test } from "@playwright/test";
import { expectDemoCompleted, resetRun, runDemoToCompletion } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should name the branch and the merge request the run produced", async ({ page }) => {
  await page.goto("/?demo=1");

  // The ticket is known from the first second, the branch only once the workflow
  // creates it, and the merge request only once it is opened.
  await expect(page.getByTitle("ticket-simule://IH-42")).toBeVisible();
  await expect(page.getByTitle("feat/ih-42-notification-preferences")).toHaveCount(0);

  await expect(page.getByText("Decision required")).toBeVisible();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Keep critical alerts" }).click();
  await page.getByRole("button", { name: "Send to Claude" }).click();

  await expect(page.getByTitle("feat/ih-42-notification-preferences")).toBeVisible();
  const mergeRequest = page.getByTitle("ticket-simule://acme-dashboard/-/merge_requests/128");
  await expect(mergeRequest).toBeVisible();
  await expect(mergeRequest).toHaveText("!128");
});

test("should carry the state of the run into the tab title", async ({ page }) => {
  await page.goto("/?demo=1");

  await expect(page.getByText("Decision required")).toBeVisible();
  await expect(page).toHaveTitle("● Claude is waiting for 2 answers · Implementation Factory");

  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Keep critical alerts" }).click();
  await page.getByRole("button", { name: "Send to Claude" }).click();

  await expectDemoCompleted(page);
  await expect(page).toHaveTitle("✓ Completed · Implementation Factory");
});

test("should leave the tab title alone while no run is going on", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Implementation Factory");
});

test("should show no deliverable block before a run starts", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Deliverable")).toHaveCount(0);
});

test("should reach completion with the deliverable still readable", async ({ page }) => {
  await runDemoToCompletion(page);
  await expect(page.getByText("Deliverable")).toBeVisible();
});
