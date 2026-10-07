import { describe, expect, it } from "@jest/globals";
import { conflictingEntries, describeQueue, heldWatches, pruneSchedule, runLockKey, sessionsToReleaseForQueue, startableEntries, type ScheduleContext, type ScheduleRun } from "../../server/domain";
import type { MergeWatch, QueuedRun, ScheduledTicket, ScheduleEdge } from "../../server/types";
import { overridden, type Overrides } from "./overrides";

// Invented tickets of two invented repositories.
const SHOP = "/work/shop";
const API = "/work/api";
const url = (iid: number) => `https://gitlab.com/acme/shop/-/issues/${iid}`;

function queued(iid: number, overrides: Partial<QueuedRun> = {}): QueuedRun {
  const repository = overrides.repository ?? SHOP;
  return { id: `q${iid}${repository === SHOP ? "" : "-api"}`, cwd: repository, repository, issueUrl: url(iid), instruction: "", queuedAt: "2026-10-01T10:00:00.000Z", batchId: "batch-1", ...overrides };
}
function running(iid: number, overrides: Partial<ScheduleRun> = {}): ScheduleRun {
  return { id: `run-${iid}`, cwd: `${SHOP}/.claude/worktrees/run-${iid}`, repository: SHOP, issueUrl: url(iid), status: "running", ...overrides };
}
const overlap = (a: number, b: number, repository = SHOP): ScheduleEdge => ({ repository, a: url(a), b: url(b), kind: "overlap", reason: `Tickets ${a} and ${b} change the same file.` });
const dependsOn = (first: number, second: number): ScheduleEdge => ({ repository: SHOP, a: url(second), b: url(first), kind: "depends_on", order: [url(first), url(second)], reason: `Le ticket ${second} a besoin du ticket ${first}.` });
const predicted = (iid: number, overrides: Overrides<ScheduledTicket> = {}) => overridden<ScheduledTicket>({ issueUrl: url(iid), repository: SHOP, analysis: "done", areas: [], files: [], confidence: "high", summary: `Ticket ${iid}.` }, overrides);
const watch = (iid: number, overrides: Partial<MergeWatch> = {}): MergeWatch => ({ issueUrl: url(iid), repository: SHOP, mergeRequestUrl: `https://gitlab.com/acme/shop/-/merge_requests/${iid - 100}`, branch: `feat/${iid}`, runId: `run-${iid}`, state: "open", since: "2026-10-01T10:00:00.000Z", ...overrides });
const holdersOf = (runs: ScheduleRun[]) => new Map(runs.map((run) => [runLockKey(run), run.id]));

const start = (queue: QueuedRun[], context: ScheduleContext = {}, free = 3) => startableEntries(queue, holdersOf(context.runs ?? []), context, free).map((entry) => entry.id);
const view = (queue: QueuedRun[], context: ScheduleContext, id: string) => describeQueue(queue, holdersOf(context.runs ?? []), context).find((entry) => entry.id === id)!;

