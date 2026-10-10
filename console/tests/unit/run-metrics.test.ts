import { describe, expect, it } from "@jest/globals";

import { deliveredCodeSettled, deliveryTargetBranch, diffBases, emptyState } from "../../server/domain";
import type { SessionUsage } from "../../server/engine/types";
import { buildRunMetrics, comparableRuns, confidenceCalibration, diffFromNumstat, gateTimes, metricsBaseline, metricsFindings, trackReopening, trackTimeline, userWaitReason } from "../../server/run-metrics";
import type { RunMetrics, RunState } from "../../server/types";
import { parseWorkflowState } from "../../server/workflow-state";

const at = (minute: number, second = 0) => `2026-10-03T10:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`;

const run = (state: Partial<RunState> = {}): RunState => ({ ...emptyState(), id: "run-1", cwd: "/repo/.claude/worktrees/run-1", repository: "/repo", issueUrl: "https://gitlab.com/g/p/-/issues/1", status: "running", phase: 1, startedAt: at(0), ...state });

const session = (usage: Partial<SessionUsage> = {}): SessionUsage => ({ sessionId: "s", calls: 10, inputTokens: 20, outputTokens: 1_000, cacheReadTokens: 800_000, cacheWriteTokens: 80_000, firstContextTokens: 70_000, peakContextTokens: 120_000, model: "claude-opus-5-5", ...usage });

describe("the timeline of a run", () => {
  it("should open a wait when a question is pending and close it once the run goes on", () => {
    const state = run();
    trackTimeline(state, at(0));
    state.status = "attention";
    state.pendingQuestion = { id: "q", questions: [] };
    expect(trackTimeline(state, at(2))).toBe(true);
    expect(trackTimeline(state, at(3))).toBe(false);
    state.status = "running";
    state.pendingQuestion = undefined;
    trackTimeline(state, at(5));
    expect(state.userWaits).toEqual([{ reason: "question", from: at(2), to: at(5) }]);
  });

  it("should tell a question, the agent's own prompt and a wait in the terminal apart", () => {
    expect(userWaitReason({ status: "starting", sessionPrompt: { id: "p", kind: "folder_trust", directory: "/repo", since: at(0) } })).toBe("session_prompt");
    expect(userWaitReason({ status: "attention", pendingQuestion: { id: "q", questions: [] } })).toBe("question");
    expect(userWaitReason({ status: "attention" })).toBe("terminal");
    expect(userWaitReason({ status: "running" })).toBeUndefined();
  });

  it("should close a wait and open another when its reason changes", () => {
    const state = run({ status: "attention" });
    trackTimeline(state, at(1));
    state.pendingQuestion = { id: "q", questions: [] };
    trackTimeline(state, at(2));
    expect(state.userWaits).toEqual([{ reason: "terminal", from: at(1), to: at(2) }, { reason: "question", from: at(2) }]);
  });

  it("should record the first time each phase is reached, and only the first", () => {
    const state = run();
    trackTimeline(state, at(0));
    state.phase = 5;
    trackTimeline(state, at(4));
    trackTimeline(state, at(6));
    expect(state.phaseArrivals).toEqual({ 1: at(0), 5: at(4) });
  });
});

