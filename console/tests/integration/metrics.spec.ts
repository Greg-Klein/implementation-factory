import { expect, test } from "@playwright/test";
import { resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

type Metrics = { runs: { runId: string; tokens?: { total: { total: number }; pilot: { calls: number }; agents: unknown[] } }[] };

test("should show the tokens of a run on its row and in its progression, and make them grow as it goes", async ({ page, request }) => {
  await page.goto("/?demo=1");
  const row = page.getByRole("button", { name: /^Open run / });
  await expect(row.getByLabel(/tokens used$/)).toBeVisible({ timeout: 15_000 });
  const progression = page.getByRole("complementary", { name: "Run progress" });
  await expect(progression.getByText(/^Pilot .+ calls/)).toBeVisible();

  const total = async () => (await (await request.get("/api/metrics")).json() as Metrics).runs.find((run) => run.runId.startsWith("demo-"))?.tokens?.total.total ?? 0;
  const before = await total();
  expect(before).toBeGreaterThan(0);
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Keep critical alerts" }).click();
  await page.getByRole("button", { name: "Send to Claude" }).click();
  await expect.poll(total, { timeout: 15_000 }).toBeGreaterThan(before);
});

test("should list every measured run in the table of measures and open its detail", async ({ page }) => {
  await page.goto("/?demo=1");
  await expect(page.getByRole("button", { name: /^Open run / })).toBeVisible();
  await page.getByRole("button", { name: "Run metrics" }).click();

  const table = page.getByRole("region", { name: "Run metrics" });
  await expect(table.getByRole("columnheader", { name: "Tokens" })).toBeVisible();
  // Newest first: the run just started leads, ahead of whatever the other specs left measured on disk.
  const detail = table.getByRole("button", { name: /^Metrics detail of run / }).first();
  await detail.click();
  await expect(table.getByText("Tokens per session")).toBeVisible();
  await expect(table.getByRole("cell", { name: "Pilot", exact: true })).toBeVisible();

  // The table stands in for the run view: opening the run again brings it back.
  await page.getByRole("button", { name: /^Open run / }).click();
  await expect(page.getByRole("tab", { name: "Conversation" })).toBeVisible();
});
