import { describe, expect, it } from "@jest/globals";
import { RunSession } from "../../server/run-session";

function startRun(id: string) {
  return new RunSession(id, { status: "running", startedAt: new Date().toISOString() });
}

describe("activity log", () => {
  it("should archive the whole run while the broadcast feed stays a window", () => {
    const session = startRun("2026-09-07T09-47-32-752Z-60bc30d4");
    for (let index = 0; index < 250; index += 1) session.activity("tool", `Bash ${index}`);
    expect(session.state.activities).toHaveLength(80);
    expect(session.archivedState().activities).toHaveLength(250);
    // Newest first, so the last entry is the oldest the run ever emitted.
    expect(session.archivedState().activities.at(-1)?.title).toBe("Bash 0");
    expect(session.state.activities.at(-1)?.title).toBe("Bash 170");
  });

  it("should bound the archive, since a run rewrites it in full on every event", () => {
    const session = startRun("run-bounded");
    for (let index = 0; index < 1_200; index += 1) session.activity("tool", `Bash ${index}`);
    expect(session.archivedState().activities).toHaveLength(1_000);
    expect(session.archivedState().activities.at(-1)?.title).toBe("Bash 200");
  });

  it("should keep each run's history to itself, however many are going at once", () => {
    const first = startRun("run-before");
    first.activity("system", "Session created");
    first.activity("agent", "developer");
    const second = startRun("run-after");
    second.activity("system", "Session created");
    expect(second.archivedState().activities).toEqual([expect.objectContaining({ title: "Session created" })]);
    expect(first.archivedState().activities).toHaveLength(2);
  });
});