describe("the figures of a run", () => {
  it("should take the waits on the user out of the active time and time each phase", () => {
    const metrics = buildRunMetrics({
      state: run({ status: "completed", phase: 10, endedAt: at(20), userWaits: [{ reason: "question", from: at(2), to: at(7) }, { reason: "question", from: at(9), to: at(10) }], phaseArrivals: { 1: at(0), 5: at(8), 10: at(20) } }),
      usage: [], at: at(30),
    });
    expect(metrics.time).toMatchObject({ elapsedMs: 20 * 60_000, userWaitMs: 6 * 60_000, activeMs: 14 * 60_000, waits: [{ reason: "question", count: 2, ms: 6 * 60_000 }] });
    expect(metrics.time.phases).toEqual([{ phase: 1, enteredAt: at(0), ms: 8 * 60_000 }, { phase: 5, enteredAt: at(8), ms: 12 * 60_000 }, { phase: 10, enteredAt: at(20), ms: 0 }]);
    expect(metrics.outcome.questions).toBe(2);
  });

  it("should measure a run still going up to now, an open wait included", () => {
    const metrics = buildRunMetrics({ state: run({ status: "attention", sessionActive: true, userWaits: [{ reason: "terminal", from: at(4) }] }), usage: [], at: at(10) });
    expect(metrics.final).toBe(false);
    expect(metrics.time).toMatchObject({ elapsedMs: 10 * 60_000, userWaitMs: 6 * 60_000 });
  });

  it("should stop a wait the idle session raised after the workflow ended at the end of the run", () => {
    const metrics = buildRunMetrics({ state: run({ status: "completed", endedAt: at(10), userWaits: [{ reason: "question", from: at(12), to: at(40) }] }), usage: [], at: at(50) });
    expect(metrics.time.userWaitMs).toBe(0);
  });

  it("should split the tokens between the pilot and each agent, and name the agent as the run knows it", () => {
    const metrics = buildRunMetrics({
      state: run({ agents: [{ id: "a1", name: "implementation-factory:developer", status: "completed", startedAt: at(1), endedAt: at(4) }] }),
      usage: [session(), session({ agentId: "a1", agentType: "implementation-factory:developer", calls: 4, inputTokens: 0, outputTokens: 119_000, cacheReadTokens: 0, cacheWriteTokens: 0 })],
      at: at(5),
    });
    expect(metrics.tokens?.pilot).toMatchObject({ total: 881_020, calls: 10, firstContext: 70_000, peakContext: 120_000 });
    expect(metrics.tokens?.agents).toEqual([expect.objectContaining({ agentId: "a1", name: "developer", total: 119_000, activeMs: 3 * 60_000 })]);
    expect(metrics.tokens?.total.total).toBe(1_000_020);
    expect(metrics.tokens?.pilotShare).toBeCloseTo(0.881, 3);
  });

  it("should leave the tokens out when no transcript could be read", () => {
    expect(buildRunMetrics({ state: run(), usage: [], at: at(1) }).tokens).toBeUndefined();
  });

  it("should carry the predicted size, the review tier and the real diff side by side", () => {
    const metrics = buildRunMetrics({
      state: run({ reviewTier: 1, planTasks: [{ id: "T1", title: "a", complexity: "S", status: "done" }, { id: "T2", title: "b", complexity: "m", status: "done" }, { id: "T3", title: "c", status: "done" }] }),
      usage: [], diff: { files: 3, insertions: 40, deletions: 5 }, at: at(1),
    });
    expect(metrics.complexity).toEqual({ tasks: 3, sizes: { S: 1, M: 1, L: 0 }, criteria: 0, reviewTier: 1, diff: { files: 3, insertions: 40, deletions: 5 } });
  });

  it("should count the launches by agent type and the developers sent to correct", () => {
    const agent = (id: string, name: string, status: "completed" | "abandoned" = "completed") => ({ id, name, status, startedAt: at(1), endedAt: at(2) });
    const metrics = buildRunMetrics({
      state: run({ agents: [agent("a", "implementation-factory:senior-reviewer"), agent("b", "senior-reviewer"), agent("c", "developer", "abandoned")], artifacts: ["developer-report-T1.md", "developer-report-rework1.md"] }),
      usage: [], at: at(3),
    });
    expect(metrics.rework).toEqual({ launches: { "senior-reviewer": 2, developer: 1 }, reworkDevelopers: 1, lostAgents: 1 });
  });

  it("should read the delivery the workflow declared, and fall back on the merge request it saw", () => {
    const workflow = { schemaVersion: 1 as const, revision: 3, state: "completed" as const, receivedAt: at(9), result: { delivery: "draft_merge_request" as const, blockers: ["P0 ouvert"] } };
    expect(buildRunMetrics({ state: run({ workflow, mergeRequestUrl: "https://gitlab.com/g/p/-/merge_requests/2" }), usage: [], at: at(9) }).outcome.delivery).toBe("draft_merge_request");
    expect(buildRunMetrics({ state: run({ mergeRequestUrl: "https://gitlab.com/g/p/-/merge_requests/2" }), usage: [], at: at(9) }).outcome.delivery).toBe("merge_request");
    expect(buildRunMetrics({ state: run(), usage: [], at: at(9) }).outcome.delivery).toBe("none");
  });

  it("should count the time under an incident up to its resolution", () => {
    const incident = { id: "i", runId: "run-1", kind: "no_next_action" as const, status: "resolved" as const, revision: 2, detectedAt: at(3), updatedAt: at(8), fingerprint: "f", title: "t", reason: "r", observations: [], suggestedActions: [], decisions: [], resolution: { at: at(8), outcome: "repris" } };
    const metrics = buildRunMetrics({ state: run({ incidents: [incident] }), usage: [], at: at(10) });
    expect(metrics.time.incidentMs).toBe(5 * 60_000);
    expect(metrics.outcome.incidents).toEqual(["no_next_action"]);
  });
});

