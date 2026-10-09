import { describe, expect, it } from "@jest/globals";

import { incidentWords, renderHarness, renderQuestion, renderRun, table } from "../../cli/format";
import type { HarnessSnapshot, RunIncident, RunState, RunSummary } from "../../server/types";

const now = Date.parse("2026-10-09T08:05:00.000Z");
const issueUrl = "https://gitlab.example.com/acme/shop/-/issues/12";

function summary(extra: Partial<RunSummary> = {}): RunSummary {
  return { id: "2026-10-09T08-00-00-000Z-aaaa1111", status: "running", phase: 4, cwd: "/work/shop/.claude/worktrees/x", repository: "/work/shop", issueUrl, startedAt: "2026-10-09T08:00:00.000Z", endedAt: null, sessionActive: true, pendingQuestionCount: 0, runningAgents: 1, holdsRepository: true, takesSlot: true, ...extra };
}

function state(extra: Partial<RunState> = {}): RunState {
  return { id: "2026-10-09T08-00-00-000Z-aaaa1111", status: "running", phase: 4, cwd: "/work/shop/.claude/worktrees/x", repository: "/work/shop", issueUrl, instruction: "", startedAt: "2026-10-09T08:00:00.000Z", endedAt: null, agents: [], activities: [], messages: [], artifacts: [], sessionActive: true, ...extra };
}

const incident: RunIncident = { id: "i1", runId: "r", kind: "no_next_action", status: "open", revision: 2, detectedAt: "", updatedAt: "", fingerprint: "f", title: "Nothing in progress", reason: "The pilot handed back.", observations: [], suggestedActions: ["open_terminal", "request_continuation", "stop", "dismiss"], decisions: [] };

describe("the lists the command line prints", () => {
  it("should align columns and leave no trailing blank", () => {
    expect(table([["ID", "RUN"], ["aaaa1111", "shop #12"], ["b", ""]])).toBe("ID        RUN\naaaa1111  shop #12\nb");
  });

  it("should name a run by the end of its id, its repository and ticket, its step and how long it has run", () => {
    const snapshot: HarnessSnapshot = { runs: [summary()], queued: [], maxConcurrentRuns: 3, archived: [], proposals: [] };
    const text = renderHarness(snapshot, now);
    expect(text).toContain("Runs (1/3 slots taken)");
    expect(text).toMatch(/aaaa1111 {2}shop #12 {2}Running {2}4\/10 Plan {2}5m 00s/);
  });

  it("should say on its row that a run waits on decisions", () => {
    const snapshot: HarnessSnapshot = { runs: [summary({ status: "attention", pendingQuestionCount: 2 })], queued: [], maxConcurrentRuns: 3, archived: [], proposals: [] };
    expect(renderHarness(snapshot, now)).toContain("Your turn (2 decisions)");
  });

  it("should list the queue with what each launch waits for, and leave out the sections that are empty", () => {
    const queued = { id: "queued-bbbb2222", cwd: "/work/shop", repository: "/work/shop", issueUrl: "https://gitlab.example.com/acme/shop/-/issues/13", instruction: "", queuedAt: "", reason: "conflict" as const, blocking: { issueUrl } };
    const text = renderHarness({ runs: [], queued: [queued], maxConcurrentRuns: 3, archived: [], proposals: [] }, now);
    expect(text).toContain("No run.");
    expect(text).toMatch(/bbbb2222 {2}shop #13 {2}Waiting, conflict with #12, which is running/);
    expect(text).not.toContain("Kept worktrees");
    expect(text).not.toContain("watcher");
  });
});

describe("a decision printed on the command line", () => {
  it("should number the choices by the rank an answer picks them with", () => {
    const text = renderQuestion({ id: "q", questions: [{ question: "Which base?", header: "Base", multiSelect: false, options: [{ label: "develop", description: "The integration branch." }, { label: "main" }] }] });
    expect(text).toBe("[Base] Which base?\n     1) develop: The integration branch.\n     2) main");
  });

  it("should number the questions when there are several and say which one takes several choices", () => {
    const text = renderQuestion({ id: "q", questions: [
      { question: "Which base?", header: "Base", multiSelect: false, options: [] },
      { question: "Which checks?", header: "Checks", multiSelect: true, options: [{ label: "lint" }] },
    ] });
    expect(text).toContain("1. [Base] Which base?");
    expect(text).toContain("2. [Checks] Which checks? (several choices allowed)");
  });
});

describe("one run printed in full", () => {
  it("should give the command that answers the decision it waits on, under the name the launcher was called by", () => {
    const text = renderRun(state({ status: "attention", pendingQuestion: { id: "q", questions: [{ question: "Which base?", header: "Base", multiSelect: false, options: [] }] } }), now, "harness");
    expect(text).toContain("Status      Your turn, session open");
    expect(text).toContain("Answer: harness answer aaaa1111");
  });

  it("should give the trust command for the folder trust dialog", () => {
    const text = renderRun(state({ sessionPrompt: { id: "p", kind: "folder_trust", directory: "/work/shop/.claude/worktrees/x", since: "" } }), now, "impl");
    expect(text).toContain("may trust the directory /work/shop/.claude/worktrees/x");
    expect(text).toContain("impl trust aaaa1111 accept|refuse");
  });

  it("should offer on an incident only the actions that have an effect from a terminal", () => {
    expect(incidentWords(state({ incidents: [incident] }))).toEqual(["continue", "stop", "dismiss"]);
    expect(renderRun(state({ incidents: [incident] }), now, "impl")).toContain("impl incident aaaa1111 continue|stop|dismiss");
  });

  it("should offer only to dismiss the incident of a run whose session is gone", () => {
    expect(incidentWords(state({ sessionActive: false, status: "failed", incidents: [incident] }))).toEqual(["dismiss"]);
  });
});