describe("the entries that start", () => {
  it("should start everything in the order asked when nothing conflicts", () => {
    expect(start([queued(101), queued(102), queued(103)])).toEqual(["q101", "q102", "q103"]);
  });

  it("should stop at the number of free slots", () => {
    expect(start([queued(101), queued(102), queued(103)], {}, 2)).toEqual(["q101", "q102"]);
    expect(start([queued(101)], {}, 0)).toEqual([]);
  });

  it("should hold a ticket that overlaps a running one, and say which and why", () => {
    const context = { runs: [running(98)], edges: [overlap(98, 101)] };
    expect(start([queued(101)], context)).toEqual([]);
    expect(view([queued(101)], context, "q101")).toMatchObject({ reason: "conflict", blockedBy: "run-98", cause: "overlap", detail: "Tickets 98 and 101 change the same file.", blocking: { issueUrl: url(98), runId: "run-98" } });
  });

  it("should let later tickets that conflict with nothing pass a held one, which takes no slot", () => {
    const context = { runs: [running(98)], edges: [overlap(98, 101)] };
    expect(start([queued(101), queued(102), queued(103)], context, 2)).toEqual(["q102", "q103"]);
  });

  it("should start only the first of two overlapping tickets, in the order asked", () => {
    const context = { edges: [overlap(101, 102)] };
    expect(start([queued(101), queued(102), queued(103)], context)).toEqual(["q101", "q103"]);
    expect(start([queued(102), queued(101), queued(103)], context)).toEqual(["q102", "q103"]);
    expect(view([queued(101), queued(102)], context, "q102")).toMatchObject({ reason: "order", cause: "overlap", blocking: { issueUrl: url(101), queuedId: "q101" } });
  });

  it("should start a dependency before the ticket that needs it, whatever the order asked", () => {
    const context = { edges: [dependsOn(102, 101)] };
    expect(start([queued(101), queued(102)], context)).toEqual(["q102"]);
    expect(view([queued(101), queued(102)], context, "q101")).toMatchObject({ reason: "dependency", cause: "depends_on", blocking: { issueUrl: url(102) } });
    // The queue is still described in the order asked.
    expect(describeQueue([queued(101), queued(102)], new Map(), context).map((entry) => entry.id)).toEqual(["q101", "q102"]);
  });

  it("should keep the dependent ticket waiting until the merge request of the other is merged", () => {
    const edges = [dependsOn(102, 101)];
    expect(start([queued(101)], { edges, runs: [running(102)] })).toEqual([]);
    expect(start([queued(101)], { edges, watches: [watch(102)] })).toEqual([]);
    expect(view([queued(101)], { edges, watches: [watch(102)] }, "q101")).toMatchObject({ reason: "merge", cause: "depends_on", blocking: { issueUrl: url(102), mergeRequestUrl: "https://gitlab.com/acme/shop/-/merge_requests/2", branch: "feat/102" } });
    // Merged: the watch is gone and so is the hold.
    expect(start([queued(101)], { edges })).toEqual(["q101"]);
  });

  it("should not deadlock on a dependency that crosses an overlap", () => {
    // 101 needs 103, 102 overlaps both: one of them always starts.
    const context = { edges: [dependsOn(103, 101), overlap(101, 102), overlap(102, 103)] };
    expect(start([queued(101), queued(102), queued(103)], context)).toEqual(["q102"]);
    expect(start([queued(101), queued(103)], context)).toEqual(["q103"]);
  });

  it("should fall back on the order asked when dependencies form a cycle", () => {
    const cycle: ScheduleEdge[] = [dependsOn(102, 101), dependsOn(103, 102), dependsOn(101, 103)];
    expect(start([queued(101), queued(102), queued(103)], { edges: cycle })).toHaveLength(1);
  });

  it("should never hold a ticket for a ticket of another repository, whatever the edges say", () => {
    const other = queued(101, { repository: API, cwd: API });
    // An edge the agent should never have written, and a low ticket next door.
    const context = { runs: [running(101)], edges: [overlap(101, 101), overlap(101, 102), { ...overlap(101, 102), repository: API }], tickets: [predicted(102, { confidence: "low" })] };
    expect(start([other, queued(103, { repository: API, cwd: API })], context)).toEqual(["q101-api", "q103-api"]);
  });

  it("should wait for the merge of a finished run, and say when its state is unknown", () => {
    const context = { edges: [overlap(98, 101)], watches: [watch(98)] };
    expect(start([queued(101)], context)).toEqual([]);
    expect(view([queued(101)], context, "q101")).toMatchObject({ reason: "merge", blocking: { issueUrl: url(98) } });
    const unknown = { ...context, watches: [watch(98, { state: "unknown" })] };
    expect(start([queued(101)], unknown)).toEqual([]);
    expect(view([queued(101)], unknown, "q101").reason).toBe("merge_unknown");
  });

  it("should start a forced ticket whatever the edges say, within the slots and the ticket lock", () => {
    const context = { runs: [running(98)], edges: [overlap(98, 101)] };
    const forced = queued(101, { forced: { mode: "base" } });
    expect(start([forced], context)).toEqual(["q101"]);
    expect(start([forced], context, 0)).toEqual([]);
    const stacked = queued(98, { id: "again", forced: { mode: "stacked", baseBranch: "feat/98", onto: url(98) } });
    expect(start([stacked], context)).toEqual([]);
    expect(view([stacked], context, "again")).toMatchObject({ reason: "ticket", blockedBy: "run-98" });
  });

  it("should start a forced dependent ticket without moving its dependency ahead of it", () => {
    const context = { edges: [dependsOn(102, 101)] };
    expect(start([queued(101, { forced: { mode: "base" } }), queued(102)], context, 1)).toEqual(["q101"]);
  });

  it("should hold a ticket whose batch is still being analysed, and nothing behind it", () => {
    expect(start([queued(101, { analysing: true }), queued(102)])).toEqual(["q102"]);
    expect(view([queued(101, { analysing: true })], {}, "q101").reason).toBe("analysis");
  });

  it("should run a low confidence ticket alone on its repository", () => {
    const tickets = [predicted(101), predicted(102, { confidence: "low", summary: "Nothing to search for in this ticket." }), predicted(103)];
    // 103 conflicts with 102 like every ticket of the repository, so it keeps its place behind it.
    expect(start([queued(101), queued(102), queued(103)], { tickets })).toEqual(["q101"]);
    // Moved to the end of the queue, the vague ticket lets the others go first.
    expect(start([queued(101), queued(103), queued(102)], { tickets })).toEqual(["q101", "q103"]);
    expect(view([queued(101), queued(102)], { tickets }, "q102")).toMatchObject({ reason: "order", cause: "low_confidence", confidence: "low", detail: expect.stringContaining("Nothing to search for in this ticket.") });
    // Alone means against what runs and what awaits its merge too.
    expect(start([queued(102)], { tickets, runs: [running(98)] })).toEqual([]);
    expect(start([queued(102)], { tickets, watches: [watch(98)] })).toEqual([]);
    expect(start([queued(102)], { tickets })).toEqual(["q102"]);
    // And a later ticket of the repository waits behind it.
    expect(start([queued(102), queued(103)], { tickets })).toEqual(["q102"]);
    // A ticket of another repository is not concerned.
    expect(start([queued(102), queued(101, { repository: API, cwd: API })], { tickets })).toEqual(["q102", "q101-api"]);
  });

  it("should run the tickets of a failed analysis one at a time, with the reason", () => {
    const tickets = [101, 102, 103].map((iid) => predicted(iid, { analysis: "failed", confidence: undefined, summary: undefined, failure: "5 min timeout exceeded" }));
    const queue = [queued(101), queued(102), queued(103)];
    expect(start(queue, { tickets })).toEqual(["q101"]);
    expect(view(queue, { tickets }, "q102")).toMatchObject({ reason: "order", cause: "analysis_failed", analysisFailure: "5 min timeout exceeded", detail: expect.stringContaining("5 min timeout exceeded"), blocking: { issueUrl: url(101) } });
    expect(start(queue.slice(1), { tickets, runs: [running(101)] })).toEqual([]);
    expect(view(queue.slice(1), { tickets, runs: [running(101)] }, "q102")).toMatchObject({ reason: "conflict", cause: "analysis_failed", blockedBy: "run-101" });
    expect(start(queue.slice(1), { tickets, watches: [watch(101)] })).toEqual([]);
    expect(start(queue.slice(1), { tickets })).toEqual(["q102"]);
  });

  it("should blame the ticket whose analysis failed, not the ticket that waits for it", () => {
    const failed = { analysis: "failed" as const, confidence: undefined, summary: undefined, failure: "output file missing" };
    const tickets = [predicted(101, failed), predicted(102), predicted(103, { ...failed, failure: undefined })];
    const other = "The analysis of #101 failed (output file missing): this ticket runs after it.";
    // 102 was predicted: behind 101 in the queue, running or awaiting its merge, the failure it names is 101's.
    const behind = view([queued(101), queued(102)], { tickets }, "q102");
    expect(behind).toMatchObject({ reason: "order", cause: "analysis_failed", detail: other });
    expect(behind.analysisFailure).toBeUndefined();
    expect(view([queued(102)], { tickets, runs: [running(101)] }, "q102")).toMatchObject({ reason: "conflict", detail: other });
    expect(view([queued(102)], { tickets, watches: [watch(101)] }, "q102")).toMatchObject({ reason: "merge", detail: other });
    // A ticket with no prediction of its own, launched alone, is told the same.
    expect(view([queued(104)], { tickets, watches: [watch(101)] }, "q104").detail).toBe(other);
    // Without a recorded reason the sentence has no parenthesis.
    expect(view([queued(103), queued(102)], { tickets }, "q102").detail).toBe("The analysis of #103 failed: this ticket runs after it.");
    // The ticket whose own analysis failed keeps the sentence about its batch, whatever the other ticket is.
    expect(view([queued(102), queued(101)], { tickets }, "q101").detail).toBe("The batch analysis failed (output file missing): the tickets of this repository run one at a time.");
    expect(view([queued(101), queued(103)], { tickets }, "q103").detail).toBe("The batch analysis failed: the tickets of this repository run one at a time.");
  });

  it("should say whose prediction is vague, the waiting ticket's or the other one's", () => {
    const tickets = [predicted(101), predicted(102, { confidence: "low", summary: "Nothing to search for in this ticket." }), predicted(103, { confidence: "low", summary: undefined })];
    expect(view([queued(101), queued(102)], { tickets }, "q102").detail).toBe("Unreliable prediction for this ticket: it runs alone on its repository. Nothing to search for in this ticket.");
    expect(view([queued(102), queued(101)], { tickets }, "q101")).toMatchObject({ reason: "order", cause: "low_confidence", detail: "Unreliable prediction for #102: this ticket runs after it. #102: Nothing to search for in this ticket." });
    expect(view([queued(101)], { tickets, watches: [watch(103)] }, "q101").detail).toBe("Unreliable prediction for #103: this ticket runs after it.");
    // A failed analysis on either side is said before a vague prediction.
    const mixed = [predicted(101, { analysis: "failed", confidence: undefined, summary: undefined }), tickets[1]!];
    expect(view([queued(101), queued(102)], { tickets: mixed }, "q102")).toMatchObject({ cause: "analysis_failed", detail: "The analysis of #101 failed: this ticket runs after it." });
  });

  it("should name the run on the same ticket before anything the schedule says", () => {
    const context = { runs: [running(101), running(98)], edges: [overlap(98, 101)] };
    expect(view([queued(101)], context, "q101")).toMatchObject({ reason: "ticket", blockedBy: "run-101" });
  });

  it("should carry what the schedule says of the ticket itself", () => {
    expect(view([queued(101)], { tickets: [predicted(101, { confidence: "medium" })] }, "q101")).toMatchObject({ reason: "slot", summary: "Ticket 101.", confidence: "medium" });
  });

  it("should treat a run whose workflow is over as running no more", () => {
    const context = { runs: [running(98, { status: "completed" })], edges: [overlap(98, 101)] };
    expect(start([queued(101)], context)).toEqual(["q101"]);
  });
});