describe("the time spent in the stop gate", () => {
  const line = (entry: object) => JSON.stringify({ at: at(1), agent: "developer", agentId: "a1", retry: false, files: [], ...entry });

  it("should add up the checks per step, the longest first", () => {
    const log = [
      line({ step: "lint", result: "pass", ms: 4_000 }), line({ step: "type-check", result: "pass", ms: 30_000 }),
      line({ step: "type-check", result: "fail", ms: 50_000 }), line({ step: "related tests", result: "skipped", ms: 9_000 }),
    ].join("\n");
    expect(gateTimes(`${log}\n`)).toEqual({ ms: 93_000, steps: [{ step: "type-check", runs: 2, ms: 80_000 }, { step: "related tests", runs: 1, ms: 9_000 }, { step: "lint", runs: 1, ms: 4_000 }] });
  });

  it("should count nothing for a line without a duration or that cannot be read", () => {
    const log = [line({ step: "no edited file recorded", result: "none" }), "{ cut short", line({ step: "lint", result: "pass", ms: "12" }), line({ step: "lint", result: "pass", ms: 1_500 })].join("\n");
    expect(gateTimes(log)).toEqual({ ms: 1_500, steps: [{ step: "lint", runs: 1, ms: 1_500 }] });
  });

  it("should say nothing when no check was timed", () => {
    expect(gateTimes("")).toBeUndefined();
    expect(gateTimes(line({ step: "lint", result: "pass" }))).toBeUndefined();
  });

  it("should put the gate under the time of the run only when there is one", () => {
    const gate = { ms: 1_500, steps: [{ step: "lint", runs: 1, ms: 1_500 }] };
    expect(buildRunMetrics({ state: run(), usage: [], gate, at: at(10) }).time.gate).toEqual(gate);
    expect(buildRunMetrics({ state: run(), usage: [], at: at(10) }).time).not.toHaveProperty("gate");
  });
});

describe("the size of a change", () => {
  it("should add up the lines of every file and count a binary file for none", () => {
    expect(diffFromNumstat("12\t3\tsrc/a.ts\n-\t-\tpublic/logo.png\n0\t7\tsrc/b.ts\n")).toEqual({ files: 3, insertions: 12, deletions: 10 });
  });

  it("should report an empty change for no output", () => {
    expect(diffFromNumstat("")).toEqual({ files: 0, insertions: 0, deletions: 0 });
  });

  it("should measure from the branch the merge request targets before the commit the run was launched at", () => {
    expect(diffBases({ baseCommit: "a50714c" }, "umbrella-178")).toEqual(["origin/umbrella-178", "umbrella-178", "a50714c"]);
    expect(diffBases({ baseBranch: "feat-101", baseCommit: "a50714c" }, "feat-101")).toEqual(["origin/feat-101", "feat-101", "feat-101", "a50714c"]);
  });

  it("should fall back on the stacked branch, then the launch commit, while no target is known", () => {
    expect(diffBases({ baseBranch: "feat-101", baseCommit: "a50714c" })).toEqual(["feat-101", "a50714c"]);
    expect(diffBases({})).toEqual([]);
  });

  it("should read the target branch of a merge request and of a pull request", () => {
    expect(deliveryTargetBranch("gitlab", { iid: 209, target_branch: "umbrella-178" })).toBe("umbrella-178");
    expect(deliveryTargetBranch("github", { number: 12, base: { ref: "main" } })).toBe("main");
    expect(deliveryTargetBranch("gitlab", { base: { ref: "main" } })).toBeUndefined();
    expect(deliveryTargetBranch("github", { target_branch: " " })).toBeUndefined();
    expect(deliveryTargetBranch("gitlab", null)).toBeUndefined();
  });
});

