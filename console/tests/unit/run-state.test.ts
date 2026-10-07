import { describe, expect, it } from "@jest/globals";
import { acceptanceChip, activeAgents, canRemoveWorktree, elapsedLabel, evidenceCaptures, heldBySchedule, mergeRequestLabel, phaseNames, queueDragScope, queueDropTarget, queueGroups, queueMoveTarget, queueReason, queueStatus, scheduleMark, runLabel, worktreeLabel, generatedDocuments, isDemoRun, isTranscriptStalled, isWriting, noticeIsStale, pendingDecisions, runStatusBadge, sessionAlive } from "../../lib/run-state";
import { terminalExitStatus } from "../../server/domain";
import { attachmentPaths } from "../../server/acceptance";

describe("run state selectors", () => {
  it("should keep only running agents in their original order", () => {
    const agents = [
      { id: "developer", status: "completed" },
      { id: "reviewer", status: "running" },
      { id: "qa", status: "failed" },
      { id: "designer", status: "running" },
    ];
    expect(activeAgents(agents)).toEqual([
      { id: "reviewer", status: "running" },
      { id: "designer", status: "running" },
    ]);
  });

  it("should return an empty list when no agent is active", () => {
    expect(activeAgents([{ id: "developer", status: "completed" }])).toEqual([]);
  });

  it("should leave the evidence screenshots out of the document reader", () => {
    expect(generatedDocuments([
      "ticket-context.md",
      "dev-evidence-T4.json",
      "assets/t4-document-cards-rejected.png",
      "assets/T12-region-selector-open.PNG",
      "assets/design-reference.jpg",
      "notes.txt",
    ])).toEqual(["ticket-context.md", "dev-evidence-T4.json", "notes.txt"]);
  });

  it("should show every capture an evidence item names, by the rule the server copies them with", () => {
    const item = { screenshot: "assets/T1-uploading.png", attachments: ["assets/T1-after-upload.png", { path: "assets/T1-log.txt" }, "assets/T1-uploading.png", " ", 7, null] };
    expect(evidenceCaptures(item)).toEqual(["assets/T1-uploading.png", "assets/T1-after-upload.png", "assets/T1-log.txt"]);
    expect(evidenceCaptures(item)).toEqual(attachmentPaths(item));
    expect(evidenceCaptures({})).toEqual([]);
  });

  it("should recognise a demonstration run from its identifier", () => {
    expect(isDemoRun("demo-2026-09-06T08-32-38-000Z")).toBe(true);
    expect(isDemoRun("2026-09-06T08-32-38-000Z-a1b2c3d4")).toBe(false);
    expect(isDemoRun(undefined)).toBe(false);
    expect(isDemoRun(null)).toBe(false);
  });

  it("should measure an unfinished step against the current time", () => {
    const start = "2026-09-07T10:00:00.000Z";
    expect(elapsedLabel(start, undefined, Date.parse("2026-09-07T10:00:31.000Z"))).toBe("31s");
    expect(elapsedLabel(start, undefined, Date.parse("2026-09-07T10:02:05.000Z"))).toBe("2m 05s");
    expect(elapsedLabel(start, "2026-09-07T10:00:12.000Z", Date.parse("2026-09-07T11:00:00.000Z"))).toBe("12s");
  });

  it("should announce a message on the way only while the session is alive and talking", () => {
    const now = Date.parse("2026-09-08T13:52:30.000Z");
    expect(isWriting(true, now - 400, now)).toBe(true);
    // The session went quiet: what it wrote has landed, or it is waiting.
    expect(isWriting(true, now - 4_000, now)).toBe(false);
    // The workflow finished and the engine process is gone: nothing left to write.
    expect(isWriting(false, now - 400, now)).toBe(false);
    // No output has ever arrived on this page.
    expect(isWriting(true, 0, now)).toBe(false);
  });

  it("should keep the conversation usable while the engine session outlives the workflow", () => {
    // A workflow phase in progress is always a live session, session flag or not.
    expect(sessionAlive("running", false)).toBe(true);
    expect(sessionAlive("attention", undefined)).toBe(true);
    // The workflow finished, but the engine process is still up at its prompt.
    expect(sessionAlive("completed", true)).toBe(true);
    // The workflow finished and the engine process has actually exited.
    expect(sessionAlive("completed", false)).toBe(false);
    expect(sessionAlive("completed", undefined)).toBe(false);
    expect(sessionAlive("idle", undefined)).toBe(false);
  });

  it("should flag an empty conversation as stalled once the run has produced other hook-driven progress", () => {
    // Nothing has happened yet: an empty conversation is the ordinary start of a run.
    expect(isTranscriptStalled(0, 0, 0, 0)).toBe(false);
    // A phase advance, an agent, or an artifact can only exist once a hook fired.
    expect(isTranscriptStalled(0, 3, 0, 0)).toBe(true);
    expect(isTranscriptStalled(0, 0, 1, 0)).toBe(true);
    expect(isTranscriptStalled(0, 0, 0, 2)).toBe(true);
    // Once at least one message has been read, the follower is known to work.
    expect(isTranscriptStalled(1, 5, 2, 3)).toBe(false);
  });

  it("should mark an intentional terminal stop as stopped, never as completed or failed", () => {
    expect(terminalExitStatus(1, true)).toBe("stopped");
    expect(terminalExitStatus(0, true)).toBe("stopped");
    // A clean exit proves nothing: only a result the workflow reached is a completion.
    expect(terminalExitStatus(0, false)).toBe("failed");
    expect(terminalExitStatus(0, false, true)).toBe("completed");
    expect(terminalExitStatus(1, false)).toBe("failed");
  });
});

