import { describe, expect, it } from "@jest/globals";
import { createSignals, evaluateRunHealth, healthSignalsView, type HealthInput } from "../../server/run-health";
import { checkIncidentAction, interruptRun, resolutionOutcome } from "../../server/run-incidents";
import type { RunIncident, RunState } from "../../server/types";

const T0 = Date.UTC(2026, 8, 27, 10, 0, 0);

function input(overrides: Partial<Omit<HealthInput, "signals">>, signals: Partial<ReturnType<typeof createSignals>> = {}): HealthInput {
  return { status: "running", sessionActive: true, stoppedBy: null, pendingQuestion: false, agents: [], artifacts: [], ...overrides, signals: healthSignalsView({ ...createSignals(T0), ...signals }) };
}

describe("the language of the health verdicts", () => {
  it("should word a wait on the user in French when the run is French", () => {
    const verdict = evaluateRunHealth(input({ language: "fr", pendingQuestion: true }), T0 + 1_000);
    expect(verdict).toMatchObject({ health: "waiting", title: "En attente d'une décision", wait: { on: "vous", liftedBy: "votre réponse" } });
  });

  it("should word an incident in French and keep its fingerprint", () => {
    const verdict = evaluateRunHealth(input({ language: "fr" }, { pilotIdleSince: T0 }), T0 + 120_000);
    expect(verdict.incident).toMatchObject({ kind: "no_next_action", title: "Rien en cours", fingerprint: `no_next_action:${T0}` });
    expect(verdict.incident?.reason).toContain("a rendu la main");
  });

  it("should keep English when no language is given", () => {
    expect(evaluateRunHealth(input({ pendingQuestion: true }), T0 + 1_000)).toMatchObject({ title: "Waiting for a decision" });
  });

  it("should word the resolution of an incident in French", () => {
    const incident = { kind: "no_next_action", fingerprint: "x" } as RunIncident;
    expect(resolutionOutcome(incident, input({ language: "fr", status: "completed" }), { health: "healthy" })).toBe("Workflow terminé");
  });
});

describe("the language of an incident action refusal", () => {
  it("should refuse a stale revision in French", () => {
    const incident = { status: "open", revision: 2, decisions: [], kind: "no_next_action" } as unknown as RunIncident;
    const check = checkIncidentAction({ incident, expectedRevision: 1, requestId: "r", action: "stop", live: true, language: "fr" });
    expect(check).toEqual({ ok: false, message: "La situation a changé depuis l'affichage. Relisez l'incident avant d'agir." });
  });
});

describe("the language of an interrupted run", () => {
  it("should describe the interruption in the run's language", () => {
    const state = { id: "r1", status: "running", phase: 3, cwd: "/w", activities: [], agents: [], messages: [], artifacts: [], language: "fr" } as unknown as RunState;
    const interrupted = interruptRun(state, "2026-10-14T09:00:00.000Z");
    expect(interrupted.incidents?.[0]).toMatchObject({ title: "Session interrompue" });
    expect(interrupted.error).toContain("redémarré");
  });
});
