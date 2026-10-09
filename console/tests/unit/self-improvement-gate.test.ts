import { describe, expect, it } from "@jest/globals";
import { auditReasons, commitlessImprovementStatus, hasAuditableEvidence, improvementCause, pendingEntry, improvementReportName, improvementWorktreeInFlight, improvementWorktreeName, isImprovementWorktree, mergeNeedsRestart, withoutBundlerVariables } from "../../server/domain";

describe("autonomous audit evidence", () => {
  it("should audit a run that delegated an agent", () => {
    expect(hasAuditableEvidence({ status: "completed", agents: [{ id: "a", name: "developer", status: "completed", startedAt: "2026-09-08T08:00:00.000Z" }], artifacts: [] })).toBe(true);
  });

  it("should audit a run that produced a document", () => {
    expect(hasAuditableEvidence({ status: "completed", agents: [], artifacts: ["plan.md"] })).toBe(true);
  });

  it("should audit a run that failed, even with nothing to show", () => {
    expect(hasAuditableEvidence({ status: "failed", agents: [], artifacts: [] })).toBe(true);
  });

  it("should skip a session stopped before it did anything", () => {
    expect(hasAuditableEvidence({ status: "completed", agents: [], artifacts: [] })).toBe(false);
    expect(hasAuditableEvidence({ status: "idle", agents: [], artifacts: [] })).toBe(false);
  });
});

// The defect this guards: an improvement session opened after every ticket, and a
// session asked to find improvements in a run that went well finds some.
describe("what a run proved went wrong", () => {
  const counts = { total: 3, verified: 3, failed: 0, blocked: 0, unverified: 0, stale: 0 };
  const acceptance = { available: true, revision: 1, updatedAt: "2026-10-08T08:00:00.000Z", counts, diagnostics: 0 };
  const delivered = { status: "completed" as const, incidents: [], acceptance, reopenings: [] };

  it("should find nothing in a delivered run with every criterion verified", () => {
    expect(auditReasons(delivered, [])).toEqual([]);
  });

  it("should not count a rework round, which is the review doing its work", () => {
    expect(auditReasons(delivered, [{ metric: "rework", detail: "2 review rounds and 1 rework developer." }])).toEqual([]);
  });

  it("should name a failed run", () => {
    expect(auditReasons({ ...delivered, status: "failed" }, [])).toEqual(["The run failed."]);
  });

  it("should name the incidents by kind, each kind once", () => {
    const incident = (kind: "missing_result" | "lost_session") => ({ kind }) as NonNullable<Parameters<typeof auditReasons>[0]["incidents"]>[number];
    expect(auditReasons({ ...delivered, incidents: [incident("missing_result"), incident("missing_result"), incident("lost_session")] }, []))
      .toEqual(["3 incidents (missing_result, lost_session)."]);
  });

  it("should name the criteria left failed or blocked", () => {
    expect(auditReasons({ ...delivered, acceptance: { ...acceptance, counts: { ...counts, failed: 1, blocked: 2 } } }, []))
      .toEqual(["1 acceptance criterion failed.", "2 acceptance criteria blocked."]);
  });

  it("should ignore the counts of a run that wrote no criteria registry", () => {
    expect(auditReasons({ ...delivered, acceptance: { ...acceptance, available: false, counts: { ...counts, failed: 1 } } }, [])).toEqual([]);
  });

  it("should name a QA verdict declared over criteria QA did not observe", () => {
    expect(auditReasons({ ...delivered, acceptance: { ...acceptance, qa: { status: "PASS", consistent: false, unobserved: 2 } } }, []))
      .toEqual(["QA declared PASS over 2 criteria it did not observe."]);
    expect(auditReasons({ ...delivered, acceptance: { ...acceptance, qa: { status: "PASS", consistent: true, unobserved: 0 } } }, [])).toEqual([]);
  });

  it("should name a workflow that ended blocked, by its state or by its blockers", () => {
    const workflow = { schemaVersion: 1 as const, revision: 4, receivedAt: "2026-10-08T08:00:00.000Z" };
    expect(auditReasons({ ...delivered, workflow: { ...workflow, state: "blocked" } }, [])).toEqual(["The workflow ended blocked."]);
    expect(auditReasons({ ...delivered, workflow: { ...workflow, state: "completed", result: { delivery: "draft_merge_request", blockers: ["P0 open"] } } }, []))
      .toEqual(["The workflow ended blocked."]);
    expect(auditReasons({ ...delivered, workflow: { ...workflow, state: "completed", result: { delivery: "merge_request", blockers: [] } } }, [])).toEqual([]);
  });

  it("should name a change asked after the final report", () => {
    expect(auditReasons({ ...delivered, reopenings: [{ from: "2026-10-08T09:00:00.000Z" }] }, [])).toEqual(["1 change asked after the final report."]);
  });

  it("should carry a cost that stands out against the baseline in its own words", () => {
    expect(auditReasons(delivered, [{ metric: "tokens", detail: "9.0 M tokens, against a median of 3.0 M over 4 runs." }]))
      .toEqual(["9.0 M tokens, against a median of 3.0 M over 4 runs."]);
  });
});