describe("what waits behind a ticket", () => {
  it("should list the queued tickets in conflict with it, forced ones aside", () => {
    const context = { edges: [overlap(98, 101), overlap(98, 102)] };
    const queue = [queued(101), queued(102, { forced: { mode: "base" } }), queued(103)];
    expect(conflictingEntries(queue, { cwd: SHOP, issueUrl: url(98) }, context).map((entry) => entry.id)).toEqual(["q101"]);
  });

  it("should keep only the merge requests something still waits for", () => {
    const context = { edges: [overlap(98, 101)], watches: [watch(98), watch(97)] };
    expect(heldWatches([queued(101)], context).map((entry) => entry.issueUrl)).toEqual([url(98)]);
    expect(heldWatches([queued(101, { forced: { mode: "base" } })], context)).toEqual([]);
    expect(heldWatches([], context)).toEqual([]);
  });

  it("should not close a finished session for an entry the schedule holds", () => {
    const idle = [1, 2, 3].map((iid) => ({ id: `run-${iid}`, cwd: SHOP, repository: SHOP, issueUrl: url(iid), status: "completed" as const, sessionActive: true }));
    const context = { edges: [overlap(1, 101)], watches: [watch(1)] };
    const waiting = describeQueue([queued(101)], new Map(idle.map((run) => [runLockKey(run), run.id])), context).filter((entry) => entry.reason === "ticket");
    expect(sessionsToReleaseForQueue(idle, waiting)).toEqual([]);
    expect(sessionsToReleaseForQueue(idle, [queued(2)])).toEqual(["run-2"]);
  });
});

describe("what the schedule keeps", () => {
  it("should forget the tickets that left the console and the edges that named them", () => {
    const live = new Set([101, 102].map((iid) => runLockKey({ cwd: SHOP, issueUrl: url(iid) })));
    const pruned = pruneSchedule([predicted(101), predicted(102), predicted(103)], [overlap(101, 102), overlap(102, 103)], live);
    expect(pruned.tickets.map((ticket) => ticket.issueUrl)).toEqual([url(101), url(102)]);
    expect(pruned.edges).toEqual([overlap(101, 102)]);
  });
});
