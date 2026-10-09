import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { createGitCheckout, fakeClaudeInputDirectory, hookToken, issueLinks, mergeRequestState, pullRequestState, scheduleFixture } from "../fixtures";
import { resetRun, startRun } from "./helpers";

test.beforeEach(async ({ page }) => { scheduleFixture(); await resetRun(page); });
test.afterEach(() => scheduleFixture());

type Queued = { id: string; issueUrl: string; reason: string; cause?: string; detail?: string; analysisFailure?: string; forced?: { mode: string } };
type Snapshot = { runs: { id: string; repository: string; issueUrl: string; status: string }[]; queued: Queued[] };
type Session = { cwd: string; worktree?: string; repository?: string; baseBranch?: string; argv: string[] };
type ScheduleCall = { cwd: string; argv: string[]; runId: string | null; hookUrl: string | null; input: { repository: string; tickets: { issue_url: string }[] } };

const snapshot = async (request: APIRequestContext) => await (await request.get("/api/runs")).json() as Snapshot;
const number = (issueUrl: string) => Number(issueUrl.split("/").pop());
/** The tickets that run and the tickets that wait, by number. */
async function standing(request: APIRequestContext) {
  const { runs, queued } = await snapshot(request);
  return { running: runs.map((run) => number(run.issueUrl)).sort(), waiting: queued.map((entry) => number(entry.issueUrl)).sort() };
}

async function sessionOf(runId: string) {
  const file = path.join(fakeClaudeInputDirectory, `${runId}.session.json`);
  await expect.poll(() => existsSync(file)).toBe(true);
  return JSON.parse(readFileSync(file, "utf8")) as Session;
}

