import { describe, expect, it } from "@jest/globals";
import { createsBranch, phaseForAgent } from "../../server/domain";

describe("workflow progress", () => {
  it("should map running agents to the phase they work on", () => {
    expect(phaseForAgent("implementation-factory:ticket-planner")).toBe(4);
    expect(phaseForAgent("developer")).toBe(5);
    expect(phaseForAgent("implementation-factory:qa-reviewer")).toBe(6);
    expect(phaseForAgent("review-orchestrator")).toBe(6);
    expect(phaseForAgent("Explore")).toBe(0);
  });

  it("should recognize the commands that create the working branch", () => {
    expect(createsBranch("git checkout -b feat/258-notifications")).toBe(true);
    expect(createsBranch("git switch -c feat/258-notifications")).toBe(true);
    expect(createsBranch("git -C /tmp/repo switch --create feat/258")).toBe(true);
    expect(createsBranch("git checkout develop")).toBe(false);
    expect(createsBranch("glab issue view 258 | grep -b 3 branche")).toBe(false);
    expect(createsBranch(undefined)).toBe(false);
  });
});
