import { demoStepDuration } from "./config.js";
import { now } from "./context.js";
import { demoAcceptance, demoArtifactContents, DEMO_SNAPSHOTS } from "./demo-data.js";
import { ingestAcceptanceInput, refreshAcceptance } from "./acceptance-runtime.js";
import { agentIdentity, agentRole, pairDelegation, plannedTasks } from "./domain.js";
import type { RunSession } from "./run-session.js";
import type { AgentState, PendingSelfImprovementReview } from "./types.js";

/** The demo has no real worktree to list, so it fakes one entry alongside the real ones. */
export const demoState: { pendingImprovement?: PendingSelfImprovementReview } = {};

function scheduleDemo(session: RunSession, delay: number, callback: () => void) {
  const timer = setTimeout(() => { session.demoTimers.delete(timer); callback(); }, delay);
  session.demoTimers.add(timer);
}

function demoTerminal(session: RunSession, message: string) {
  session.appendTerminal(`\r\n\x1b[38;5;108m●\x1b[0m ${message}\r\n`);
  session.conversationMessage({ id: `demo-${crypto.randomUUID()}`, at: now(), author: "claude", text: message });
  session.publish();
}

/** A developer handed one plan task, named and paired the way hooks.ts does it for a real run. */
function delegateDemoTask(session: RunSession, taskId: string) {
  const id = `demo-developer-${taskId}`;
  const agent: AgentState = { id, name: "developer", ...agentIdentity(session.state.agents.length), role: agentRole("developer"), status: "running", startedAt: now() };
  session.state.agents = [agent, ...session.state.agents];
  session.state.planDelegations = pairDelegation([...session.state.planDelegations ?? [], { agentType: "developer", taskIds: [taskId] }], "developer", id);
  session.activity("agent", `${agent.nickname} · ${agent.role} démarre`, taskId);
}

function finishDemoTask(session: RunSession, taskId: string) {
  session.state.agents = session.state.agents.map((agent) => agent.id === `demo-developer-${taskId}` ? { ...agent, status: "completed" as const, endedAt: now() } : agent);
  session.state.artifacts = [...session.state.artifacts, `developer-report-${taskId}.md`];
}

function startDemoReviewer(session: RunSession) {
  session.state.agents = [{ id: "demo-reviewer", name: "senior-reviewer", ...agentIdentity(session.state.agents.length), role: agentRole("senior-reviewer"), status: "running", startedAt: now() }, ...session.state.agents];
}

/**
 * A document the simulated workflow "writes": kept in the run's in-memory task
 * directory and handed to the same ingestion a real file goes through, so the
 * coverage the demo shows is computed, not staged.
 */
function writeDemoDocument(session: RunSession, name: string, content: string | Buffer, listed = true) {
  session.demoFiles.set(name, Buffer.isBuffer(content) ? content : Buffer.from(content));
  if (listed && !session.state.artifacts.includes(name)) session.state.artifacts = [...session.state.artifacts, name];
  void ingestAcceptanceInput(session, name);
}

const png = (base64: string) => Buffer.from(base64, "base64");

export function acknowledgeDemoInstruction(session: RunSession) {
  demoTerminal(session, "Instruction prise en compte. La démonstration ne modifie aucun dépôt.");
}

/**
 * The state a demo run starts from. The registry gives it a slot and a place in
 * the queue like any other run, so the simulated checkout is a real address as
 * far as the repository lock is concerned.
 */
export const DEMO_CWD = "~/workspace/acme-dashboard";

export function demoLaunchState() {
  return {
    status: "running" as const, phase: 1, cwd: DEMO_CWD, issueUrl: "ticket-simule://IH-42", ticketTitle: "Ajouter les préférences de notification",
    instruction: "Mode démonstration — aucun dépôt ne sera modifié.", startedAt: now(),
    action: "Lecture du ticket GitLab",
  };
}