function scheduleCalls() {
  const file = path.join(fakeClaudeInputDirectory, "schedule-calls.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line) as ScheduleCall) : [];
}

let hookSequence = 0;
async function postHook(request: APIRequestContext, runId: string, payload: Record<string, unknown>) {
  const response = await request.post(`/api/hooks?token=${hookToken}`, { data: { runId, hookId: `batch-hook-${Date.now()}-${hookSequence++}`, payload } });
  expect(response.ok()).toBe(true);
}

/** An invented repository with invented tickets, numbered from 1. */
function batch(name: string, forge: "gitlab" | "github" = "gitlab") {
  const checkout = createGitCheckout(name, forge);
  return { ...checkout, repository: realpathSync(checkout.directory), url: (iid: number) => checkout.issueUrl.replace(/\/1$/, `/${iid}`) };
}

async function paste(page: Page, lines: string[]) {
  await page.goto("/");
  await page.getByLabel("Ticket GitLab or GitHub").fill(lines.join("\n"));
}

const queue = (page: Page) => page.getByRole("group", { name: "Queued runs" });

test("should take several tickets at once, start those that conflict with nothing, and say why the other one waits", async ({ page, request }) => {
  const { url, repository } = batch("batch-conflict");
  scheduleFixture({ edges: [{ a: 1, b: 2, kind: "overlap", reason: "Les deux tickets modifient app.ts." }] });
  const callsBefore = scheduleCalls().length;

  // What is not a ticket is flagged with its line, and nothing is sent while it is there.
  await paste(page, [url(1), `${url(2)}?tab=notes`, "pas-un-ticket", url(3), url(1)]);
  await expect(page.getByText("3 tickets recognized")).toBeVisible();
  await expect(page.getByText("1 duplicate skipped")).toBeVisible();
  await expect(page.getByText("Line 3: pas-un-ticket is not a GitLab or GitHub ticket URL.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start 3 tickets" })).toBeDisabled();

  await page.getByLabel("Ticket GitLab or GitHub").fill([url(1), `${url(2)}?tab=notes`, url(3)].join("\n"));
  // A batch finds each checkout from its ticket: no directory to give.
  await expect(page.getByLabel(/Project directory/)).toHaveCount(0);
  await page.getByLabel(/Special instruction/).fill("reste sur desktop");
  await expect(page.getByText("applied to every ticket of the batch")).toBeVisible();
  await page.getByRole("button", { name: "Start 3 tickets" }).click();

  await expect.poll(() => standing(request)).toEqual({ running: [1, 3], waiting: [2] });
  await expect(page.getByText("Batch queued")).toBeVisible();
  await expect(page.getByLabel("Ticket GitLab or GitHub")).toHaveValue("");

  // The held ticket says which ticket it waits for, and the agent's reason sits behind a disclosure.
  const [held] = (await snapshot(request)).queued;
  expect(held).toMatchObject({ issueUrl: url(2), reason: "conflict", cause: "overlap", detail: "Les deux tickets modifient app.ts." });
  await expect(queue(page).getByRole("group", { name: /^Batch of/ })).toBeVisible();
  await expect(queue(page).getByText("batch-conflict", { exact: true })).toBeVisible();
  await expect(queue(page).getByText("Waiting, conflict with #1, which is running")).toBeVisible();
  await expect(queue(page).getByText("Les deux tickets modifient app.ts.")).toBeHidden();
  await queue(page).getByText("Why it waits").click();
  await expect(queue(page).getByText("Les deux tickets modifient app.ts.")).toBeVisible();
  await expect(queue(page).getByText("This ticket: Ticket 2 du lot de test.")).toBeVisible();

  // One scheduling session for the repository, in its checkout, that reports to no run.
  const calls = scheduleCalls().slice(callsBefore);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ cwd: repository, runId: null, hookUrl: null });
  expect(calls[0]!.input).toMatchObject({ repository, tickets: [url(1), url(2), url(3)].map((issueUrl) => ({ issue_url: issueUrl })) });
  expect(calls[0]!.argv.at(-1)).toMatch(/^\/implementation-factory:schedule \S+input\.json \S+output\.json$/);

  // The instruction went to every ticket of the batch.
  const { runs } = await snapshot(request);
  for (const run of runs) expect((await sessionOf(run.id)).argv.at(-1)).toBe(`/implementation-factory:implement ${run.issueUrl} reste sur desktop`);

  // Stacking needs the branch of the ticket it waits for: offered once that branch exists.
  await expect(queue(page).getByRole("button", { name: /^Stack / })).toHaveCount(0);
  const first = runs.find((run) => number(run.issueUrl) === 1)!;
  await postHook(request, first.id, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "b1", tool_input: { command: "git checkout -b feat/1-promo" } });
  await expect(queue(page).getByText(/opens its merge request against that branch/)).toBeVisible();
  await queue(page).getByRole("button", { name: "Stack batch-conflict #2 on feat/1-promo" }).click();

  await expect.poll(() => standing(request)).toEqual({ running: [1, 2, 3], waiting: [] });
  const stacked = (await snapshot(request)).runs.find((run) => number(run.issueUrl) === 2)!;
  const session = await sessionOf(stacked.id);
  // The base branch goes to the workflow together with the run's own worktree.
  expect(session).toMatchObject({ baseBranch: "feat/1-promo", repository, worktree: path.join(repository, ".claude", "worktrees", stacked.id) });
  expect((await sessionOf(first.id)).baseBranch).toBeUndefined();
  await page.getByRole("button", { name: "Open run batch-conflict #2" }).click();
  const progression = page.getByLabel("Run progress");
  await expect(progression.getByText("Stacked on", { exact: true })).toBeVisible();
  await expect(progression.getByText("feat/1-promo", { exact: true })).toBeVisible();
});

test("should hold a ticket started alone behind the running ticket GitLab says blocks it, with no analysis session", async ({ page, request }) => {
  const { url, directory } = batch("batch-blocked");
  const callsBefore = scheduleCalls().length;
  await page.goto("/");
  await startRun(page, request, directory, url(1));
  // GitLab writes the blocking ticket as a work item, the console knows it as an issue.
  issueLinks(2, [{ link_type: "is_blocked_by", web_url: url(1).replace("/-/issues/", "/-/work_items/") }]);
  try {
    await page.evaluate(({ cwd, issueUrl }) => new Promise<void>((resolve) => {
      const socket = new WebSocket(`ws://${window.location.host}/ws`);
      socket.addEventListener("open", () => { socket.send(JSON.stringify({ type: "run.start", cwd, issueUrl })); resolve(); });
    }), { cwd: directory, issueUrl: url(2) });
    await expect.poll(() => standing(request)).toEqual({ running: [1], waiting: [2] });
    expect((await snapshot(request)).queued[0]).toMatchObject({ reason: "conflict", cause: "depends_on", detail: "GitLab marks #2 as blocked by #1." });
    await expect(queue(page).getByText("Waiting, conflict with #1, which is running")).toBeVisible();
    expect(scheduleCalls()).toHaveLength(callsBefore);
  } finally {
    issueLinks(2);
  }
});

