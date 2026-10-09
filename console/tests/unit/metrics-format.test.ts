import { describe, expect, it } from "@jest/globals";

import { formatCost, formatDuration, formatShare, formatTokens, judgeRows, judgeSummary, planSizes, reworkCount, summarize } from "../../lib/metrics";
import type { RunMetrics } from "../../lib/types";

const metrics = (overrides: { status?: RunMetrics["outcome"]["status"]; tokens?: number; activeMs?: number; launches?: Record<string, number>; reworkDevelopers?: number; sizes?: RunMetrics["complexity"]["sizes"]; tasks?: number } = {}) => ({
  outcome: { status: overrides.status ?? "completed" },
  time: { activeMs: overrides.activeMs ?? 60_000, userWaitMs: 0 },
  complexity: { tasks: overrides.tasks ?? 0, sizes: overrides.sizes ?? { S: 0, M: 0, L: 0 }, criteria: 0 },
  rework: { launches: overrides.launches ?? {}, reworkDevelopers: overrides.reworkDevelopers ?? 0, lostAgents: 0 },
  ...(overrides.tokens !== undefined ? { tokens: { total: { total: overrides.tokens }, pilotShare: 0.8 } } : {}),
}) as unknown as RunMetrics;

describe("metrics as the interface writes them", () => {
  it("should write tokens in thousands, then in millions with a decimal comma", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(72_506)).toBe("73k");
    expect(formatTokens(3_355_667)).toBe("3.36M");
  });

  it("should write a duration in seconds, minutes, then hours", () => {
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(6 * 60_000 + 20_000)).toBe("6m");
    expect(formatDuration(135 * 60_000)).toBe("2h 15m");
  });

  it("should write a share as a whole percentage", () => {
    expect(formatShare(0.868)).toBe("87%");
  });

  it("should count the review passes beyond the first and the corrections", () => {
    expect(reworkCount(metrics({ launches: { "senior-reviewer": 1, "qa-reviewer": 1 } }))).toBe(0);
    expect(reworkCount(metrics({ launches: { "senior-reviewer": 1, "qa-reviewer": 3 }, reworkDevelopers: 1 }))).toBe(3);
  });

  it("should write the sizes of the plan, or the number of tasks when it gave none", () => {
    expect(planSizes(metrics({ tasks: 3, sizes: { S: 2, M: 1, L: 0 } }))).toBe("2 S · 1 M");
    expect(planSizes(metrics({ tasks: 2 }))).toBe("2 tasks");
    expect(planSizes(metrics())).toBe("");
  });

  it("should give no median below three delivered runs", () => {
    expect(summarize([metrics({ tokens: 1 }), metrics({ tokens: 2 }), metrics({ status: "failed", tokens: 3 })])).toBeUndefined();
  });

  it("should give the medians of the delivered runs, a run without tokens counted for its time only", () => {
    expect(summarize([metrics({ tokens: 1_000, activeMs: 10 }), metrics({ tokens: 3_000, activeMs: 30 }), metrics({ activeMs: 20 }), metrics({ status: "stopped", tokens: 9_000 })]))
      .toMatchObject({ runs: 3, tokens: 2_000, activeMs: 20 });
  });
});

describe("the judge of the improvement loop", () => {
  const tokens = (total: number) => ({ input: 0, output: 0, cacheRead: total, cacheWrite: 0, total });
  const decision = (worktreeName: string, judgements: { durationMs: number; total?: number; costUsd?: number }[]) => ({
    worktreeName, at: "2026-10-09T08:00:00.000Z", decision: "merged" as const, reasons: [],
    judgements: judgements.map(({ durationMs, total, costUsd }) => ({ at: "2026-10-09T07:00:00.000Z", durationMs, ...(total !== undefined ? { tokens: tokens(total) } : {}), ...(costUsd !== undefined ? { costUsd } : {}) })),
  });
  const improvements = (judged: ReturnType<typeof decision>[]) => ({ merged: judged.length, rejected: 0, rejectedByJudge: 0, reverted: 0, judged });

  it("should add up the passes of one branch, and say when one left no figure", () => {
    const [row] = judgeRows(improvements([decision("self-improvement-a", [{ durationMs: 900_000 }, { durationMs: 120_000, total: 200_000, costUsd: 0.8 }])]));
    expect(row).toMatchObject({ passes: 2, durationMs: 1_020_000, tokens: 200_000, costUsd: 0.8, complete: false });
  });

  it("should take the median tokens over the decisions measured whole only", () => {
    const rows = judgeRows(improvements([
      decision("self-improvement-a", [{ durationMs: 60_000, total: 100_000, costUsd: 0.5 }]),
      decision("self-improvement-b", [{ durationMs: 180_000, total: 300_000, costUsd: 1.5 }]),
      decision("self-improvement-c", [{ durationMs: 900_000 }, { durationMs: 120_000, total: 5_000 }]),
    ]));
    expect(judgeSummary(rows)).toEqual({ durationMs: 180_000, tokens: 200_000, costUsd: 2 });
  });

  it("should write a cost in dollars, to the cent below ten", () => {
    expect([formatCost(0.4), formatCost(12.6)]).toEqual(["$0.40", "$13"]);
  });
});