describe("the message announcing a queued launch", () => {
  it("should stand while that launch is still waiting", () => {
    expect(noticeIsStale({ queuedId: "q1" }, [{ id: "q1" }, { id: "q2" }])).toBe(false);
  });

  it("should fall as soon as that launch has left the queue, started or cancelled", () => {
    expect(noticeIsStale({ queuedId: "q1" }, [{ id: "q2" }])).toBe(true);
    expect(noticeIsStale({ queuedId: "q1" }, [])).toBe(true);
  });

  it("should leave every other message alone, however long the queue stays empty", () => {
    expect(noticeIsStale({}, [])).toBe(false);
    expect(noticeIsStale(undefined, [])).toBe(false);
  });
});

describe("the Progression badge", () => {
  const incident = (kind: "no_next_action" | "lost_session") => ({
    id: "i", runId: "r", kind, status: "open" as const, revision: 1, detectedAt: "", updatedAt: "", fingerprint: "f", title: "t", reason: "r",
    observations: [], suggestedActions: [], decisions: [],
  });

  it("should keep \"Your turn\" for a real question", () => {
    expect(runStatusBadge({ status: "attention", pendingQuestion: { id: "q", questions: [] }, incidents: [incident("no_next_action")] })).toEqual({ label: "Your turn", tone: "decision" });
  });

  it("should keep \"Your turn\" for a prompt waiting in the terminal", () => {
    expect(runStatusBadge({ status: "attention", health: { health: "waiting", wait: { reason: "permission", since: "" }, evaluatedAt: "" } })).toEqual({ label: "Your turn", tone: "decision" });
  });

  it("should say a run with no next action is blocked, without implying a question", () => {
    expect(runStatusBadge({ status: "attention", incidents: [incident("no_next_action")] })).toEqual({ label: "No next step", tone: "blocked" });
  });

  it("should read a lost session as an interruption, not as an error", () => {
    expect(runStatusBadge({ status: "failed", incidents: [incident("lost_session")] })).toEqual({ label: "Interrupted", tone: "error" });
    expect(runStatusBadge({ status: "failed" })).toEqual({ label: "Error", tone: "error" });
  });
});

