import { expect, test } from "@playwright/test";
import { expectDemoCompleted, resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

const toggle = "button[aria-label='Alert sound']";

test("should keep the alert sound off until it is asked for", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(toggle)).toHaveAttribute("aria-checked", "false");
  expect(await page.evaluate(() => window.localStorage.getItem("impl.sound"))).toBeNull();
});

test("should remember the alert sound across reloads", async ({ page }) => {
  await page.goto("/");
  await page.locator(toggle).click();
  await expect(page.locator(toggle)).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => window.localStorage.getItem("impl.sound"))).toBe("on");

  await page.reload();
  await expect(page.locator(toggle)).toHaveAttribute("aria-checked", "true");

  await page.locator(toggle).click();
  await page.reload();
  await expect(page.locator(toggle)).toHaveAttribute("aria-checked", "false");
  expect(await page.evaluate(() => window.localStorage.getItem("impl.sound"))).toBe("off");
});

test("should make no sound while the setting is off, and sound once it is on", async ({ page }) => {
  // Counts the oscillators the page really builds, which is what playCue does
  // and the only observable proof that a cue was emitted.
  await page.addInitScript(() => {
    (window as unknown as { oscillators: number }).oscillators = 0;
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function patched(this: AudioContext) {
      (window as unknown as { oscillators: number }).oscillators += 1;
      return create.call(this);
    };
  });

  await page.goto("/?demo=1");
  await expect(page.getByText("Decision required")).toBeVisible();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Keep critical alerts" }).click();
  await page.getByRole("button", { name: "Send to Claude" }).click();
  await expectDemoCompleted(page);
  expect(await page.evaluate(() => (window as unknown as { oscillators: number }).oscillators)).toBe(0);

  // Turning it on plays the cue immediately, which is the confirmation the
  // setting works without waiting for a run to reach a decision.
  await page.locator(toggle).click();
  expect(await page.evaluate(() => (window as unknown as { oscillators: number }).oscillators)).toBeGreaterThan(0);
});
