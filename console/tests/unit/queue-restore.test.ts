import { describe, expect, it } from "@jest/globals";
import { describeQueue, INTERRUPTED_ANALYSIS, restoreQueueFile, startableEntries, storedQueue } from "../../server/domain";
import type { MergeWatch, QueuedRun, ScheduledTicket, ScheduleEdge } from "../../server/types";

const url = (iid: number) => `https://gitlab.com/acme/shop/-/issues/${iid}`;
const entry = (iid: number, overrides: Partial<QueuedRun> = {}): QueuedRun => ({ id: `q${iid}`, cwd: "/work/shop", repository: "/work/shop", issueUrl: url(iid), instruction: "", queuedAt: "2026-10-01T10:00:00.000Z", ...overrides });
const ticket = (iid: number): ScheduledTicket => ({ issueUrl: url(iid), repository: "/work/shop", analysis: "done", areas: ["src/checkout"], files: ["src/checkout/cart.tsx"], confidence: "high", summary: `Ticket ${iid}.` });
const edge: ScheduleEdge = { repository: "/work/shop", a: url(101), b: url(102), kind: "depends_on", order: [url(101), url(102)], reason: "Le second lit ce que le premier calcule." };
const watch: MergeWatch = { issueUrl: url(98), repository: "/work/shop", mergeRequestUrl: "https://gitlab.com/acme/shop/-/merge_requests/12", branch: "feat/98", runId: "run-98", state: "open", since: "2026-10-01T09:00:00.000Z" };

describe("the queue file read at start", () => {
  it("should still load the bare array written before batches existed", () => {
    const restored = restoreQueueFile([
      { id: "q1", cwd: "/work/shop", repository: "/work/shop", issueUrl: url(1), instruction: "desktop", queuedAt: "2026-09-20T10:00:00.000Z" },
      // Written before worktrees: the checkout is `cwd` alone.
      { id: "q2", cwd: "/work/legacy", issueUrl: url(2), instruction: "", queuedAt: "2026-09-20T10:01:00.000Z" },
      { id: "broken" }, null, "texte",
    ]);
    expect(restored.queue).toEqual([
      { id: "q1", cwd: "/work/shop", repository: "/work/shop", issueUrl: url(1), instruction: "desktop", queuedAt: "2026-09-20T10:00:00.000Z" },
      { id: "q2", cwd: "/work/legacy", repository: "/work/legacy", issueUrl: url(2), instruction: "", queuedAt: "2026-09-20T10:01:00.000Z" },
    ]);
    expect(restored).toMatchObject({ tickets: [], edges: [], watches: [] });
  });

  it("should give back the queue, the predictions, the edges and the watches it wrote", () => {
    const state = { queue: [entry(101, { batchId: "batch-1" }), entry(102, { batchId: "batch-1", forced: { mode: "stacked" as const, baseBranch: "feat/101", onto: url(101) } })], tickets: [ticket(101), ticket(102)], edges: [edge], watches: [watch] };
    const restored = restoreQueueFile(JSON.parse(JSON.stringify(storedQueue(state))));
    expect(restored).toEqual(state);
  });

  it("should bring a batch whose analysis was interrupted back as a failed analysis, one ticket at a time", () => {
    const restored = restoreQueueFile({ version: 2, queue: [entry(101, { analysing: true }), entry(102, { analysing: true }), entry(103)], tickets: [], edges: [], watches: [] });
    expect(restored.queue.some((queued) => queued.analysing)).toBe(false);
    expect(restored.tickets).toEqual([101, 102].map((iid) => ({ issueUrl: url(iid), repository: "/work/shop", analysis: "failed", areas: [], files: [], failure: INTERRUPTED_ANALYSIS })));
    const context = { tickets: restored.tickets };
    // Never silently parallel: the first one starts, the others wait behind it.
    expect(startableEntries(restored.queue, new Map(), context, 3).map((queued) => queued.id)).toEqual(["q101"]);
    expect(describeQueue(restored.queue, new Map(), context)[1]).toMatchObject({ reason: "order", cause: "analysis_failed", analysisFailure: INTERRUPTED_ANALYSIS });
  });

  it("should keep waiting for a merge request it was waiting for", () => {
    const restored = restoreQueueFile({ version: 2, queue: [entry(101)], tickets: [], edges: [{ repository: "/work/shop", a: url(98), b: url(101), kind: "overlap", reason: "Fichier commun." }], watches: [watch] });
    expect(describeQueue(restored.queue, new Map(), restored)[0]).toMatchObject({ reason: "merge", blocking: { mergeRequestUrl: watch.mergeRequestUrl, branch: "feat/98" } });
  });

  it("should drop what it cannot read rather than fail", () => {
    expect(restoreQueueFile(undefined)).toEqual({ queue: [], tickets: [], edges: [], watches: [] });
    expect(restoreQueueFile("texte")).toEqual({ queue: [], tickets: [], edges: [], watches: [] });
    const restored = restoreQueueFile({ version: 2, queue: [entry(101), { id: "sans ticket" }], tickets: [ticket(101), { issueUrl: url(102) }], edges: [edge, { a: url(1) }], watches: [watch, { issueUrl: url(3) }] });
    expect(restored.queue).toHaveLength(1);
    expect(restored.tickets).toEqual([ticket(101)]);
    expect(restored.edges).toEqual([edge]);
    expect(restored.watches).toEqual([watch]);
  });

  it("should never write the tickets of the demonstration", () => {
    const stored = storedQueue({
      queue: [entry(101), entry(1, { id: "demo", issueUrl: "ticket-simule://IH-43", demo: true })],
      tickets: [ticket(101), { ...ticket(1), issueUrl: "ticket-simule://IH-43" }],
      edges: [edge, { ...edge, a: "ticket-simule://IH-42", b: "ticket-simule://IH-43" }],
      watches: [watch, { ...watch, issueUrl: "ticket-simule://IH-42" }],
    });
    expect(stored).toEqual({ version: 2, queue: [entry(101)], tickets: [ticket(101)], edges: [edge], watches: [watch] });
  });
});
