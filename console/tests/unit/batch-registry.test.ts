import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { QueuedRun, ScheduledTicket } from "../../server/types";

// Watchers are never started here, and chokidar ships as ESM only.
jest.mock("chokidar", () => ({ __esModule: true, default: { watch: () => ({ on: () => undefined, close: async () => undefined }) } }));

/**
 * The registry with real scheduling sessions behind it, played by the stand-in
 * `claude` of the integration suite, and runs that never start a session:
 * `start` is replaced, so what is checked is which entry starts, and when.
 * Every ticket and every repository here is invented.
 */
const storage = mkdtempSync(path.join(os.tmpdir(), "harness-batch-"));
const fixtureFile = path.join(storage, "schedule-fixture.json");
process.env.IMPL_DATA_DIR = path.join(storage, "data");
process.env.IMPL_ENV_FILE = path.join(storage, "absent.env");
process.env.IMPL_SCHEDULE_TIMEOUT_MS = "1500";
process.env.IMPL_MAX_CONCURRENT_RUNS = "3";
process.env.FAKE_CLAUDE_SCHEDULE = fixtureFile;
process.env.FAKE_CLAUDE_INPUT_DIR = storage;
// Where the stand-in `glab` reads the state of a merge request. Empty, it answers nothing.
const glabDirectory = path.join(storage, "glab");
process.env.FAKE_GLAB_DIR = glabDirectory;
// The stand-in `claude`, and a `glab` that answers nothing.
process.env.PATH = `${path.resolve(__dirname, "..", "fake-claude")}${path.delimiter}${process.env.PATH ?? ""}`;

let RunSession: typeof import("../../server/run-session").RunSession;
let RunRegistry: typeof import("../../server/registry").RunRegistry;
type Registry = InstanceType<typeof RunRegistry>;
type Session = InstanceType<typeof RunSession>;

beforeAll(async () => {
  ({ RunSession } = await import("../../server/run-session"));
  ({ RunRegistry } = await import("../../server/registry"));
});

const registries: Registry[] = [];
afterEach(async () => {
  for (const registry of registries.splice(0)) await registry.shutdown();
  rmSync(fixtureFile, { force: true });
  rmSync(glabDirectory, { recursive: true, force: true });
  rmSync(path.join(storage, "schedule-calls.jsonl"), { force: true });
});
afterAll(() => rmSync(storage, { recursive: true, force: true }));