describe("the acceptance chip of a run row", () => {
  const counts = { total: 5, verified: 2, failed: 1, blocked: 1, unverified: 1, stale: 0 };

  it("should show nothing without a registry of criteria", () => {
    expect(acceptanceChip(undefined)).toBeUndefined();
    expect(acceptanceChip({ ...counts, total: 0, verified: 0, failed: 0, blocked: 0, unverified: 0 })).toBeUndefined();
  });

  it("should show verified over total, coloured by the worst state left", () => {
    expect(acceptanceChip(counts)).toEqual({ label: "2/5 AC", title: "2 of 5 criteria verified · 1 failed · 1 blocked · 1 unverified", tone: "error" });
    expect(acceptanceChip({ ...counts, failed: 0, unverified: 2 })?.tone).toBe("attention");
    expect(acceptanceChip({ ...counts, verified: 5, failed: 0, blocked: 0, unverified: 0 })).toMatchObject({ label: "5/5 AC", tone: "verified" });
  });
});

describe("a session waiting on the folder trust prompt", () => {
  it("should count as one decision, like a question of the workflow", () => {
    expect(pendingDecisions({ pendingQuestionCount: 0 })).toBe(0);
    expect(pendingDecisions({ pendingQuestionCount: 0, sessionPromptId: "p1" })).toBe(1);
    expect(pendingDecisions({ pendingQuestionCount: 2 })).toBe(2);
  });

  it("should read as the user's turn, and as a stop once refused", () => {
    const prompt = { id: "p1", kind: "folder_trust" as const, directory: "/tmp/repo", since: "2026-10-03T09:00:00.000Z" };
    expect(runStatusBadge({ status: "attention", sessionPrompt: prompt })).toEqual({ label: "Your turn", tone: "decision" });
    expect(terminalExitStatus(1, true)).toBe("stopped");
    expect(runStatusBadge({ status: "stopped" })).toEqual({ label: "Stopped", tone: "stopped" });
  });
});

describe("a run working in a worktree", () => {
  const worktree = "/work/acme-dashboard/.claude/worktrees/2026-10-03T08-00-00-000Z-abcd1234";
  const run = { cwd: worktree, repository: "/work/acme-dashboard", issueUrl: "https://gitlab.com/acme/dashboard/-/issues/42" };

  it("should be named after its repository and ticket, never after the worktree directory", () => {
    expect(runLabel(run)).toBe("acme-dashboard #42");
  });

  it("should still name a run archived before worktrees after its checkout", () => {
    expect(runLabel({ cwd: "/work/legacy/", issueUrl: "https://gitlab.com/acme/legacy/-/issues/7" })).toBe("legacy #7");
  });

  it("should show where the active worktree is, from the repository", () => {
    expect(worktreeLabel({ ...run, worktree: { path: worktree, state: "active" } })).toBe(".claude/worktrees/2026-10-03T08-00-00-000Z-abcd1234");
    expect(worktreeLabel({ cwd: "/work/legacy" })).toBeUndefined();
  });

  it("should say why a worktree is kept, and that a removed one is gone", () => {
    expect(worktreeLabel({ ...run, worktree: { path: worktree, state: "kept", detail: "Worktree kept: unpushed changes" } })).toBe("Worktree kept: unpushed changes");
    expect(worktreeLabel({ ...run, worktree: { path: worktree, state: "removed" } })).toBe("Worktree removed");
  });

  it("should offer the removal only for a worktree still on disk whose session is gone", () => {
    expect(canRemoveWorktree({ status: "stopped", sessionActive: false, worktree: { path: worktree, state: "kept" } })).toBe(true);
    expect(canRemoveWorktree({ status: "completed", sessionActive: true, worktree: { path: worktree, state: "kept" } })).toBe(false);
    expect(canRemoveWorktree({ status: "running", sessionActive: true, worktree: { path: worktree, state: "active" } })).toBe(false);
    expect(canRemoveWorktree({ status: "completed", sessionActive: false, worktree: { path: worktree, state: "removed" } })).toBe(false);
    expect(canRemoveWorktree({ status: "completed", sessionActive: false })).toBe(false);
  });

  it("should tell a launch waiting on its own ticket from one waiting on a slot", () => {
    expect(queueReason({ reason: "ticket" })).toBe("ticket already running");
    expect(queueReason({ reason: "slot" })).toBe("all slots are taken");
  });
});