describe("a change asked after the final report", () => {
  const declared = (revision: number, state: string, extra: object = {}) => {
    const reading = parseWorkflowState(JSON.stringify({ schemaVersion: 1, revision, state, ...extra }), at(0));
    if (!("state" in reading)) throw new Error(reading.error);
    return reading.state;
  };
  const delivered = (revision: number) => declared(revision, "completed", { result: { delivery: "merge_request", mergeRequestUrl: "https://gitlab.com/g/p/-/merge_requests/1" } });

  it("should open a reopening when the ended workflow goes back to work, and close it on the next holding end", () => {
    const state = run({ status: "completed", endedAt: at(10) });
    expect(trackReopening(state, delivered(8), declared(9, "working", { step: "5" }), at(30))).toBe(true);
    expect(trackReopening(state, declared(9, "working"), declared(10, "waiting"), at(32))).toBe(false);
    expect(trackReopening(state, declared(10, "waiting"), delivered(11), at(45))).toBe(true);
    expect(state.reopenings).toEqual([{ from: at(30), to: at(45) }]);
  });

  it("should open nothing while the run has not ended, nor when the end was never declared", () => {
    expect(trackReopening(run(), delivered(8), declared(9, "working"), at(5))).toBe(false);
    const closedOnPhase = run({ status: "completed", endedAt: at(10) });
    expect(trackReopening(closedOnPhase, declared(3, "working"), declared(4, "working"), at(12))).toBe(false);
    expect(closedOnPhase.reopenings).toBeUndefined();
  });

  it("should keep a reopening open on an end that does not hold", () => {
    const state = run({ status: "completed", endedAt: at(10), reopenings: [{ from: at(30) }] });
    expect(trackReopening(state, declared(9, "working"), declared(10, "completed"), at(40))).toBe(false);
    expect(state.reopenings).toEqual([{ from: at(30) }]);
  });

  it("should time the first pass and the reopening, never the idle session between them", () => {
    const metrics = buildRunMetrics({
      state: run({
        status: "completed", phase: 10, endedAt: at(20), phaseArrivals: { 1: at(0), 10: at(20) }, reopenings: [{ from: at(40), to: at(50) }],
        userWaits: [{ reason: "terminal", from: at(25), to: at(40) }, { reason: "question", from: at(42), to: at(44) }],
      }),
      usage: [], at: at(59),
    });
    expect(metrics.time).toMatchObject({ endedAt: at(50), elapsedMs: 30 * 60_000, reopened: { count: 1, ms: 10 * 60_000 }, userWaitMs: 2 * 60_000, activeMs: 28 * 60_000 });
    expect(metrics.time.phases).toEqual([{ phase: 1, enteredAt: at(0), ms: 20 * 60_000 }, { phase: 10, enteredAt: at(20), ms: 0 }]);
  });

  it("should measure a reopening still going up to now", () => {
    const metrics = buildRunMetrics({ state: run({ status: "completed", sessionActive: true, endedAt: at(20), reopenings: [{ from: at(40) }] }), usage: [], at: at(45) });
    expect(metrics.time).toMatchObject({ endedAt: at(45), elapsedMs: 25 * 60_000, reopened: { count: 1, ms: 5 * 60_000 } });
  });

  it("should settle the delivered code once the archive is synced, and again only after a reopening's own sync", () => {
    expect(deliveredCodeSettled({ status: "running", archiveSyncedAt: at(10) })).toBe(false);
    expect(deliveredCodeSettled({ status: "completed" })).toBe(false);
    expect(deliveredCodeSettled({ status: "completed", archiveSyncedAt: at(10) })).toBe(true);
    expect(deliveredCodeSettled({ status: "completed", archiveSyncedAt: at(10), reopenings: [{ from: at(30) }] })).toBe(false);
    expect(deliveredCodeSettled({ status: "completed", archiveSyncedAt: at(10), reopenings: [{ from: at(30), to: at(45) }] })).toBe(false);
    expect(deliveredCodeSettled({ status: "completed", archiveSyncedAt: at(46), reopenings: [{ from: at(30), to: at(45) }] })).toBe(true);
  });

  it("should report no reopening on a run that was never reopened", () => {
    expect(buildRunMetrics({ state: run({ status: "completed", endedAt: at(20) }), usage: [], at: at(30) }).time.reopened).toBeUndefined();
  });
});

describe("the review tier the workflow declares", () => {
  const state = (extra: object) => JSON.stringify({ schemaVersion: 1, revision: 1, state: "working", ...extra });

  it("should be read when it is one of the three tiers", () => {
    expect(parseWorkflowState(state({ reviewTier: 0 }), at(0))).toMatchObject({ state: { reviewTier: 0 } });
    expect(parseWorkflowState(state({ reviewTier: 2 }), at(0))).toMatchObject({ state: { reviewTier: 2 } });
  });

  it("should be left out when it is anything else, without refusing the state", () => {
    const reading = parseWorkflowState(state({ reviewTier: "1" }), at(0));
    expect("state" in reading && reading.state.reviewTier).toBeUndefined();
  });
});

