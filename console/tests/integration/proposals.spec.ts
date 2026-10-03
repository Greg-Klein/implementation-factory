import { expect, test, type APIRequestContext } from "@playwright/test";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createGitCheckout, dataDirectory } from "../fixtures";
import { resetRun } from "./helpers";

const file = path.join(dataDirectory, "ticket-proposals.json");
/** What a watcher would write: every ticket that matches its filter right now. */
const found = (tickets: { url: string; title?: string }[]) => writeFileSync(file, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), tickets }));

type Snapshot = { runs: { issueUrl: string }[]; proposals: { issueUrl: string }[] };
const snapshot = async (request: APIRequestContext) => await (await request.get("/api/runs")).json() as Snapshot;

test.beforeEach(async ({ page }) => { rmSync(file, { force: true }); await resetRun(page); });
test.afterEach(() => rmSync(file, { force: true }));

test("should propose the tickets a watcher found and start nothing until one is launched", async ({ page, request }) => {
  const { issueUrl } = createGitCheckout("proposals-launch");
  const other = issueUrl.replace(/\/1$/, "/2");
  found([{ url: issueUrl, title: "Corriger le panier" }, { url: other }]);

  const proposed = page.getByRole("group", { name: "Tickets proposés" });
  await expect(proposed.getByText("Proposés · 2")).toBeVisible();
  await expect(proposed.getByText("Corriger le panier")).toBeVisible();
  expect((await snapshot(request)).runs).toEqual([]);

  // Dismissed: gone from the list, and not proposed again while the watcher still finds it.
  await proposed.getByRole("button", { name: "Ignorer proposals-launch #2" }).click();
  await expect(proposed.getByText("Proposés · 1")).toBeVisible();
  found([{ url: issueUrl, title: "Corriger le panier" }, { url: other }]);

  await proposed.getByRole("button", { name: "Lancer proposals-launch #1" }).click();
  await expect.poll(async () => (await snapshot(request)).runs.map((run) => run.issueUrl)).toEqual([issueUrl]);
  await expect(proposed).toHaveCount(0);
  expect((await snapshot(request)).proposals).toEqual([]);
});

test("should keep a ticket proposed when it has no checkout to run in", async ({ page, request }) => {
  const issueUrl = "https://gitlab.com/group/no-such-checkout/-/issues/5";
  found([{ url: issueUrl }]);

  const proposed = page.getByRole("group", { name: "Tickets proposés" });
  await proposed.getByRole("button", { name: "Lancer no-such-checkout #5" }).click();
  await expect(page.getByText("Lancement refusé")).toBeVisible();
  expect((await snapshot(request)).proposals.map((proposal) => proposal.issueUrl)).toEqual([issueUrl]);
});