describe("an entry of pending/ read from its file", () => {
  it("should read user feedback", () => {
    expect(pendingEntry({ id: "2026-10-08", runId: "run-1", status: "pending", feedback: "The plan asked the same question twice." })).toEqual({ kind: "feedback" });
  });

  it("should read a self-audit with its reasons, dropping what is not a sentence", () => {
    expect(pendingEntry({ source: "autonomous", runId: "run-1", reasons: ["The run failed.", "", 3, null] })).toEqual({ kind: "audit", runId: "run-1", reasons: ["The run failed."] });
  });

  it("should read a self-audit written before reasons existed as one that carries none", () => {
    expect(pendingEntry({ source: "autonomous", runId: "run-1", signals: {} })).toEqual({ kind: "audit", runId: "run-1", reasons: [] });
  });

  it("should refuse what is neither", () => {
    for (const value of [null, [], "text", {}, { feedback: "  " }, { source: "autonomous" }, { source: "autonomous", runId: 3 }]) expect(pendingEntry(value)).toBeUndefined();
  });
});

describe("whether an improvement session opens at the end of a run", () => {
  const quiet = { kind: "audit" as const, runId: "run-0", reasons: [] };

  it("should not open on a run that went well with nothing waiting", () => {
    expect(improvementCause("run-1", [], [])).toBeUndefined();
    expect(improvementCause("run-1", [], [quiet, { kind: "audit", runId: "run-1", reasons: [] }])).toBeUndefined();
  });

  it("should open on what the run proved", () => {
    expect(improvementCause("run-1", ["The run failed.", "1 incident (lost_session)."], [])).toBe("The run failed. 1 incident (lost_session).");
  });

  it("should open on user feedback even when the run went well", () => {
    expect(improvementCause("run-1", [], [quiet, { kind: "feedback" }, { kind: "feedback" }])).toBe("2 user feedback entries are waiting.");
  });

  it("should open on the audit of an earlier run that is still waiting with a reason", () => {
    expect(improvementCause("run-1", [], [{ kind: "audit", runId: "run-0", reasons: ["The run failed."] }])).toBe("The audit of 1 earlier run is still waiting with something to fix.");
  });

  it("should not take the entry of the run itself for an earlier one", () => {
    expect(improvementCause("run-1", [], [{ kind: "audit", runId: "run-1", reasons: ["The run failed."] }])).toBeUndefined();
  });
});