describe("a run against the others", () => {
  const measured = (runId: string, total: number, extra: Partial<RunState> = {}, status: RunState["status"] = "completed"): RunMetrics => buildRunMetrics({
    state: run({ id: runId, status, endedAt: at(10), ...extra }),
    usage: [session({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: total })], at: at(11),
  });
  const others = [measured("a", 1_000_000), measured("b", 1_200_000), measured("c", 1_100_000), measured("failed", 9_000_000, {}, "failed")];

  it("should compare to the delivered runs only, the run itself left out", () => {
    const { runs, scope } = comparableRuns(others[0]!, others);
    expect(runs.map((entry) => entry.runId)).toEqual(["b", "c"]);
    expect(scope).toBe("all delivered runs");
  });

  it("should compare within the review tier once three runs share it", () => {
    const tiered = ["x", "y", "z"].map((id) => measured(id, 2_000_000, { reviewTier: 2 }));
    const { runs, scope } = comparableRuns(measured("new", 2_000_000, { reviewTier: 2 }), [...others, ...tiered]);
    expect(runs.map((entry) => entry.runId)).toEqual(["x", "y", "z"]);
    expect(scope).toBe("review tier 2");
  });

  it("should give the medians of what it compares to", () => {
    expect(metricsBaseline(measured("new", 1), others)).toMatchObject({ runs: 3, tokens: 1_100_000, activeMs: 10 * 60_000 });
  });

  it("should point at a run well over the median and stay silent on one near it", () => {
    expect(metricsFindings(measured("new", 2_200_000), others)).toEqual([expect.objectContaining({ metric: "tokens", ratio: 2 })]);
    expect(metricsFindings(measured("new", 1_300_000), others)).toEqual([]);
  });

  it("should compare nothing below three comparable runs", () => {
    expect(metricsFindings(measured("new", 9_000_000), others.slice(0, 2))).toEqual([]);
  });

  it("should report rework without needing anyone to compare to", () => {
    const agent = (id: string) => ({ id, name: "qa-reviewer", status: "completed" as const, startedAt: at(1), endedAt: at(2) });
    expect(metricsFindings(measured("new", 1, { agents: [agent("q1"), agent("q2")] }), [])).toEqual([expect.objectContaining({ metric: "rework", value: 1 })]);
  });
});

describe("the review confidence in the figures of a run", () => {
  it("should carry the note as it stands, the one of the delivery and the feedback count", () => {
    const metrics = buildRunMetrics({ state: run({ status: "completed", endedAt: at(10), confidence: { score: 3, reasons: [] }, confidenceAtDelivery: 4, feedbackCount: 2 }), usage: [], at: at(20) });
    expect(metrics.outcome).toMatchObject({ confidence: 3, confidenceAtDelivery: 4, feedback: 2 });
  });

  it("should leave them out of a run that has none, a zero note being one", () => {
    expect(buildRunMetrics({ state: run(), usage: [], at: at(20) }).outcome).not.toHaveProperty("confidence");
    expect(buildRunMetrics({ state: run(), usage: [], at: at(20) }).outcome).not.toHaveProperty("feedback");
    expect(buildRunMetrics({ state: run({ confidence: { score: 0, reasons: [] }, confidenceAtDelivery: 0 }), usage: [], at: at(20) }).outcome).toMatchObject({ confidence: 0, confidenceAtDelivery: 0 });
  });
});

describe("the review confidence against what followed delivery", () => {
  const delivered = (id: string, score: number | undefined, after: { reopened?: boolean; feedback?: number; final?: boolean; status?: RunState["status"] } = {}): RunMetrics => {
    const metrics = buildRunMetrics({
      state: run({ id, status: after.status ?? "completed", endedAt: at(10), sessionActive: after.final === false, ...(score === undefined ? {} : { confidenceAtDelivery: score }), ...(after.feedback ? { feedbackCount: after.feedback } : {}), ...(after.reopened ? { reopenings: [{ from: at(12), to: at(15) }] } : {}) }),
      usage: [], at: at(30),
    });
    return metrics;
  };

  it("should count, per note, the delivered runs that were reopened or drew feedback", () => {
    const runs = [delivered("a", 4), delivered("b", 4, { reopened: true }), delivered("c", 4, { feedback: 1, reopened: true }), delivered("d", 0), delivered("e", 0), delivered("f", 0, { feedback: 3 })];
    expect(confidenceCalibration(runs)).toEqual([{ score: 0, runs: 3, reopened: 0, feedback: 1 }, { score: 4, runs: 3, reopened: 2, feedback: 1 }]);
  });

  it("should say nothing of a note with fewer than three delivered runs", () => {
    expect(confidenceCalibration([delivered("a", 5), delivered("b", 5)])).toEqual([]);
  });

  it("should leave out a run with no note, one that did not deliver and one whose session is still open", () => {
    const runs = [delivered("a", 3), delivered("b", 3), delivered("c", undefined), delivered("d", 3, { status: "failed" }), delivered("e", 3, { final: false })];
    expect(confidenceCalibration(runs)).toEqual([]);
    expect(confidenceCalibration([...runs, delivered("f", 3)])).toEqual([{ score: 3, runs: 3, reopened: 0, feedback: 0 }]);
  });
});