let sequence = 0;
function repository(name: string) {
  const directory = path.join(storage, "checkouts", `${name}-${sequence++}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}
const url = (iid: number, project = "shop") => `https://gitlab.com/acme/${project}/-/issues/${iid}`;
const tickets = (directory: string, ...iids: number[]) => iids.map((iid) => ({ repository: directory, issueUrl: url(iid) }));

/** A registry whose runs are sessions without a process, started in the order the queue lets them go. */
function harness() {
  const registry = new RunRegistry();
  registry.monitor.stop();
  registries.push(registry);
  const started: Session[] = [];
  const internals = registry as unknown as { start(entry: QueuedRun): Promise<Session>; register(session: Session): Session; applyMergeStatus(watch: unknown, status: string): Promise<void>; watches: { mergeRequestUrl: string }[] };
  internals.start = async (entry) => {
    const session = internals.register(new RunSession(`run-${sequence++}`, {
      status: "running", phase: 1, cwd: entry.repository, repository: entry.repository, issueUrl: entry.issueUrl, instruction: entry.instruction, sessionActive: true, startedAt: new Date().toISOString(),
      ...(entry.forced?.mode === "stacked" ? { baseBranch: entry.forced.baseBranch } : {}),
    }));
    started.push(session);
    return session;
  };
  const numbers = () => started.map((session) => Number(session.state.issueUrl.split("/").pop()));
  const queued = () => registry.snapshot().queued;
  const waiting = (iid: number) => queued().find((entry) => entry.issueUrl === url(iid));
  /** The workflow of a run reaching its end, its session gone with it. */
  const finish = (iid: number, mergeRequest?: number) => {
    const session = started.find((candidate) => candidate.state.issueUrl === url(iid))!;
    session.state.status = "completed";
    session.state.sessionActive = false;
    session.state.endedAt = new Date().toISOString();
    session.state.branch = `feat/${iid}`;
    if (mergeRequest) session.state.mergeRequestUrl = `https://gitlab.com/acme/shop/-/merge_requests/${mergeRequest}`;
    session.publish();
  };
  const merge = (status: "merged" | "closed" | "unknown" | "opened") => internals.applyMergeStatus(internals.watches[0], status);
  return { registry, internals, started, numbers, queued, waiting, finish, merge };
}

async function until(condition: () => boolean, label: string) {
  const deadline = Date.now() + 6_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const analysed = (queued: () => { reason: string }[]) => () => queued().every((entry) => entry.reason !== "analysis");
const calls = () => existsSync(path.join(storage, "schedule-calls.jsonl"))
  ? readFileSync(path.join(storage, "schedule-calls.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { cwd: string; argv: string[]; runId: string | null; hookUrl: string | null; input: { repository: string; tickets: { issue_url: string }[]; known: { issue_url: string; state: string; files: string[] }[] } })
  : [];
const fixture = (value: Record<string, unknown>) => writeFileSync(fixtureFile, JSON.stringify(value));

describe("a batch of tickets", () => {
  it("should analyse the batch, start what conflicts with nothing and hold the rest with the agent's reason", async () => {
    fixture({ edges: [{ a: 101, b: 102, kind: "overlap", reason: "Les deux tickets modifient le panier." }] });
    const shop = repository("shop");
    const { registry, numbers, queued, waiting } = harness();
    const outcome = await registry.enqueueBatch(tickets(shop, 101, 102, 103), { instruction: "  desktop uniquement " });
    expect(outcome.entries).toHaveLength(3);
    expect(outcome.entries.every((entry) => entry.instruction === "desktop uniquement" && entry.batchId === outcome.batchId)).toBe(true);
    // Nothing starts before the analysis has answered.
    expect(queued().map((entry) => entry.reason)).toEqual(["analysis", "analysis", "analysis"]);
    expect(numbers()).toEqual([]);
    await until(() => numbers().length === 2, "the two free tickets to start");
    expect(numbers()).toEqual([101, 103]);
    expect(waiting(102)).toMatchObject({ reason: "conflict", cause: "overlap", detail: "Les deux tickets modifient le panier.", summary: "Ticket 102 du lot de test." });
    // One session, in the checkout, reporting to no run.
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({ cwd: expect.stringContaining(path.basename(shop)), runId: null, hookUrl: null });
    expect(calls()[0].input).toEqual({ repository: shop, language: "en", tickets: [101, 102, 103].map((iid) => ({ issue_url: url(iid) })), known: [] });
    // The answer was read: its directory is gone, ticket content with it.
    expect(readdirSync(path.join(storage, "data", "schedule"))).toEqual([]);
  });

  it("should not analyse a single ticket with nothing to compare it to", async () => {
    const { registry, numbers } = harness();
    const outcome = await registry.enqueueBatch(tickets(repository("shop"), 101));
    expect(outcome.started).toHaveLength(1);
    expect(numbers()).toEqual([101]);
    expect(calls()).toEqual([]);
  });

  it("should hold a single ticket behind the running one the forge says blocks it, without a session", async () => {
    const shop = repository("shop");
    const { registry, numbers, queued, waiting } = harness();
    await registry.enqueueBatch(tickets(shop, 101));
    // GitLab names the blocking ticket by its work item address, the console by the issue one.
    mkdirSync(glabDirectory, { recursive: true });
    writeFileSync(path.join(glabDirectory, "issue-links-102"), JSON.stringify([
      { iid: 101, link_type: "is_blocked_by", web_url: "https://gitlab.com/acme/shop/-/work_items/101" },
      { iid: 90, link_type: "relates_to", web_url: url(90) },
    ]));
    await registry.enqueueBatch(tickets(shop, 102));
    await until(analysed(queued), "the links to be read");
    expect(numbers()).toEqual([101]);
    expect(waiting(102)).toMatchObject({ reason: "conflict", cause: "depends_on", detail: "GitLab marks #102 as blocked by #101." });
    expect(calls()).toEqual([]);
  });

  it("should start a single ticket beside a running one when the forge links them by nothing, or does not answer", async () => {
    const shop = repository("shop");
    const { registry, numbers } = harness();
    await registry.enqueueBatch(tickets(shop, 101));
    mkdirSync(glabDirectory, { recursive: true });
    writeFileSync(path.join(glabDirectory, "issue-links-102"), "[]");
    await registry.enqueueBatch(tickets(shop, 102));
    await registry.enqueueBatch(tickets(shop, 103));
    await until(() => numbers().length === 3, "both tickets to start");
    expect(calls()).toEqual([]);
  });

  it("should put a blocking link of the forge over what the session said of the same two tickets", async () => {
    fixture({ edges: [{ a: 101, b: 102, kind: "overlap", reason: "Same file." }] });
    mkdirSync(glabDirectory, { recursive: true });
    writeFileSync(path.join(glabDirectory, "issue-links-102"), JSON.stringify([{ iid: 101, link_type: "blocks", web_url: url(101) }]));
    const { registry, numbers, waiting } = harness();
    await registry.enqueueBatch(tickets(repository("shop"), 101, 102));
    await until(() => numbers().length === 1, "the blocking ticket to start");
    // The order asked was 101 then 102: the link turns it around.
    expect(numbers()).toEqual([102]);
    expect(waiting(101)).toMatchObject({ reason: "conflict", cause: "depends_on", detail: "GitLab marks #101 as blocked by #102." });
  });

  it("should analyse each repository on its own, and never hold a ticket for another repository", async () => {
    // The same numbers in both repositories, and an edge the fixture gives to each.
    fixture({ edges: [{ a: 101, b: 102, kind: "overlap", reason: "Same file." }] });
    const shop = repository("shop");
    const api = repository("api");
    const { registry, started, queued } = harness();
    await registry.enqueueBatch([...tickets(shop, 101, 102), ...tickets(api, 101), ...tickets(api, 102)]);
    await until(() => started.length === 2, "one ticket per repository to start");
    expect(calls().map((call) => call.input.repository).sort()).toEqual([api, shop].sort());
    expect(started.map((session) => session.state.repository).sort()).toEqual([api, shop].sort());
    expect(queued().map((entry) => [entry.repository, entry.reason])).toEqual([[shop, "conflict"], [api, "conflict"]]);
  });

  it("should leave out a ticket it already has, and analyse only the new ones against the known ones", async () => {
    fixture({ edges: [{ a: 101, b: 102, kind: "overlap", reason: "Same file." }, { a: 104, b: 103, kind: "depends_on", order: [103, 104], reason: "Needs ticket 103." }] });
    const shop = repository("shop");
    const { registry, numbers, queued, waiting } = harness();
    await registry.enqueueBatch(tickets(shop, 101, 102, 103));
    await until(() => numbers().length === 2, "the first batch to start");
    const second = await registry.enqueueBatch([...tickets(shop, 102, 104), { repository: shop, issueUrl: `${url(101)}?tab=notes` }]);
    expect(second.duplicates).toEqual([url(102), `${url(101)}?tab=notes`]);
    expect(second.entries.map((entry) => entry.issueUrl)).toEqual([url(104)]);
    await until(analysed(queued), "the second analysis");
    const call = calls()[1];
    expect(call.input.tickets).toEqual([{ issue_url: url(104) }]);
    expect(call.input.known.map((known) => [known.issue_url, known.state])).toEqual([[url(101), "running"], [url(102), "queued"], [url(103), "running"]]);
    expect(call.input.known[0].files).toEqual(["src/ticket-101.ts"]);
    expect(waiting(104)).toMatchObject({ reason: "conflict", cause: "depends_on", detail: "Needs ticket 103." });
    await expect(registry.enqueueBatch(tickets(shop, 101, 102))).rejects.toThrow(/already queued, running or waiting for a merge/);
  });

  it("should wait for the merge request of a finished run, then start from the updated base", async () => {
    fixture({ edges: [{ a: 101, b: 102, kind: "overlap", reason: "Same file." }] });
    const shop = repository("shop");
    const { registry, numbers, waiting, finish, merge } = harness();
    await registry.enqueueBatch(tickets(shop, 101, 102));
    await until(() => numbers().length === 1, "the first ticket to start");
    finish(101, 12);
    await until(() => Boolean(waiting(102)?.reason.startsWith("merge")), "the wait to become a merge wait");
    expect(waiting(102)?.blocking).toMatchObject({ issueUrl: url(101), mergeRequestUrl: "https://gitlab.com/acme/shop/-/merge_requests/12", branch: "feat/101" });
    // The ticket behind an unmerged merge request is still one the console has.
    await expect(registry.enqueueBatch(tickets(shop, 101))).rejects.toThrow(/waiting for a merge/);
    // GitLab not answering keeps holding, and says so.
    await merge("unknown");
    expect(waiting(102)?.reason).toBe("merge_unknown");
    expect(numbers()).toEqual([101]);
    await merge("opened");
    expect(waiting(102)?.reason).toBe("merge");
    await merge("merged");
    await until(() => numbers().length === 2, "the held ticket to start");
    expect(numbers()).toEqual([101, 102]);
    expect(registry.mergeWatcher.running).toBe(false);
  });

  it("should release what waits when the merge request is closed, or when the run ends without one", async () => {
    fixture({ edges: [{ a: 101, b: 102, kind: "overlap", reason: "Same file." }, { a: 102, b: 103, kind: "overlap", reason: "Same file." }] });
    const { registry, numbers, finish, merge } = harness();
    await registry.enqueueBatch(tickets(repository("shop"), 101, 102, 103));
    await until(() => numbers().length === 1, "the first ticket to start");
    finish(101, 12);
    await merge("closed");
    await until(() => numbers().length === 2, "the second ticket to start");
    // No merge request at all: nothing to wait for.
    finish(102);
    await until(() => numbers().length === 3, "the third ticket to start");
    expect(numbers()).toEqual([101, 102, 103]);
  });

  it("should fall back on one ticket at a time when the session writes no file, and say why", async () => {
    fixture({ mode: "fail" });
    const { registry, numbers, queued, waiting, finish } = harness();
    await registry.enqueueBatch(tickets(repository("shop"), 101, 102, 103));
    await until(() => numbers().length === 1, "the first ticket to start");
    await until(analysed(queued), "the analysis to fail");
    expect(numbers()).toEqual([101]);
    expect(waiting(102)).toMatchObject({ reason: "conflict", cause: "analysis_failed", analysisFailure: "output file missing" });
    expect(waiting(103)?.detail).toContain("output file missing");
    finish(101);
    await until(() => numbers().length === 2, "the second ticket to start");
    expect(numbers()).toEqual([101, 102]);
    expect(waiting(103)).toMatchObject({ reason: "conflict", cause: "analysis_failed" });
  });

  it("should fall back the same way on a file the contract refuses, and on a session that never answers", async () => {
    fixture({ mode: "invalid" });
    const refused = harness();
    await refused.registry.enqueueBatch(tickets(repository("shop"), 101, 102));
    await until(() => refused.numbers().length === 1, "the first ticket to start");
    expect(refused.waiting(102)?.analysisFailure).toMatch(/output refused, the tickets or edges array is missing/);

    fixture({ mode: "hang" });
    const hanging = harness();
    await hanging.registry.enqueueBatch(tickets(repository("shop"), 101, 102));
    expect(hanging.queued().map((entry) => entry.reason)).toEqual(["analysis", "analysis"]);
    await until(() => hanging.numbers().length === 1, "the timeout");
    expect(hanging.waiting(102)?.analysisFailure).toMatch(/timeout of 2 s exceeded/);
  });

  /** Ticket 101 as a batch whose analysis wrote no file left it: failed, run alone, its merge request open, the rest of the batch removed. */
  async function failedAndAwaitingMerge(shop: string) {
    fixture({ mode: "fail" });
    const context = harness();
    await context.registry.enqueueBatch(tickets(shop, 101, 102, 103));
    await until(() => context.numbers().length === 1, "the first ticket to start");
    await until(analysed(context.queued), "the analysis to fail");
    for (const entry of context.queued()) context.registry.cancelQueued(entry.id);
    // The merge watcher asks at once about a watch something waits for. GitLab answers that the
    // merge request is still open, so the wait reads the same however fast that answer comes.
    mkdirSync(glabDirectory, { recursive: true });
    writeFileSync(path.join(glabDirectory, "merge-request-12"), "opened");
    context.finish(101, 12);
    await until(() => context.internals.watches.length === 1, "the merge request to be watched");
    return context;
  }
  const stored = (registry: Registry, iid: number) => (registry as unknown as { tickets: ScheduledTicket[] }).tickets.find((ticket) => ticket.issueUrl === url(iid));

  it("should predict again a ticket whose analysis failed when a later batch of its repository is analysed", async () => {
    const shop = repository("shop");
    const { registry, numbers, queued } = await failedAndAwaitingMerge(shop);
    expect(stored(registry, 101)).toMatchObject({ analysis: "failed", failure: "output file missing" });
    // The new analysis answers for the three tickets and links none of them.
    fixture({});
    await registry.enqueueBatch(tickets(shop, 102, 103));
    await until(() => numbers().length === 3, "the two new tickets to start");
    const call = calls()[1];
    expect(call.input.tickets).toEqual([102, 103, 101].map((iid) => ({ issue_url: url(iid) })));
    expect(call.input.known).toEqual([]);
    expect(stored(registry, 101)).toMatchObject({ analysis: "done", files: ["src/ticket-101.ts"], confidence: "high" });
    expect(stored(registry, 101)?.failure).toBeUndefined();
    expect(numbers()).toEqual([101, 102, 103]);
    expect(queued()).toEqual([]);
  });

  it("should hold a new ticket behind a ticket predicted again only when the new analysis links them", async () => {
    const shop = repository("shop");
    const { registry, numbers, queued, waiting, merge } = await failedAndAwaitingMerge(shop);
    fixture({ edges: [{ a: 101, b: 102, kind: "overlap", reason: "Same file." }] });
    await registry.enqueueBatch(tickets(shop, 102, 103));
    await until(analysed(queued), "the second analysis");
    await until(() => numbers().length === 2, "the free ticket to start");
    expect(numbers()).toEqual([101, 103]);
    expect(waiting(102)).toMatchObject({ reason: "merge", cause: "overlap", detail: "Same file.", blocking: { issueUrl: url(101) } });
    expect(waiting(102)?.analysisFailure).toBeUndefined();
    await merge("merged");
    await until(() => numbers().length === 3, "the held ticket to start");
  });

  it("should keep a ticket failed, with its own reason, when the analysis that predicts it again fails too", async () => {
    const shop = repository("shop");
    const { registry, numbers, queued, waiting } = await failedAndAwaitingMerge(shop);
    fixture({ mode: "invalid" });
    await registry.enqueueBatch(tickets(shop, 102, 103));
    await until(analysed(queued), "the second analysis to fail");
    expect(calls()[1].input.tickets).toEqual([102, 103, 101].map((iid) => ({ issue_url: url(iid) })));
    expect(stored(registry, 101)).toMatchObject({ analysis: "failed", failure: "output file missing" });
    expect(numbers()).toEqual([101]);
    expect(waiting(102)).toMatchObject({ reason: "merge", cause: "analysis_failed", analysisFailure: expect.stringMatching(/output refused/), detail: expect.stringMatching(/^The batch analysis failed \(output refused/) });
  });

  it("should not open an analysis for a single ticket beside a failed one, and blame the failed ticket for the wait", async () => {
    const shop = repository("shop");
    const { registry, numbers, waiting, queued } = await failedAndAwaitingMerge(shop);
    await registry.enqueueBatch(tickets(shop, 104));
    // Its blocking links are read, by the server: that is not a session.
    await until(analysed(queued), "the links to be read");
    expect(calls()).toHaveLength(1);
    expect(numbers()).toEqual([101]);
    expect(waiting(104)).toMatchObject({ reason: "merge", cause: "analysis_failed", detail: "The analysis of #101 failed (output file missing): this ticket runs after it." });
    expect(waiting(104)?.analysisFailure).toBeUndefined();
  });

  it("should run a low confidence ticket alone on its repository", async () => {
    fixture({ confidence: { 102: "low" } });
    const { registry, numbers, waiting } = harness();
    await registry.enqueueBatch(tickets(repository("shop"), 101, 102));
    await until(() => numbers().length === 1, "the first ticket to start");
    expect(waiting(102)).toMatchObject({ reason: "conflict", cause: "low_confidence", confidence: "low" });
  });

  it("should start a held ticket from the base when forced, within the run limit", async () => {
    fixture({ edges: [{ a: 101, b: 102, kind: "overlap", reason: "Same file." }, { a: 101, b: 105, kind: "overlap", reason: "Same file." }] });
    const { registry, numbers, waiting, started } = harness();
    await registry.enqueueBatch(tickets(repository("shop"), 101, 102, 103, 104, 105));
    await until(() => numbers().length === 3, "three tickets to start");
    expect(numbers()).toEqual([101, 103, 104]);
    registry.forceQueued(waiting(102)!.id, "base");
    // The three places are taken: forced or not, it waits for one.
    expect(waiting(102)).toMatchObject({ reason: "slot", forced: { mode: "base" } });
    started[1].state.status = "stopped";
    started[1].state.sessionActive = false;
    started[1].publish();
    await until(() => numbers().length === 4, "the forced ticket to start");
    expect(numbers()).toEqual([101, 103, 104, 102]);
    expect(waiting(105)?.reason).toBe("conflict");
  });

  it("should stack a held ticket on the branch of the ticket it waits for, once that branch exists", async () => {
    fixture({ edges: [{ a: 102, b: 101, kind: "depends_on", order: [101, 102], reason: "A besoin du ticket 101." }] });
    const { registry, numbers, waiting, started } = harness();
    await registry.enqueueBatch(tickets(repository("shop"), 102, 101));
    await until(() => numbers().length === 1, "the dependency to start first");
    expect(numbers()).toEqual([101]);
    expect(() => registry.forceQueued(waiting(102)!.id, "stacked")).toThrow(/branch of #101 is not known yet/);
    started[0].state.branch = "feat/101-promo";
    registry.forceQueued(waiting(102)!.id, "stacked", url(101));
    await until(() => numbers().length === 2, "the stacked ticket to start");
    expect(started[1].state.baseBranch).toBe("feat/101-promo");
  });

  it("should move and remove waiting tickets", async () => {
    fixture({ mode: "hang" });
    const { registry, queued } = harness();
    await registry.enqueueBatch(tickets(repository("shop"), 101, 102, 103));
    const [first, second, third] = queued().map((entry) => entry.id);
    registry.moveQueued(third, first);
    expect(queued().map((entry) => entry.id)).toEqual([third, first, second]);
    registry.moveQueued(third, null);
    expect(queued().map((entry) => entry.id)).toEqual([first, second, third]);
    registry.cancelQueued(second);
    expect(queued().map((entry) => entry.id)).toEqual([first, third]);
    expect(() => registry.moveQueued(second, null)).toThrow(/no longer queued/);
    expect(() => registry.forceQueued(second, "base")).toThrow(/no longer queued/);
  });
});

describe("the queue across a restart", () => {
  const queueFile = () => path.join(storage, "data", "queue.json");

  it("should write the queue with its schedule, and nothing of a run that left", async () => {
    fixture({ edges: [{ a: 101, b: 102, kind: "overlap", reason: "Same file." }] });
    const shop = repository("shop");
    const { registry, numbers } = harness();
    await registry.enqueueBatch(tickets(shop, 101, 102));
    await until(() => numbers().length === 1, "the first ticket to start");
    await registry.drain();
    const stored = JSON.parse(readFileSync(queueFile(), "utf8")) as { version: number; queue: QueuedRun[]; tickets: { issueUrl: string }[]; edges: unknown[]; watches: unknown[] };
    expect(stored.version).toBe(2);
    expect(stored.queue.map((entry) => entry.issueUrl)).toEqual([url(102)]);
    expect(stored.tickets.map((ticket) => ticket.issueUrl).sort()).toEqual([url(101), url(102)]);
    expect(stored.edges).toHaveLength(1);
  });

  it("should come back holding what it held, and start a batch whose analysis was interrupted one ticket at a time", async () => {
    const shop = repository("shop");
    const entry = (iid: number, extra: Partial<QueuedRun> = {}): QueuedRun => ({ id: `q${iid}`, cwd: shop, repository: shop, issueUrl: url(iid), instruction: "", queuedAt: "2026-10-01T10:00:00.000Z", batchId: "batch-1", ...extra });
    mkdirSync(path.dirname(queueFile()), { recursive: true });
    writeFileSync(queueFile(), JSON.stringify({
      version: 2,
      queue: [entry(101), entry(102, { analysing: true }), entry(103, { analysing: true })],
      tickets: [], edges: [{ repository: shop, a: url(98), b: url(101), kind: "overlap", reason: "Same file." }],
      watches: [{ issueUrl: url(98), repository: shop, mergeRequestUrl: "https://gitlab.com/acme/shop/-/merge_requests/9", branch: "feat/98", state: "open", since: new Date().toISOString() }],
    }));
    const { registry, numbers, waiting, merge } = harness();
    await registry.restoreQueue();
    await registry.drain();
    // 101 waits for the merge it was waiting for. The interrupted batch runs alone on its
    // repository, so it waits for that merge too rather than start beside it.
    expect(numbers()).toEqual([]);
    expect(waiting(101)?.reason).toMatch(/^merge/);
    expect(waiting(102)).toMatchObject({ cause: "analysis_failed", analysisFailure: "console restarted during the analysis" });
    expect(waiting(102)?.reason).toMatch(/^merge/);
    await merge("merged");
    // One ticket at a time from here, in the order asked.
    expect(numbers()).toEqual([101]);
    expect(waiting(102)).toMatchObject({ reason: "conflict", cause: "analysis_failed" });
    expect(waiting(103)).toMatchObject({ reason: "conflict", cause: "analysis_failed" });
  });

  it("should still load the bare array written before batches existed", async () => {
    const shop = repository("shop");
    mkdirSync(path.dirname(queueFile()), { recursive: true });
    writeFileSync(queueFile(), JSON.stringify([{ id: "q1", cwd: shop, issueUrl: url(1), instruction: "", queuedAt: "2026-09-20T10:00:00.000Z" }]));
    const { registry, numbers } = harness();
    await registry.restoreQueue();
    expect(registry.snapshot().queued).toEqual([expect.objectContaining({ id: "q1", repository: shop, reason: "slot" })]);
    await registry.drain();
    expect(numbers()).toEqual([1]);
  });
});
