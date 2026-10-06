import { expect, test, type APIRequestContext } from "@playwright/test";
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createGitCheckout, dataDirectory, fakeClaudeInputDirectory } from "../fixtures";
import { resetRun } from "./helpers";

type Snapshot = { runs: { id: string; issueUrl: string }[] };
const snapshot = async (request: APIRequestContext) => await (await request.get("/api/runs")).json() as Snapshot;

/** What the stand-in `claude` was started with: see tests/fake-claude/claude. */
async function session(runId: string) {
  const file = path.join(fakeClaudeInputDirectory, `${runId}.session.json`);
  await expect.poll(() => existsSync(file)).toBe(true);
  return JSON.parse(readFileSync(file, "utf8")) as { repository?: string; deliveryProjects?: string };
}

/** A ticket filed in a project the console has no checkout of, as a complaints tracker is. */
const supportTicket = (iid: number) => `https://gitlab.com/group/support-tracker/-/work_items/${iid}`;
const proposalsFile = path.join(dataDirectory, "ticket-proposals.json");

test.beforeEach(async ({ page }) => { rmSync(proposalsFile, { force: true }); await resetRun(page); });
test.afterEach(() => rmSync(proposalsFile, { force: true }));

test("should ask where the merge requests of a ticket with no checkout go, and start one run per repository", async ({ page, request }) => {
  const shop = createGitCheckout("cross-shop");
  const api = createGitCheckout("cross-api");
  await page.goto("/");
  await page.getByLabel("Ticket GitLab or GitHub").fill(supportTicket(11));

  const picker = page.getByRole("combobox", { name: "Merge request repositories" });
  await expect(page.getByText("No checkout of group/support-tracker.")).toBeVisible();
  await expect(page.getByLabel(/Project directory/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start implementation" })).toBeDisabled();

  await picker.fill("cross-shop");
  await page.getByRole("option", { name: /group\/cross-shop/ }).click();
  await picker.fill("cross-api");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "Chosen repositories" }).getByRole("listitem")).toHaveText(["group/cross-shop", "group/cross-api"]);
  await page.getByRole("button", { name: "Start in 2 repositories" }).click();

  await expect.poll(async () => (await snapshot(request)).runs.filter((run) => run.issueUrl === supportTicket(11)).length).toBe(2);
  const runs = (await snapshot(request)).runs.filter((run) => run.issueUrl === supportTicket(11));
  const sessions = await Promise.all(runs.map((run) => session(run.id)));
  expect(sessions.map((started) => started.repository).sort()).toEqual([realpathSync(api.directory), realpathSync(shop.directory)].sort());
  for (const started of sessions) expect(started.deliveryProjects).toBe("group/cross-shop,group/cross-api");
});

test("should start a single chosen repository as a regular run, told it is not the ticket's project", async ({ page, request }) => {
  const shop = createGitCheckout("cross-single");
  await page.goto("/");
  await page.getByLabel("Ticket GitLab or GitHub").fill(supportTicket(12));
  const picker = page.getByRole("combobox", { name: "Merge request repositories" });
  await picker.fill("cross-single");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Start implementation" }).click();

  await expect.poll(async () => (await snapshot(request)).runs.filter((run) => run.issueUrl === supportTicket(12)).length).toBe(1);
  const run = (await snapshot(request)).runs.find((candidate) => candidate.issueUrl === supportTicket(12))!;
  const started = await session(run.id);
  expect(started.repository).toBe(realpathSync(shop.directory));
  expect(started.deliveryProjects).toBe("group/cross-single");
});

test("should hold a batch with a ticket that has no checkout until its repositories are chosen", async ({ page, request }) => {
  const own = createGitCheckout("cross-batch");
  await page.goto("/");
  await page.getByLabel("Ticket GitLab or GitHub").fill([own.issueUrl, supportTicket(13)].join("\n"));
  await page.getByRole("button", { name: "Start 2 tickets" }).click();

  const missing = page.getByRole("group", { name: "Tickets without a checkout" });
  await expect(missing.getByText(/No checkout was found for this ticket/)).toBeVisible();
  expect((await snapshot(request)).runs.filter((run) => run.issueUrl === own.issueUrl)).toEqual([]);
  await expect(page.getByRole("button", { name: "Start 2 tickets" })).toBeDisabled();

  await missing.getByRole("combobox").fill("cross-batch");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Start 2 tickets" }).click();

  await expect.poll(async () => (await snapshot(request)).runs.map((run) => run.issueUrl).sort()).toEqual([own.issueUrl, supportTicket(13)].sort());
});

test("should send a ticket of the watcher to the repositories the watcher or the user named", async ({ page, request }) => {
  createGitCheckout("cross-watched");
  writeFileSync(proposalsFile, JSON.stringify({ tickets: [{ url: supportTicket(14), repositories: ["group/cross-watched"] }, { url: supportTicket(15) }] }));

  await expect.poll(async () => (await snapshot(request)).runs.some((run) => run.issueUrl === supportTicket(14))).toBe(true);
  const run = (await snapshot(request)).runs.find((candidate) => candidate.issueUrl === supportTicket(14))!;
  expect((await session(run.id)).deliveryProjects).toBe("group/cross-watched");

  const listed = page.getByRole("group", { name: "Tickets from the watcher" });
  await expect(listed.getByText(/^Not started: No checkout found for group\/support-tracker/)).toBeVisible();
  await listed.getByRole("button", { name: "Choose repositories" }).click();
  await listed.getByRole("combobox", { name: "Merge request repositories" }).fill("cross-watched");
  await page.keyboard.press("Enter");
  await listed.getByRole("button", { name: "Start", exact: true }).click();

  await expect(listed).toHaveCount(0);
  await expect.poll(async () => (await snapshot(request)).runs.some((entry) => entry.issueUrl === supportTicket(15))).toBe(true);
  expect((await session((await snapshot(request)).runs.find((entry) => entry.issueUrl === supportTicket(15))!.id)).deliveryProjects).toBe("group/cross-watched");
});
