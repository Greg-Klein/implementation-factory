import { expect, test } from "@playwright/test";
import { resetRun, runDemoToCompletion } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should show the review confidence of a run with what lowered it, in the Evidence tab, the run list and the metrics", async ({ page, request }) => {
  await runDemoToCompletion(page);

  // The demo ends on a failed criterion, which holds the note at zero whatever else was observed.
  const row = page.getByRole("button", { name: /^Open run/ }).first();
  await expect(row.getByTestId("run-confidence")).toHaveText("conf 0/5");

  await page.getByRole("tab", { name: "Evidence" }).click();
  const confidence = page.getByTestId("review-confidence");
  await expect(confidence.getByTestId("review-confidence-score")).toHaveText("0/5");
  await expect(confidence.getByTestId("review-confidence-reasons")).toContainText("Held at 0: 1 acceptance criterion failed.");

  const metrics = await (await request.get("/api/metrics")).json() as { runs: { outcome: { confidence?: number } }[]; calibration?: unknown[] };
  expect(metrics.runs[0]?.outcome.confidence).toBe(0);
  expect(metrics.calibration).toEqual([]);
});
