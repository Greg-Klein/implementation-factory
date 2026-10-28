import { afterEach, describe, expect, it } from "@jest/globals";
import { demoBatch, demoBatchLaunchState, demoLaunchState, DEMO_BATCH, startDemoRun, startIncidentDemoRun } from "../../server/demo";
import { demoAcceptanceOf, demoArtifactContentsOf } from "../../server/demo-data";
import { RunSession } from "../../server/run-session";

const sessions: RunSession[] = [];

function demoSession(language: "fr" | "en", scenario: "workflow" | "incident" = "workflow") {
  const session = new RunSession(`demo-${language}-${scenario}`, { ...demoLaunchState(scenario), language });
  sessions.push(session);
  return session;
}

afterEach(() => {
  for (const session of sessions.splice(0)) for (const timer of session.demoTimers) clearTimeout(timer);
});

describe("the simulated run launch", () => {
  it("should title the ticket in the run's language", () => {
    expect(demoLaunchState("workflow", "fr").ticketTitle).toBe("Ajouter des préférences de notification");
    expect(demoLaunchState("workflow", "en").ticketTitle).toBe("Add notification preferences");
  });

  it("should keep the English launch by default", () => {
    expect(demoLaunchState().instruction).toBe("Demo mode, no repository will be modified.");
  });

  it("should title each ticket of the batch in French", () => {
    expect(demoBatchLaunchState("ticket-simule://IH-43", "fr").ticketTitle).toBe("Proposer un résumé hebdomadaire par email");
  });
});

describe("the simulated batch", () => {
  it("should describe the tickets and their overlap in French", () => {
    const batch = demoBatch("fr");
    expect(batch.tickets[0]?.summary).toBe("Ajoute un panneau de préférences de notification aux paramètres du compte.");
    expect(batch.edges[0]?.reason).toBe("Les deux tickets modifient le panneau de préférences de notification.");
  });

  it("should keep the addresses and files whatever the language", () => {
    const strip = (batch: typeof DEMO_BATCH) => batch.tickets.map(({ issueUrl, files, confidence }) => ({ issueUrl, files, confidence }));
    expect(strip(demoBatch("fr"))).toEqual(strip(DEMO_BATCH));
  });
});

describe("the simulated run narration", () => {
  it("should write the first activity and terminal line of the workflow in French", () => {
    const session = demoSession("fr");
    startDemoRun(session);
    expect(session.state.instruction).toBe("Mode démo, aucun dépôt ne sera modifié.");
    expect(session.state.activities.map((activity) => activity.title)).toContain("Ticket simulé chargé");
    expect(session.state.action).toBe("Lecture du ticket GitLab");
  });

  it("should write it in English for an English run", () => {
    const session = demoSession("en");
    startDemoRun(session);
    expect(session.state.activities.map((activity) => activity.title)).toContain("Simulated ticket loaded");
  });

  it("should write the incident scenario in French", () => {
    const session = demoSession("fr", "incident");
    startIncidentDemoRun(session);
    expect(session.state.ticketTitle).toBe("Exporter la table des factures en CSV");
    expect(session.state.activities.map((activity) => activity.title)).toContain("Ticket simulé chargé");
  });
});

describe("the simulated documents", () => {
  it("should hold the same documents in both languages", () => {
    expect(Object.keys(demoArtifactContentsOf("fr")).sort()).toEqual(Object.keys(demoArtifactContentsOf("en")).sort());
  });

  it("should write the reports in French without a dash", () => {
    const documents = demoArtifactContentsOf("fr");
    expect(documents["qa-report.md"]).toContain("## Contrôles");
    expect(documents["ticket-context.md"]).toContain("Critères d'acceptation");
    expect(Object.values(documents).filter((content) => /[–—]/.test(content))).toEqual([]);
  });

  it("should keep the verdict tokens and identifiers the console parses", () => {
    const fr = demoAcceptanceOf("fr");
    const en = demoAcceptanceOf("en");
    const tokens = (acceptance: typeof fr) => [...acceptance.qaRoundOne.items, ...acceptance.qaRoundTwo.items, ...acceptance.design.items].map((item) => ({ id: item.id, verdict: item.verdict, criterionIds: "criterionIds" in item ? item.criterionIds : undefined }));
    expect(tokens(fr)).toEqual(tokens(en));
    expect([fr.qaRoundOne.status, fr.qaRoundTwo.status]).toEqual(["FAIL", "FAIL"]);
    expect(fr.criteria.criteria.map((criterion) => criterion.id)).toEqual(en.criteria.criteria.map((criterion) => criterion.id));
  });

  it("should translate the free text of the evidence files", () => {
    expect(demoAcceptanceOf("fr").criteria.criteria[0]?.text).toBe("Les préférences sont enregistrées par utilisateur.");
    expect(demoAcceptanceOf("en").criteria.criteria[0]?.text).toBe("Preferences are saved per user.");
  });
});