export function startDemoRun(session: RunSession) {
  // The simulated code has two versions: the one the first review measured, and the one after the rework.
  for (const id of Object.values(DEMO_SNAPSHOTS)) session.evidence.rememberSnapshot(id, session.state.startedAt ?? now());
  session.evidence.currentSnapshot = { id: DEMO_SNAPSHOTS.implementation, capturedAt: now() };
  session.activity("system", "Ticket simulé chargé", "IH-42 · Ajouter les préférences de notification");
  session.publish();
  demoTerminal(session, "Lecture du ticket GitLab simulé…");
  scheduleDemo(session, demoStepDuration, () => {
    session.state.artifacts = ["ticket-context.md"];
    session.activity("artifact", "Contexte du ticket consolidé", "ticket-context.md");
    session.publish();
    demoTerminal(session, "Critères d’acceptation et cas limites extraits.");
  });
  scheduleDemo(session, demoStepDuration * 2, () => {
    session.state.phase = 2;
    session.state.action = undefined;
    session.state.status = "attention";
    session.state.pendingQuestion = {
      id: `demo-question-${session.id}`,
      questions: [
        {
          header: "Branche de base",
          question: "Sur quelle branche faut-il construire cette implémentation ?",
          options: [
            { label: "develop", description: "Suit le flux d'intégration existant." },
            { label: "main", description: "Part directement de la branche stable." },
          ],
          multiSelect: false,
        },
        {
          header: "Notifications",
          question: "Quel comportement faut-il appliquer quand les notifications sont désactivées ?",
          options: [
            { label: "Tout masquer", description: "Aucune notification n'est présentée." },
            { label: "Garder les alertes critiques", description: "Les alertes de sécurité restent visibles." },
          ],
          multiSelect: false,
        },
      ],
    };
    session.activity("attention", "Deux décisions attendent ta réponse");
    session.publish();
    demoTerminal(session, "Claude attend tes décisions dans le panneau de droite.");
  });
}

