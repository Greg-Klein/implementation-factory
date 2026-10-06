import { expect, test } from "@playwright/test";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createGitCheckout } from "../fixtures";
import { resetRun, runDirectory, startRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

type Runs = { runs: { id: string }[] };

/**
 * With one run held, the page opens it on its own while the launch is still on
 * its way, and the state of that run used to be taken for the answer to the launch.
 */
test("should open the run it just launched when the console already holds one", async ({ page, request }) => {
  const checkout = createGitCheckout("launch-beside");
  await page.goto("/");
  const held = await startRun(page, request, checkout.directory, checkout.issueUrl);
  const rows = page.getByRole("button", { name: /^Open run / });
  await expect(rows).toHaveCount(1);

  await page.goto("/?demo=1");
  await expect(rows).toHaveCount(2);
  const { runs } = await (await request.get("/api/runs")).json() as Runs;
  const launched = runs.findIndex((run) => run.id !== held);
  await expect(rows.nth(launched)).toHaveAttribute("aria-current", "true");
  await expect(rows.nth(1 - launched)).not.toHaveAttribute("aria-current", "true");
  // The view is the launched run's, not only the mark in the list: the demo asks its first question.
  await expect(page.getByText("Decision required")).toBeVisible();
});

test("should keep what the terminal printed while the metrics are shown", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByRole("tab", { name: "Terminal" }).click();
  const screen = page.locator(".xterm-rows");
  await expect(screen).toContainText("Reading the simulated GitLab ticket");

  await page.getByRole("button", { name: "Run metrics" }).click();
  await expect(page.getByRole("region", { name: "Run metrics" })).toBeVisible();
  await expect(screen).toBeHidden();

  await page.getByRole("button", { name: "Run metrics" }).click();
  await expect(page.getByRole("region", { name: "Run metrics" })).toBeHidden();
  await expect(screen).toContainText("Reading the simulated GitLab ticket");
});

test("should draw what can be read of a malformed evidence file and keep the console working", async ({ page, request }) => {
  const checkout = createGitCheckout("evidence-malformed");
  await page.goto("/");
  const runId = await startRun(page, request, checkout.directory, checkout.issueUrl);
  const target = path.join(await runDirectory(request, runId), ".claude", "tasks", "qa-evidence.json");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(`${target}.tmp`, JSON.stringify({ source: "qa", status: 5, items: [null, 7, { label: { text: "Lost" }, verdict: "constructor", expected: { code: 200 } }, { label: "Kept item", verdict: "pass", actual: 42 }] }));
  renameSync(`${target}.tmp`, target);

  await page.getByRole("button", { name: /^Open run / }).first().click();
  await page.getByRole("tab", { name: "Evidence" }).click();
  const reports = page.locator("details", { hasText: "Reports by source" });
  await expect(reports.getByText("Kept item")).toBeVisible();
  await expect(reports.getByText("measured 42")).toBeVisible();
  // The status the file wrote as a number is shown as written, beside the title of its report.
  await expect(reports.getByRole("heading", { name: /Tests & checks/ })).toContainText("5");

  // The rest of the page answers: the form comes back, and so does the run.
  await page.getByRole("button", { name: "New run" }).click();
  await expect(page.getByRole("tab", { name: "Evidence" })).toBeHidden();
  await page.getByRole("button", { name: /^Open run / }).first().click();
  await expect(page.getByRole("tab", { name: "Evidence" })).toBeVisible();
});