describe("what a queued ticket waits for", () => {
  const blocking = { issueUrl: "https://gitlab.com/acme/shop/-/issues/217", mergeRequestUrl: "https://gitlab.com/acme/shop/-/merge_requests/12", branch: "feat/217" };

  it("should name the ticket it is in conflict with while that one runs", () => {
    expect(queueStatus({ reason: "conflict", blocking })).toBe("Waiting, conflict with #217, which is running");
  });

  it("should name the merge request it waits for and the ticket behind it", () => {
    expect(queueReason({ reason: "merge", blocking })).toBe("waits for MR !12 to be merged (#217)");
    expect(queueStatus({ reason: "merge", blocking })).toBe("Waits for MR !12 to be merged (#217)");
    expect(mergeRequestLabel("ticket-simule://acme-dashboard/-/merge_requests/128")).toBe("MR !128");
  });

  it("should say so when the state of that merge request is unknown", () => {
    expect(queueStatus({ reason: "merge_unknown", blocking })).toBe("State of MR !12 unknown (#217)");
  });

  it("should call it a pull request, and number it with a hash, when the ticket is on GitHub", () => {
    const onGitHub = { issueUrl: "https://github.com/acme/shop/issues/217", mergeRequestUrl: "https://github.com/acme/shop/pull/12", branch: "feat/217" };
    expect(queueStatus({ reason: "merge", blocking: onGitHub })).toBe("Waits for PR #12 to be merged (#217)");
    expect(queueStatus({ reason: "merge_unknown", blocking: onGitHub })).toBe("State of PR #12 unknown (#217)");
    expect(phaseNames("https://github.com/acme/shop/issues/217")[7]).toBe("Open the PR");
    expect(phaseNames("https://gitlab.com/acme/shop/-/issues/217")[7]).toBe("Open the MR");
    expect(phaseNames("ticket-simule://IH-42")[7]).toBe("Open the MR");
  });

  it("should tell a dependency from a plain order among queued tickets", () => {
    expect(queueStatus({ reason: "dependency", blocking })).toBe("Depends on #217, still queued");
    expect(queueStatus({ reason: "order", blocking })).toBe("Goes after #217");
  });

  it("should say the batch is being analysed", () => {
    expect(queueStatus({ reason: "analysis" })).toBe("Analysis in progress");
  });

  it("should say a forced ticket only waits for a place, and on which branch it is stacked", () => {
    expect(queueStatus({ reason: "slot", forced: { mode: "base" } })).toBe("Forced start, as soon as a slot is free");
    expect(queueStatus({ reason: "slot", forced: { mode: "stacked", baseBranch: "feat/217", onto: blocking.issueUrl } })).toBe("Stacked start on feat/217, as soon as a slot is free");
    expect(queueStatus({ reason: "slot" })).toBe("Waiting, all slots are taken");
  });

  it("should offer an override only when the schedule is what holds the ticket", () => {
    expect(["analysis", "conflict", "merge", "merge_unknown", "dependency", "order"].every((reason) => heldBySchedule({ reason: reason as "order" }))).toBe(true);
    expect(heldBySchedule({ reason: "slot" })).toBe(false);
    expect(heldBySchedule({ reason: "ticket" })).toBe(false);
  });

  it("should mark a ticket that runs alone on its repository, and say why", () => {
    expect(scheduleMark({ analysisFailure: "5 min timeout exceeded" })).toMatchObject({ label: "Analysis failed", title: expect.stringContaining("5 min timeout exceeded") });
    expect(scheduleMark({ confidence: "low" })?.label).toBe("Unreliable prediction");
    expect(scheduleMark({ confidence: "high" })).toBeUndefined();
  });
});

