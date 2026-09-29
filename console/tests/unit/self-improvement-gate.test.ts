import { describe, expect, it } from "@jest/globals";
import { commitlessImprovementStatus, hasAuditableEvidence, improvementReportName, improvementWorktreeInFlight, improvementWorktreeName, isImprovementWorktree, withoutBundlerVariables } from "../../server/domain";

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
