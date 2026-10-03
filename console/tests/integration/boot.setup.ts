import { expect, test, type APIRequestContext } from "@playwright/test";
import { realpathSync } from "node:fs";
import path from "node:path";
import { checkoutsRoot, restoredBatchCheckout } from "../fixtures";
import { resetRun } from "./helpers";

type Snapshot = { runs: { id: string; repository: string; issueUrl: string }[]; queued: { issueUrl: string; reason: string; cause?: string; analysisFailure?: string; analysing?: boolean; batchId?: string }[] };
const snapshot = async (request: APIRequestContext) => await (await request.get("/api/runs")).json() as Snapshot;

/**
 * Runs before every spec, on the console as it booted: the queue file seeded by
 * prepareDataDirectory holds a batch of two tickets whose analysis an earlier
 * process never finished. Nothing else can show what a restart does with it.
 */
test("should bring back a batch whose analysis a restart interrupted, one ticket at a time and never in parallel", async ({ page, request }) => {
  const repository = realpathSync(path.join(checkoutsRoot, restoredBatchCheckout));
  await expect.poll(async () => (await snapshot(request)).runs.filter((run) => run.repository === repository).length).toBe(1);
  const restored = await snapshot(request);
  expect(restored.runs.find((run) => run.repository === repository)?.issueUrl).toMatch(/\/issues\/1$/);
  expect(restored.queued).toEqual([expect.objectContaining({
    issueUrl: expect.stringMatching(/\/issues\/2$/), batchId: "batch-restored",
    reason: "conflict", cause: "analysis_failed", analysisFailure: "console redémarrée pendant l'analyse",
  })]);
  expect(restored.queued[0].analysing).toBeUndefined();

  await page.goto("/");
  const queue = page.getByRole("group", { name: "Runs en file d'attente" });
  await expect(queue.getByText("En attente, conflit avec #1 en cours")).toBeVisible();
  await expect(queue.getByText("Analyse en échec")).toBeVisible();
  await queue.getByText("Pourquoi il attend").click();
  await expect(queue.getByText(/console redémarrée pendant l'analyse.*passent un par un/)).toBeVisible();

  // The specs that follow expect an empty console.
  await resetRun(page);
});