describe("the queue as it is shown", () => {
  const entry = (id: string, repository: string, batchId?: string) => ({ id, cwd: repository, repository, issueUrl: `https://gitlab.com/acme/x/-/issues/${id.slice(1)}`, queuedAt: "2026-10-01T10:00:00.000Z", ...(batchId ? { batchId } : {}) });

  it("should group by batch, then by repository, in the order asked", () => {
    const groups = queueGroups([entry("q1", "/work/shop", "b1"), entry("q2", "/work/api", "b1"), entry("q3", "/work/shop", "b1"), entry("q4", "/work/shop", "b2")]);
    expect(groups.map((group) => [group.batchId, group.count])).toEqual([["b1", 3], ["b2", 1]]);
    expect(groups[0]!.repositories.map((bucket) => [bucket.name, bucket.entries.map((queued) => queued.id)])).toEqual([["shop", ["q1", "q3"]], ["api", ["q2"]]]);
  });

  it("should leave a launch made alone as a group of its own", () => {
    const groups = queueGroups([entry("q1", "/work/shop"), entry("q2", "/work/shop")]);
    expect(groups.map((group) => [group.batchId, group.count])).toEqual([[undefined, 1], [undefined, 1]]);
  });

  it("should move a row one step among the rows shown with it", () => {
    const queued = [{ id: "a1" }, { id: "b1" }, { id: "a2" }, { id: "b2" }, { id: "a3" }];
    const siblings = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];
    expect(queueMoveTarget(queued, siblings, "a2", "up")).toBe("a1");
    expect(queueMoveTarget(queued, siblings, "a1", "up")).toBeUndefined();
    // Down lands right after the next sibling: in front of whatever follows it.
    expect(queueMoveTarget(queued, siblings, "a1", "down")).toBe("b2");
    expect(queueMoveTarget(queued, siblings, "a2", "down")).toBeNull();
    expect(queueMoveTarget(queued, siblings, "a3", "down")).toBeUndefined();
  });

  it("should put a dropped row before or after the row it is dropped on", () => {
    const queued = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(queueDropTarget(queued, "d", "b", "before")).toBe("b");
    expect(queueDropTarget(queued, "a", "c", "after")).toBe("d");
    expect(queueDropTarget(queued, "a", "d", "after")).toBeNull();
    // After the row just behind the dragged one: whatever follows that row, never the dragged row itself.
    expect(queueDropTarget(queued, "b", "c", "after")).toBe("d");
  });

  it("should say nothing when a drop leaves the row where it is, or names a row that left the queue", () => {
    const queued = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(queueDropTarget(queued, "b", "b", "before")).toBeUndefined();
    expect(queueDropTarget(queued, "b", "c", "before")).toBeUndefined();
    expect(queueDropTarget(queued, "b", "a", "after")).toBeUndefined();
    expect(queueDropTarget(queued, "c", "b", "after")).toBeUndefined();
    expect(queueDropTarget(queued, "gone", "a", "before")).toBeUndefined();
    expect(queueDropTarget(queued, "a", "gone", "before")).toBeUndefined();
  });

  it("should drag a batch ticket among those of its repository, and a lone launch among the lone ones", () => {
    const scope = (batchId: string | undefined, cwd: string) => queueDragScope({ cwd, ...(batchId ? { batchId } : {}) });
    expect(scope("b1", "/work/shop")).toBe(scope("b1", "/work/shop"));
    expect(scope("b1", "/work/shop")).not.toBe(scope("b1", "/work/api"));
    expect(scope("b1", "/work/shop")).not.toBe(scope("b2", "/work/shop"));
    expect(scope(undefined, "/work/shop")).toBe(scope(undefined, "/work/api"));
    expect(scope(undefined, "/work/shop")).not.toBe(scope("b1", "/work/shop"));
  });
});