test("should start a held ticket from the base when asked, and remove another from the queue", async ({ page, request }) => {
  const { url } = batch("batch-force");
  scheduleFixture({ edges: [{ a: 1, b: 2, kind: "overlap", reason: "Same file." }, { a: 1, b: 3, kind: "overlap", reason: "Same file." }] });
  await paste(page, [url(1), url(2), url(3)]);
  await page.getByRole("button", { name: "Start 3 tickets" }).click();
  await expect.poll(() => standing(request)).toEqual({ running: [1], waiting: [2, 3] });

  // Moving #3 up puts it first among the waiting tickets.
  await queue(page).getByRole("button", { name: "Move batch-force #3 up in the queue" }).click();
  await expect.poll(async () => (await snapshot(request)).queued.map((entry) => number(entry.issueUrl))).toEqual([3, 2]);
  // Dropped on the upper half of #3, #2 goes back in front of it.
  await queue(page).getByTitle("batch-force #2").dragTo(queue(page).getByTitle("batch-force #3"));
  await expect.poll(async () => (await snapshot(request)).queued.map((entry) => number(entry.issueUrl))).toEqual([2, 3]);
  await queue(page).getByRole("button", { name: "Remove batch-force #3 from the queue" }).click();
  await expect.poll(() => standing(request)).toEqual({ running: [1], waiting: [2] });

  await expect(queue(page).getByText("Why it waits")).toHaveCount(1);
  await queue(page).getByText("Why it waits").click();
  // The wording says what forcing costs.
  await expect(queue(page).getByText(/Starts without waiting for #1\. Both tickets touch the same code/)).toBeVisible();
  await queue(page).getByRole("button", { name: "Start batch-force #2 from the base" }).click();
  await expect.poll(() => standing(request)).toEqual({ running: [1, 2], waiting: [] });
  const forced = (await snapshot(request)).runs.find((run) => number(run.issueUrl) === 2)!;
  expect((await sessionOf(forced.id)).baseBranch).toBeUndefined();
});

test("should run the batch one ticket at a time when its analysis fails, and say so", async ({ page, request }) => {
  const { url } = batch("batch-failed");
  scheduleFixture({ mode: "fail" });
  await paste(page, [url(1), url(2), url(3)]);
  await page.getByRole("button", { name: "Start 3 tickets" }).click();

  await expect.poll(() => standing(request)).toEqual({ running: [1], waiting: [2, 3] });
  await expect(page.getByText("Batch analysis failed", { exact: true })).toBeVisible();
  await expect(page.getByText(/batch-failed: output file missing\. Its 3 tickets run one at a time/)).toBeVisible();
  const { queued } = await snapshot(request);
  expect(queued).toEqual([2, 3].map((iid) => expect.objectContaining({ issueUrl: url(iid), reason: "conflict", cause: "analysis_failed", analysisFailure: "output file missing" })));
  await expect(queue(page).getByText("Waiting, conflict with #1, which is running")).toHaveCount(2);
  await expect(queue(page).getByText("Analysis failed", { exact: true })).toHaveCount(2);
});

test("should show a batch being analysed, then fall back on one ticket at a time when the session never answers", async ({ page, request }) => {
  const { url } = batch("batch-timeout");
  scheduleFixture({ mode: "hang" });
  await paste(page, [url(1), url(2)]);
  await page.getByRole("button", { name: "Start 2 tickets" }).click();

  await expect(queue(page).getByText("Analysis in progress")).toHaveCount(2);
  expect(await standing(request)).toEqual({ running: [], waiting: [1, 2] });
  // Past the delay the suite gives a session, the batch stops waiting for it.
  await expect.poll(() => standing(request), { timeout: 15_000 }).toEqual({ running: [1], waiting: [2] });
  expect((await snapshot(request)).queued[0]).toMatchObject({ cause: "analysis_failed", analysisFailure: "timeout of 4 s exceeded" });
});

test("should wait for the merge request of the ticket it conflicts with, then start once it is merged", async ({ page, request }) => {
  const { url, project } = batch("batch-merge");
  scheduleFixture({ edges: [{ a: 1, b: 2, kind: "depends_on", order: [1, 2], reason: "Le second ticket lit ce que le premier calcule." }] });
  mergeRequestState(31);
  // Pasted in the wrong order: the dependency still goes first.
  await paste(page, [url(2), url(1)]);
  await page.getByRole("button", { name: "Start 2 tickets" }).click();
  await expect.poll(() => standing(request)).toEqual({ running: [1], waiting: [2] });

  // The first ticket opens its merge request, then its session is stopped: nothing is merged yet.
  const first = (await snapshot(request)).runs[0]!;
  const mergeRequest = `https://gitlab.com/${project}/-/merge_requests/31`;
  await postHook(request, first.id, { hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "mr1", tool_input: { command: "glab mr create --fill --yes" }, tool_response: { stdout: `${mergeRequest}\n` } });
  await page.getByRole("button", { name: "Open run batch-merge #1" }).click();
  await page.getByRole("button", { name: "Stop" }).click();

  // GitLab does not answer: the ticket keeps waiting, and the row says the state is unknown.
  await expect(queue(page).getByText("State of MR !31 unknown (#1)")).toBeVisible();
  mergeRequestState(31, "opened");
  await expect(queue(page).getByText("Waits for MR !31 to be merged (#1)")).toBeVisible();
  expect(await standing(request)).toEqual({ running: [1], waiting: [2] });
  expect((await snapshot(request)).runs[0]!.status).toBe("stopped");

  mergeRequestState(31, "merged");
  await expect.poll(async () => (await snapshot(request)).runs.map((run) => number(run.issueUrl)).sort()).toEqual([1, 2]);
  await expect(page.getByText("Merge request merged")).toBeVisible();
  expect((await snapshot(request)).queued).toEqual([]);
});

test("should take GitHub issues, wait for the pull request of the one in conflict and call it a pull request", async ({ page, request }) => {
  const { url, project } = batch("batch-github", "github");
  scheduleFixture({ edges: [{ a: 1, b: 2, kind: "depends_on", order: [1, 2], reason: "Le second ticket lit ce que le premier calcule." }] });
  pullRequestState(41);
  await paste(page, [url(1), url(2)]);
  await expect(page.getByText("2 tickets recognized")).toBeVisible();
  await page.getByRole("button", { name: "Start 2 tickets" }).click();
  await expect.poll(() => standing(request)).toEqual({ running: [1], waiting: [2] });

  const first = (await snapshot(request)).runs[0]!;
  const pullRequest = `https://github.com/${project}/pull/41`;
  await postHook(request, first.id, { hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "pr1", tool_input: { command: "gh pr create --base main --body-file .claude/tasks/mr-description.md" }, tool_response: { stdout: `${pullRequest}\n` } });
  await page.getByRole("button", { name: "Open run batch-github #1" }).click();
  await expect(page.getByText("Open the PR")).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();

  // GitHub does not answer, then says the pull request is open: the ticket waits either way.
  await expect(queue(page).getByText("State of PR #41 unknown (#1)")).toBeVisible();
  pullRequestState(41, "open");
  await expect(queue(page).getByText("Waits for PR #41 to be merged (#1)")).toBeVisible();
  expect(await standing(request)).toEqual({ running: [1], waiting: [2] });

  pullRequestState(41, "merged");
  await expect.poll(async () => (await snapshot(request)).runs.map((run) => number(run.issueUrl)).sort()).toEqual([1, 2]);
  await expect(page.getByText("Pull request merged")).toBeVisible();
});

test("should play a batch of invented tickets with one conflict in demonstration mode", async ({ page, request }) => {
  await page.goto("/?demo=batch");
  await expect(queue(page).getByText("Analysis in progress")).toHaveCount(3);
  await expect.poll(async () => (await snapshot(request)).runs.map((run) => run.issueUrl).sort()).toEqual(["ticket-simule://IH-42", "ticket-simule://IH-44"]);
  await expect(queue(page).getByText("Waiting, conflict with IH-42, which is running")).toBeVisible();
  await queue(page).getByText("Why it waits").click();
  await expect(queue(page).getByText("Both tickets modify the notification preferences panel.")).toBeVisible();
});
