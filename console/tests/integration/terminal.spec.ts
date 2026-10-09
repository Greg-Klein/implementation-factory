import { expect, test } from "@playwright/test";
import { resetRun, startDemoRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

/**
 * Nothing replays what the terminal has already printed, so a terminal rebuilt
 * mid-run starts empty and only gets the redraws that follow, which land as
 * scattered fragments. Every step of a run publishes its state to the page, so
 * a rebuild on a new callback identity used to wipe the screen within seconds.
 */
test("should keep what it has printed while the run keeps publishing", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("tab", { name: "Terminal" }).click();

  const screen = page.locator(".xterm-rows");
  await expect(screen).toContainText("Reading the simulated GitLab ticket");
  await expect(screen).toContainText("Acceptance criteria and edge cases extracted.");
  await expect(screen).toContainText("Reading the simulated GitLab ticket");
});

/**
 * A page opening a run that already printed gets the replay before React has
 * mounted the terminal, and strict mode builds that terminal twice. A slow
 * browser is what puts the replay first, so the CPU is slowed down here.
 */
test("should show what the run printed before the page opened it", async ({ page }) => {
  await startDemoRun(page);
  const browser = await page.context().newCDPSession(page);
  await browser.send("Emulation.setCPUThrottlingRate", { rate: 20 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Terminal" }).click();
  await expect(page.locator(".xterm-rows")).toContainText("Reading the simulated GitLab ticket", { timeout: 20_000 });
});

/**
 * The terminal is mounted behind the tab that is open, where it has no box to
 * measure: reporting the size it falls back to would shrink the agent's
 * pseudo-terminal to 80 columns and reflow everything it draws.
 */
test("should size the session only once its panel is on screen", async ({ page }) => {
  await page.addInitScript(() => {
    const sent: string[] = [];
    Object.defineProperty(window, "__sent", { value: sent });
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) { sent.push(String(data)); return send.call(this, data); };
  });
  const resizes = async () => page.evaluate(() => (window as unknown as { __sent: string[] }).__sent
    .map((entry) => JSON.parse(entry) as { type: string; cols?: number })
    .filter((message) => message.type === "terminal.resize"));

  await page.goto("/?demo=1");
  await page.getByRole("tablist", { name: "Session view" }).waitFor();
  expect(await resizes()).toEqual([]);

  await page.getByRole("tab", { name: "Terminal" }).click();
  await expect(async () => {
    const [first] = await resizes();
    expect(first?.cols).toBeGreaterThan(40);
  }).toPass({ timeout: 2_000 });
});
