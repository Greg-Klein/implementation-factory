import { describe, expect, it } from "@jest/globals";
import { closeAbandonedAgents } from "../../server/domain";
import { activeAgents } from "../../lib/run-state";
import type { AgentState } from "../../server/types";

const agent = (overrides: Partial<AgentState>): AgentState => ({ id: "a1", name: "implementation-factory:developer", status: "running", startedAt: "2026-09-11T06:24:46.939Z", ...overrides });

describe("agents left behind by a finished run", () => {
  it("should close an agent that never reported its end, without inventing an outcome", () => {
    const { agents, abandoned } = closeAbandonedAgents([agent({})], "2026-09-11T07:05:40.040Z");
    expect(agents).toEqual([expect.objectContaining({ id: "a1", status: "abandoned", endedAt: "2026-09-11T07:05:40.040Z" })]);
    expect(abandoned.map((entry) => entry.id)).toEqual(["a1"]);
  });

  it("should leave every agent that already reported one untouched", () => {
    const reported = [
      agent({ id: "done", status: "completed", endedAt: "2026-09-11T06:31:41.666Z" }),
      agent({ id: "broken", status: "failed", endedAt: "2026-09-11T06:32:00.000Z" }),
    ];
    const { agents, abandoned } = closeAbandonedAgents(reported, "2026-09-11T07:05:40.040Z");
    expect(agents).toBe(reported);
    expect(abandoned).toEqual([]);
  });

  it("should close each abandoned agent of a run that ended with several in flight", () => {
    const { abandoned } = closeAbandonedAgents([agent({ id: "a1" }), agent({ id: "a2", name: "Explore" }), agent({ id: "a3", status: "completed", endedAt: "2026-09-11T06:31:41.666Z" })], "2026-09-11T07:05:40.040Z");
    expect(abandoned.map((entry) => entry.name)).toEqual(["implementation-factory:developer", "Explore"]);
  });

  it("should stop counting an abandoned agent as active, so the console drops its live timer", () => {
    const { agents } = closeAbandonedAgents([agent({})], "2026-09-11T07:05:40.040Z");
    expect(activeAgents(agents)).toEqual([]);
  });
});
