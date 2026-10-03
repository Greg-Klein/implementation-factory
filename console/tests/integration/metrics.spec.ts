import { expect, test } from "@playwright/test";
import { resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

type Metrics = { runs: { runId: string; tokens?: { total: { total: number }; pilot: { calls: number }; agents: unknown[] } }[] };

test("should show the tokens of a run on its row and in its progression, and make them grow as it goes", async ({ page, request }) => {
  await page.goto("/?demo=1");
  const row = page.getByRole("button", { name: /^Ouvrir le run / });
  await expect(row.getByLabel(/tokens consommés$/)).toBeVisible({ timeout: 15_000 });
  const progression = page.getByRole("complementary", { name: "Progression du run" });
  await expect(progression.getByText(/^Pilote .+ appels/)).toBeVisible();

  const total = async () => (await (await request.get("/api/metrics")).json() as Metrics).runs.find((run) => run.runId.startsWith("demo-"))?.tokens?.total.total ?? 0;
  const before = await total();
  expect(before).toBeGreaterThan(0);
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Garder les alertes critiques" }).click();
  await page.getByRole("button", { name: "Transmettre à Claude" }).click();
  await expect.poll(total, { timeout: 15_000 }).toBeGreaterThan(before);
});

test("should list every measured run in the table of measures and open its detail", async ({ page }) => {
  await page.goto("/?demo=1");
  await expect(page.getByRole("button", { name: /^Ouvrir le run / })).toBeVisible();
  await page.getByRole("button", { name: "Mesures des runs" }).click();

  const table = page.getByRole("region", { name: "Mesures des runs" });
  await expect(table.getByRole("columnheader", { name: "Tokens" })).toBeVisible();
  // Newest first: the run just started leads, ahead of whatever the other specs left measured on disk.
  const detail = table.getByRole("button", { name: /^Détail des mesures du run / }).first();
  await detail.click();
  await expect(table.getByText("Tokens par session")).toBeVisible();
  await expect(table.getByRole("cell", { name: "Pilote", exact: true })).toBeVisible();

  // The table stands in for the run view: opening the run again brings it back.
  await page.getByRole("button", { name: /^Ouvrir le run / }).click();
  await expect(page.getByRole("tab", { name: "Conversation" })).toBeVisible();
});
