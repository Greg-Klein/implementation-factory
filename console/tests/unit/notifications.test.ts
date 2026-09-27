import { describe, expect, it } from "@jest/globals";
import { documentTitle, faviconColor, runAlert, runAlerts } from "../../lib/notifications";
import type { RunSummary } from "../../lib/types";

function run(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "run-1", status: "running", phase: 5, cwd: "/tmp/repo", issueUrl: "",
    startedAt: "2026-09-07T10:00:00.000Z", endedAt: null,
    sessionActive: true, pendingQuestionCount: 0, runningAgents: 0, holdsRepository: true,
    ...overrides,
  };
}

const waiting = { status: "attention" as const, pendingQuestionCount: 1, pendingQuestionId: "q1" };

describe("run notifications", () => {
  it("should call back when a decision starts waiting, and name the run", () => {
    expect(runAlert(run(), run(waiting))).toEqual({
      runId: "run-1",
      tag: "question-q1",
      title: "Claude attend une réponse",
      body: "repo · le workflow attend ta décision pour continuer.",
      cue: "attention",
    });
  });

  it("should distinguish being needed from the run being over", () => {
    expect(runAlert(run(), run(waiting))?.cue).toBe("attention");
    expect(runAlert(run(), run({ status: "attention" }))?.cue).toBe("attention");
    expect(runAlert(run(), run({ status: "completed" }))?.cue).toBe("done");
    expect(runAlert(run(), run({ status: "failed" }))?.cue).toBe("done");
  });

  it("should call back when the session waits without a structured question", () => {
    expect(runAlert(run(), run({ status: "attention" }))?.title).toBe("Claude Code attend ton attention");
  });

  it("should call back when the run ends, and name the merge request when there is one", () => {
    expect(runAlert(run(), run({ status: "completed" }))?.body).toBe("Le run est allé au bout.");
    expect(runAlert(run(), run({ status: "completed", mergeRequestUrl: "https://gitlab.com/acme/-/merge_requests/1" }))?.body)
      .toBe("https://gitlab.com/acme/-/merge_requests/1");
    expect(runAlert(run(), run({ status: "failed", error: "Code 2" }))?.title).toBe("Le run a échoué · repo");
  });

  it("should stay silent on anything that is not a transition", () => {
    expect(runAlert(undefined, run(waiting))).toBeUndefined();
    expect(runAlert(run(waiting), run(waiting))).toBeUndefined();
    expect(runAlert(run({ status: "attention" }), run({ status: "attention" }))).toBeUndefined();
    expect(runAlert(run(), run())).toBeUndefined();
  });

  it("should call back once when an incident opens, not a second time for the attention that comes with it", () => {
    const incident = { id: "incident-1", kind: "no_next_action" as const, title: "Plus aucune action en cours", revision: 1 };
    const alert = runAlert(run(), run({ status: "attention", health: "stalled", incident }));
    expect(alert).toMatchObject({ tag: "incident-incident-1", title: "Plus aucune action en cours · repo", cue: "attention" });
    expect(runAlert(run({ status: "attention", incident }), run({ status: "attention", incident: { ...incident, revision: 2 } }))).toBeUndefined();
  });

  it("should voice a doubt once, and never on a run already waiting for the user", () => {
    expect(runAlert(run(), run({ health: "suspected_stall" }))?.title).toBe("Aucune progression observée · repo");
    expect(runAlert(run({ health: "suspected_stall" }), run({ health: "suspected_stall" }))).toBeUndefined();
    expect(runAlert(run({ status: "attention" }), run({ status: "attention", health: "suspected_stall" }))).toBeUndefined();
  });

  it("should announce a lost session as the failure it is, not twice", () => {
    const alert = runAlert(run(), run({ status: "failed", health: "interrupted", incident: { id: "i2", kind: "lost_session", title: "Session interrompue", revision: 1 } }));
    expect(alert?.tag).toBe("failed-run-1");
  });

  it("should stay silent when the state belongs to another run", () => {
    expect(runAlert(run({ id: "run-0" }), run({ id: "run-1", status: "completed" }))).toBeUndefined();
  });

  /**
   * The run that needs the user is rarely the one they have open, so an alert
   * raised only for the visible run left the other two silent.
   */
  it("should raise an alert for every run that changed, not only the open one", () => {
    const before = [run({ id: "a" }), run({ id: "b" }), run({ id: "c" })];
    const after = [run({ id: "a" }), run({ id: "b", ...waiting }), run({ id: "c", status: "completed" })];
    expect(runAlerts(before, after).map((alert) => alert.runId)).toEqual(["b", "c"]);
  });

  it("should stay silent for a run that appeared between the two lists", () => {
    expect(runAlerts([run({ id: "a" })], [run({ id: "a" }), run({ id: "b", ...waiting })])).toEqual([]);
  });

  it("should say in the tab what the whole console would show", () => {
    expect(documentTitle([run(waiting)])).toBe("● Claude attend une réponse · Implementation Harness");
    expect(documentTitle([run({ id: "a", ...waiting }), run({ id: "b", ...waiting })])).toBe("● 2 runs attendent une réponse · Implementation Harness");
    expect(documentTitle([run({ status: "attention" })])).toBe("● Attention requise · Implementation Harness");
    expect(documentTitle([run({ id: "a", status: "attention" }), run({ id: "b", status: "attention" })])).toBe("● Attention requise (2) · Implementation Harness");
    expect(documentTitle([run({ status: "completed" })])).toBe("✓ Terminé · Implementation Harness");
    expect(documentTitle([run({ status: "failed" })])).toBe("✗ Échec · Implementation Harness");
    expect(documentTitle([run()])).toBe("1 run en cours · Implementation Harness");
    expect(documentTitle([run({ id: "a" }), run({ id: "b" })])).toBe("2 runs en cours · Implementation Harness");
    expect(documentTitle([])).toBe("Implementation Harness");
  });

  /** The favicon speaks for the console, so the most demanding run wins. */
  it("should mark a waiting run apart from a healthy one", () => {
    expect(faviconColor([run({ status: "attention" })])).toBe("#d97706");
    expect(faviconColor([run({ id: "a" }), run({ id: "b", status: "attention" })])).toBe("#d97706");
    expect(faviconColor([run({ status: "failed" })])).toBe("#b91c1c");
    expect(faviconColor([run({ id: "a" }), run({ id: "b", status: "failed" })])).toBe("#477a62");
    expect(faviconColor([])).toBe("#1c211f");
  });
});