export function continueDemoRun(session: RunSession) {
  scheduleDemo(session, 0, () => {
    session.state.phase = 3;
    session.state.action = "Création de la branche";
    session.state.branch = "feat/ih-42-notification-preferences";
    writeDemoDocument(session, "acceptance-criteria.json", JSON.stringify(demoAcceptance.criteria, null, 2));
    session.activity("system", "Branche de démonstration préparée", "feat/ih-42-notification-preferences");
    session.publish();
    demoTerminal(session, "Branche et plan de travail préparés.");
  });
  scheduleDemo(session, demoStepDuration, () => {
    session.state.phase = 4;
    session.state.artifacts = [...session.state.artifacts, "implementation-plan.md", "planner-output.json"];
    session.state.planTasks = plannedTasks(demoArtifactContents["planner-output.json"]);
    writeDemoDocument(session, "planner-output.json", demoArtifactContents["planner-output.json"]);
    session.activity("artifact", "Plan d’implémentation validé", "implementation-plan.md");
    session.refreshPlanTasks();
    session.publish();
    demoTerminal(session, "Plan découpé en composants, tests et migration de données.");
  });
  scheduleDemo(session, demoStepDuration * 2, () => {
    session.state.phase = 5;
    session.state.action = "Délégation à developer";
    delegateDemoTask(session, "T1");
    delegateDemoTask(session, "T2");
    session.refreshPlanTasks();
    session.publish();
    demoTerminal(session, "Délégation de l'implémentation à l'agent developer…");
  });
  scheduleDemo(session, demoStepDuration * 2.5, () => {
    finishDemoTask(session, "T1");
    delegateDemoTask(session, "T3");
    session.refreshPlanTasks();
    session.publish();
  });
  scheduleDemo(session, demoStepDuration * 3, () => {
    session.state.phase = 6;
    finishDemoTask(session, "T2");
    finishDemoTask(session, "T3");
    startDemoReviewer(session);
    session.state.action = "Exécution des tests";
    session.refreshPlanTasks();
    session.state.artifacts = [...session.state.artifacts, "developer-report.md", "test-report.json", "assets/panneau-preferences.png"];
    writeDemoDocument(session, "assets/panneau-preferences.png", png(demoArtifactContents["assets/panneau-preferences.png"]), false);
    writeDemoDocument(session, "dev-evidence.json", JSON.stringify(demoAcceptance.developer, null, 2));
    session.state.evidenceUpdatedAt = now();
    session.activity("agent", "Implémentation terminée, vérifications en cours");
    session.publish();
    demoTerminal(session, "Tests unitaires et contrôle TypeScript terminés. Passage en review…");
  });
  scheduleDemo(session, demoStepDuration * 4, () => {
    session.state.phase = 7;
    session.state.agents = session.state.agents.map((agent) => agent.id === "demo-reviewer" ? { ...agent, status: "failed" as const, endedAt: now() } : agent);
    session.state.artifacts = [...session.state.artifacts, "senior-review-round-1.md"];
    writeDemoDocument(session, "assets/alerte-critique.png", png(demoAcceptance.captures.roundOne), false);
    writeDemoDocument(session, "qa-evidence.json", JSON.stringify(demoAcceptance.qaRoundOne, null, 2));
    session.activity("attention", "Review : corrections demandées", "Le fallback critique ignore le fuseau horaire · un test de régression manque");
    session.publish();
    demoTerminal(session, "Review 1/2 : changements demandés sur le fallback et sa couverture de test.");
  });
  scheduleDemo(session, demoStepDuration * 5, () => {
    session.state.phase = 5;
    delegateDemoTask(session, "T4");
    session.refreshPlanTasks();
    session.activity("agent", "developer reprend l’implémentation", "Application des deux retours de review");
    session.publish();
    demoTerminal(session, "Boucle vers l’implémentation : correction du fallback et ajout du test manquant…");
  });
  scheduleDemo(session, demoStepDuration * 6, () => {
    session.state.phase = 6;
    finishDemoTask(session, "T4");
    session.state.agents = session.state.agents.map((agent) => agent.id === "demo-reviewer" ? { ...agent, status: "running" as const, startedAt: now(), endedAt: undefined } : agent);
    session.refreshPlanTasks();
    session.state.artifacts = [...session.state.artifacts, "test-report-round-2.json"];
    // The rework changed the code: everything measured before it is now stale.
    session.evidence.currentSnapshot = { id: DEMO_SNAPSHOTS.final, capturedAt: now() };
    void refreshAcceptance(session);
    session.activity("agent", "Corrections vérifiées", "12 tests passent, dont le nouveau test de régression");
    session.publish();
    demoTerminal(session, "Corrections terminées. Les 12 tests passent, nouvelle review demandée.");
  });
  scheduleDemo(session, demoStepDuration * 7, () => {
    session.state.phase = 7;
    session.state.agents = session.state.agents.map((agent) => agent.id === "demo-reviewer" ? { ...agent, status: "completed" as const, endedAt: now() } : agent);
    session.state.artifacts = [...session.state.artifacts, "senior-review-round-2.md", "qa-report.md"];
    writeDemoDocument(session, "qa-evidence-round1.json", JSON.stringify(demoAcceptance.qaRoundOne, null, 2));
    writeDemoDocument(session, "assets/alerte-critique.png", png(demoAcceptance.captures.roundTwo), false);
    writeDemoDocument(session, "qa-evidence.json", JSON.stringify(demoAcceptance.qaRoundTwo, null, 2));
    // A second write, the way a review round overwrites the file: the badge has to light again.
    session.state.evidenceUpdatedAt = now();
    session.activity("agent", "Review 2/2 approuvée", "Les retours du premier passage sont résolus");
    session.publish();
    demoTerminal(session, "Review 2/2 : approuvée. Les retours ont bien été pris en compte.");
  });
  scheduleDemo(session, demoStepDuration * 8, () => {
    session.state.phase = 8;
    session.state.artifacts = [...session.state.artifacts, "mr-description.md"];
    session.activity("artifact", "Merge request préparée", "mr-description.md");
    session.publish();
    demoTerminal(session, "Description et checklist de merge request générées.");
  });
  scheduleDemo(session, demoStepDuration * 9, () => {
    session.state.phase = 9;
    session.state.action = "Ouverture de la merge request";
    session.state.mergeRequestUrl = "ticket-simule://acme-dashboard/-/merge_requests/128";
    session.activity("system", "Merge request ouverte (démo)", "acme-dashboard/-/merge_requests/128");
    session.activity("system", "Rapport de review publié", "Review 2/2 · approuvée");
    session.publish();
    demoTerminal(session, "Rapport final publié dans la merge request simulée.");
  });
  scheduleDemo(session, demoStepDuration * 10, () => {
    session.state.phase = 10;
    session.state.action = undefined;
    session.state.status = "completed";
    session.state.endedAt = now();
    session.activity("system", "Démonstration terminée", "Aucun dépôt ni ticket n’a été modifié.");
    session.publish();
    demoTerminal(session, "Merge request simulée prête. Fin de la démonstration.");
  });
  scheduleDemo(session, demoStepDuration * 11, () => {
    const worktreeName = `demo-self-improvement-${crypto.randomUUID().slice(0, 8)}`;
    demoState.pendingImprovement = { worktreeName, commits: 1, status: "ready" };
    session.activity("agent", "Améliorations prêtes — en attente de validation");
    session.publish();
    demoTerminal(session, "Auto-audit terminé. Des améliorations sont proposées dans le panneau de droite.");
  });
}
