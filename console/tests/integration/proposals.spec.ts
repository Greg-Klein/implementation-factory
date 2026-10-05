import { expect, test, type APIRequestContext } from "@playwright/test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createGitCheckout, dataDirectory, fakeClaudeInputDirectory } from "../fixtures";
import { resetRun } from "./helpers";

const file = path.join(dataDirectory, "ticket-proposals.json");
/** What a watcher would write: every ticket that matches its filter right now. */
const found = (tickets: { url: string; title?: string; baseBranch?: string }[]) => writeFileSync(file, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), tickets }));

type Snapshot = { runs: { id: string; issueUrl: string }[]; proposals: { issueUrl: string }[] };
const snapshot = async (request: APIRequestContext) => await (await request.get("/api/runs")).json() as Snapshot;

test.beforeEach(async ({ page }) => { rmSync(file, { force: true }); await resetRun(page); });
test.afterEach(() => rmSync(file, { force: true }));

test("should queue every ticket a watcher found without a click, and not twice while it stays in the file", async ({ page, request }) => {
  const { issueUrl } = createGitCheckout("proposals-launch");
  found([{ url: issueUrl, title: "Corriger le panier" }]);

  await expect.poll(async () => (await snapshot(request)).runs.map((run) => run.issueUrl)).toEqual([issueUrl]);
  await expect(page.getByRole("group", { name: "Tickets from the watcher" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Start proposals-launch/ })).toHaveCount(0);

  found([{ url: issueUrl, title: "Corriger le panier" }]);
  await page.waitForTimeout(1500);
  expect((await snapshot(request)).runs).toHaveLength(1);
  expect((await snapshot(request)).proposals).toEqual([]);
});

test("should list a ticket it cannot launch with the reason, until it is dismissed", async ({ page, request }) => {
  const issueUrl = "https://gitlab.com/group/no-such-checkout/-/issues/5";
  found([{ url: issueUrl }]);

  const listed = page.getByRole("group", { name: "Tickets from the watcher" });
  await expect(listed.getByText(/^Not started: /)).toBeVisible();
  expect((await snapshot(request)).runs).toEqual([]);

  await listed.getByRole("button", { name: "Dismiss no-such-checkout #5" }).click();
  await expect(listed).toHaveCount(0);
  expect((await snapshot(request)).proposals).toEqual([]);
});

test("should start a ticket from the base branch its watcher named", async ({ request }) => {
  const { issueUrl } = createGitCheckout("proposals-base");
  found([{ url: issueUrl, title: "Afficher les points", baseBranch: "feat-87-loyalty" }]);
  await expect.poll(async () => (await snapshot(request)).runs.length).toBe(1);

  const file = path.join(fakeClaudeInputDirectory, `${(await snapshot(request)).runs[0].id}.session.json`);
  await expect.poll(() => existsSync(file)).toBe(true);
  const session = JSON.parse(readFileSync(file, "utf8")) as { ticketBaseBranch?: string; baseBranch?: string };
  expect(session.ticketBaseBranch).toBe("feat-87-loyalty");
  expect(session.baseBranch).toBeUndefined();
});
