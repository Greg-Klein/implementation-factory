import { describe, expect, it } from "@jest/globals";
import { acceptanceChip, activeAgents, elapsedLabel, generatedDocuments, isDemoRun, isTranscriptStalled, isWriting, noticeIsStale, runStatusBadge, sessionAlive } from "../../lib/run-state";
import { terminalExitStatus } from "../../server/domain";

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

  it("should recognise a demonstration run from its identifier", () => {
    expect(isDemoRun("demo-2026-09-06T08-32-38-000Z")).toBe(true);
    expect(isDemoRun("2026-09-06T08-32-38-000Z-a1b2c3d4")).toBe(false);
    expect(isDemoRun(undefined)).toBe(false);
    expect(isDemoRun(null)).toBe(false);
  });

  it("should measure an unfinished step against the current time", () => {
    const start = "2026-09-07T10:00:00.000Z";
    expect(elapsedLabel(start, undefined, Date.parse("2026-09-07T10:00:31.000Z"))).toBe("31 s");
    expect(elapsedLabel(start, undefined, Date.parse("2026-09-07T10:02:05.000Z"))).toBe("2 min 05 s");
    expect(elapsedLabel(start, "2026-09-07T10:00:12.000Z", Date.parse("2026-09-07T11:00:00.000Z"))).toBe("12 s");
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

  it("should keep « À toi de jouer » for a real question", () => {
    expect(runStatusBadge({ status: "attention", pendingQuestion: { id: "q", questions: [] }, incidents: [incident("no_next_action")] })).toEqual({ label: "À toi de jouer", tone: "decision" });
  });

  it("should keep « À toi de jouer » for a prompt waiting in the terminal", () => {
    expect(runStatusBadge({ status: "attention", health: { health: "waiting", wait: { reason: "permission", since: "" }, evaluatedAt: "" } })).toEqual({ label: "À toi de jouer", tone: "decision" });
  });

  it("should say a run with no next action is blocked, without implying a question", () => {
    expect(runStatusBadge({ status: "attention", incidents: [incident("no_next_action")] })).toEqual({ label: "Sans suite", tone: "blocked" });
  });

  it("should read a lost session as an interruption, not as an error", () => {
    expect(runStatusBadge({ status: "failed", incidents: [incident("lost_session")] })).toEqual({ label: "Interrompu", tone: "error" });
    expect(runStatusBadge({ status: "failed" })).toEqual({ label: "Erreur", tone: "error" });
  });
});

describe("the acceptance chip of a run row", () => {
  const counts = { total: 5, verified: 2, failed: 1, blocked: 1, unverified: 1, stale: 0 };

  it("should show nothing without a registry of criteria", () => {
    expect(acceptanceChip(undefined)).toBeUndefined();
    expect(acceptanceChip({ ...counts, total: 0, verified: 0, failed: 0, blocked: 0, unverified: 0 })).toBeUndefined();
  });

  it("should show verified over total, coloured by the worst state left", () => {
    expect(acceptanceChip(counts)).toEqual({ label: "2/5 AC", title: "2 critères vérifiés sur 5 · 1 en échec · 1 bloqué · 1 non vérifié", tone: "error" });
    expect(acceptanceChip({ ...counts, failed: 0, unverified: 2 })?.tone).toBe("attention");
    expect(acceptanceChip({ ...counts, verified: 5, failed: 0, blocked: 0, unverified: 0 })).toMatchObject({ label: "5/5 AC", tone: "verified" });
  });
});