// The defect this guards: the loop opened eleven improvement branches on
// 7 September, four of them conflicting, none promoted through the console.
describe("one improvement in flight at a time", () => {
  const harness = "/Users/x/implementation-harness";

  it("should find nothing in flight when only the harness checkout is registered", () => {
    expect(improvementWorktreeInFlight([harness])).toBeUndefined();
  });

  it("should find the undecided improvement worktree", () => {
    const pending = `${harness}/.claude/worktrees/self-improvement-025063c3`;
    expect(improvementWorktreeInFlight([harness, pending])).toBe(pending);
  });

  it("should not wait on a branch the automatic merge put on hold for the user", () => {
    const held = `${harness}/.claude/worktrees/self-improvement-025063c3`;
    const next = `${harness}/.claude/worktrees/self-improvement-77aa0b1c`;
    expect(improvementWorktreeInFlight([harness, held], new Set(["self-improvement-025063c3"]))).toBeUndefined();
    expect(improvementWorktreeInFlight([harness, held, next], new Set(["self-improvement-025063c3"]))).toBe(next);
  });

  // A branch the user works on themselves is not the loop's business to wait on.
  it("should ignore a worktree that is not an improvement one", () => {
    expect(improvementWorktreeInFlight([harness, `${harness}/.claude/worktrees/feat-259-composer`])).toBeUndefined();
  });

  it("should name a worktree after the run it audits", () => {
    expect(improvementWorktreeName("2026-09-08T12-49-02-961Z-025063c3")).toBe("self-improvement-025063c3");
  });
});

// Every self-improvement worktree is a candidate for the pending-review list, whichever
// run spawned it and however long ago: this is the filter listPendingImprovements uses.
describe("recognizing an improvement worktree", () => {
  const harness = "/Users/x/implementation-harness";

  it("should recognize a worktree regardless of which run named it or how old it is", () => {
    expect(isImprovementWorktree(`${harness}/.claude/worktrees/self-improvement-025063c3`)).toBe(true);
  });

  it("should ignore a worktree the user is working on themselves", () => {
    expect(isImprovementWorktree(`${harness}/.claude/worktrees/feat-259-composer`)).toBe(false);
  });

  it("should ignore the harness checkout itself", () => {
    expect(isImprovementWorktree(harness)).toBe(false);
  });
});

describe("environment handed to the improvement agent", () => {
  it("should drop the bundler variables the console itself runs with", () => {
    const cleaned = withoutBundlerVariables({ NODE_ENV: "development", TURBOPACK: "1", __NEXT_PRIVATE_ORIGIN: "http://localhost", NEXT_DEPLOYMENT_ID: "x", PATH: "/usr/bin" });
    expect(cleaned).toEqual({ PATH: "/usr/bin" });
  });

  it("should leave the harness configuration alone", () => {
    const cleaned = withoutBundlerVariables({ IMPL_SELF_IMPROVEMENT_AUTORUN: "true", HOME: "/Users/x" });
    expect(cleaned).toEqual({ IMPL_SELF_IMPROVEMENT_AUTORUN: "true", HOME: "/Users/x" });
  });
});

// On 29 September self-improvement-4824d4ae read "déjà intégrée" from the
// moment it was opened, and still did once the agent had given up without a
// commit: nothing had been integrated, and the report saying why went unseen.
describe("reading a worktree that holds no commit ahead of the harness", () => {
  it("should call an agent that has not written its report yet analyzing", () => {
    expect(commitlessImprovementStatus({ reported: false })).toBe("analyzing");
  });

  it("should call an agent that wrote its report without a commit finished", () => {
    expect(commitlessImprovementStatus({ reported: true })).toBe("finished");
  });

  it("should name the report after the branch, without the loop's prefix", () => {
    expect(improvementReportName("self-improvement-4824d4ae")).toBe("improvement-report-4824d4ae.md");
  });
});

describe("restart after an improvement merge", () => {
  it("should ask for a restart when the merge touches the console or the launcher", () => {
    expect(mergeNeedsRestart(["commands/implement.md", "console/server/registry.ts"])).toBe(true);
    expect(mergeNeedsRestart(["bin/implementation-harness"])).toBe(true);
  });

  it("should not ask for a restart when only the plugin changed", () => {
    expect(mergeNeedsRestart(["agents/developer.md", "skills/tdd/SKILL.md", "hooks/emit.mjs"])).toBe(false);
    expect(mergeNeedsRestart([])).toBe(false);
  });
});
