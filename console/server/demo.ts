import { demoStepDuration } from "./config.js";
import { now } from "./context.js";
import { demoAcceptance, demoArtifactContents, DEMO_SNAPSHOTS } from "./demo-data.js";
import { ingestAcceptanceInput, refreshAcceptance } from "./acceptance-runtime.js";
import { agentIdentity, agentRole, pairDelegation, plannedTasks } from "./domain.js";
import { pilotActs } from "./run-health.js";
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
  session.activity("agent", `${agent.nickname} · ${agent.role} starts`, taskId);
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
  demoTerminal(session, "Instruction noted. The demonstration does not modify any repository.");
}

/**
 * The state a demo run starts from. The registry gives it a slot and a place in
 * the queue like any other run, so the simulated checkout is a real address as
 * far as the ticket lock is concerned. It has no worktree: nothing here is a git repository.
 */
export const DEMO_CWD = "~/workspace/acme-dashboard";
/** The incident scenario runs on a checkout of its own, so it can play beside the main demonstration. */
export const INCIDENT_DEMO_CWD = "~/workspace/acme-exports";

export function demoLaunchState(scenario: "workflow" | "incident" = "workflow") {
  if (scenario === "incident") return {
    status: "running" as const, phase: 1, cwd: INCIDENT_DEMO_CWD, repository: INCIDENT_DEMO_CWD, issueUrl: "ticket-simule://IH-57", ticketTitle: "Export the invoices table as CSV",
    instruction: "Incident demonstration: no repository will be modified.", startedAt: now(),
    action: "Reading the GitLab ticket",
  };
  return {
    status: "running" as const, phase: 1, cwd: DEMO_CWD, repository: DEMO_CWD, issueUrl: "ticket-simule://IH-42", ticketTitle: "Add notification preferences",
    instruction: "Demo mode, no repository will be modified.", startedAt: now(),
    action: "Reading the GitLab ticket",
  };
}

/**
 * The batch of the demonstration: three invented tickets of the simulated
 * repository, and the schedule a scheduling session would have returned for
 * them. Two of them touch the same file, so one waits for the other's merge
 * request; the third runs beside them.
 */
export const DEMO_BATCH = {
  tickets: [
    { issueUrl: "ticket-simule://IH-42", title: "Add notification preferences", confidence: "high" as const, files: ["src/settings/notification-preferences.tsx", "src/settings/notification-preferences.test.tsx"], summary: "Adds a notification preferences panel to the account settings." },
    { issueUrl: "ticket-simule://IH-43", title: "Offer a weekly summary by email", confidence: "medium" as const, files: ["src/settings/notification-preferences.tsx", "src/emails/weekly-digest.tsx"], summary: "Adds the choice of a weekly summary by email to the preferences panel." },
    { issueUrl: "ticket-simule://IH-44", title: "Export the audit log as CSV", confidence: "high" as const, files: ["src/audit/export.ts", "src/audit/export.test.ts"], summary: "Adds a CSV export to the audit log." },
  ],
  edges: [{ a: "ticket-simule://IH-42", b: "ticket-simule://IH-43", kind: "overlap" as const, reason: "Both tickets modify the notification preferences panel." }],
};

function demoTicket(session: RunSession) {
  const reference = session.state.issueUrl.replace("ticket-simule://", "");
  const position = DEMO_BATCH.tickets.findIndex((ticket) => ticket.issueUrl === session.state.issueUrl);
  return {
    reference,
    // The first ticket keeps the branch and the merge request the demonstration has always shown.
    branch: position <= 0 ? "feat/ih-42-notification-preferences" : `feat/${reference.toLowerCase()}`,
    mergeRequest: `acme-dashboard/-/merge_requests/${128 + Math.max(position, 0)}`,
  };
}

/** The state one ticket of the demonstration batch starts from: the regular simulated workflow, under its own ticket. */
export function demoBatchLaunchState(issueUrl: string) {
  const ticket = DEMO_BATCH.tickets.find((candidate) => candidate.issueUrl === issueUrl);
  return { ...demoLaunchState("workflow"), issueUrl, ...(ticket ? { ticketTitle: ticket.title } : {}) };
}

/**
 * A pilot that hands control back halfway, with nothing running and nothing
 * declared next: the case the health detector exists for. No incident is
 * staged here; the detector finds it on its own, after its grace period.
 */
export function startIncidentDemoRun(session: RunSession) {
  session.activity("system", "Simulated ticket loaded", "IH-57 · Export the invoices table as CSV");
  session.publish();
  demoTerminal(session, "Reading the simulated GitLab ticket…");
  scheduleDemo(session, demoStepDuration, () => {
    pilotActs(session.signals, Date.now());
    session.state.phase = 4;
    session.state.branch = "feat/ih-57-export-csv";
    session.state.artifacts = ["ticket-context.md", "implementation-plan.md"];
    session.state.planTasks = [
      { id: "T1", title: "Serialize the table rows", status: "todo" },
      { id: "T2", title: "Add the export button", status: "todo", dependencies: ["T1"] },
    ];
    session.state.action = "Delegating to developer";
    delegateDemoTask(session, "T1");
    session.refreshPlanTasks();
    session.markProgress();
    session.publish();
    session.signal();
    demoTerminal(session, "Plan ready. T1 handed to a developer.");
  });
  scheduleDemo(session, demoStepDuration * 2, () => {
    finishDemoTask(session, "T1");
    session.state.phase = 5;
    session.state.action = undefined;
    session.refreshPlanTasks();
    session.markProgress();
    // The pilot ends its turn here and launches nothing: T2 is left waiting.
    session.signals.pilotIdleSince = Date.now();
    session.activity("system", "Claude Code handed back");
    session.publish();
    session.signal();
    demoTerminal(session, "T1 done. (The session waits at its prompt, without starting T2.)");
  });
  // The monitor ticks every fifteen seconds; the demonstration asks for a look right after its shortened grace.
  scheduleDemo(session, demoStepDuration * 2 + demoHealthGraceMs() + 50, () => session.signal());
}

/** The grace of the incident demonstration: long enough to see the hand-back, short enough not to wait a minute. */
export function demoHealthGraceMs() {
  return demoStepDuration * 2;
}

/** What the simulated pilot does once the user asks it to go on: T2, then the end of the run. */
export function resumeDemoAfterContinuation(session: RunSession) {
  scheduleDemo(session, Math.max(200, demoStepDuration / 2), () => {
    pilotActs(session.signals, Date.now());
    session.state.action = "Delegating to developer";
    delegateDemoTask(session, "T2");
    session.refreshPlanTasks();
    session.markProgress();
    session.publish();
    session.signal();
    demoTerminal(session, "Resuming: the plan shows T2 remaining, delegating to the developer.");
  });
  scheduleDemo(session, demoStepDuration * 1.5, () => {
    finishDemoTask(session, "T2");
    session.state.phase = 10;
    session.state.action = undefined;
    session.state.status = "completed";
    session.state.endedAt = now();
    session.refreshPlanTasks();
    session.markProgress();
    session.activity("system", "Incident demonstration completed", "No repository or ticket was modified.");
    session.publish();
    session.signal();
    demoTerminal(session, "T2 done. End of the incident demonstration.");
  });
}

export function startDemoRun(session: RunSession) {
  // The simulated code has two versions: the one the first review measured, and the one after the rework.
  for (const id of Object.values(DEMO_SNAPSHOTS)) session.evidence.rememberSnapshot(id, session.state.startedAt ?? now());
  session.evidence.currentSnapshot = { id: DEMO_SNAPSHOTS.implementation, capturedAt: now() };
  session.activity("system", "Simulated ticket loaded", `${demoTicket(session).reference} · ${session.state.ticketTitle ?? "Add notification preferences"}`);
  session.publish();
  demoTerminal(session, "Reading the simulated GitLab ticket…");
  scheduleDemo(session, demoStepDuration, () => {
    session.state.artifacts = ["ticket-context.md"];
    session.activity("artifact", "Ticket context consolidated", "ticket-context.md");
    session.publish();
    demoTerminal(session, "Acceptance criteria and edge cases extracted.");
  });
  scheduleDemo(session, demoStepDuration * 2, () => {
    session.state.phase = 2;
    session.state.action = undefined;
    session.state.status = "attention";
    session.state.pendingQuestion = {
      id: `demo-question-${session.id}`,
      questions: [
        {
          header: "Base branch",
          question: "Which branch should this implementation be built on?",
          options: [
            { label: "develop", description: "Follows the existing integration flow." },
            { label: "main", description: "Starts directly from the stable branch." },
          ],
          multiSelect: false,
        },
        {
          header: "Notifications",
          question: "What behavior should apply when notifications are turned off?",
          options: [
            { label: "Hide everything", description: "No notification is shown." },
            { label: "Keep critical alerts", description: "Security alerts stay visible." },
          ],
          multiSelect: false,
        },
      ],
    };
    session.activity("attention", "Two decisions are waiting for your answer");
    session.publish();
    demoTerminal(session, "Claude is waiting for your decisions in the right-hand panel.");
  });
}

export function continueDemoRun(session: RunSession) {
  scheduleDemo(session, 0, () => {
    session.state.phase = 3;
    session.state.action = "Creating the branch";
    session.state.branch = demoTicket(session).branch;
    writeDemoDocument(session, "acceptance-criteria.json", JSON.stringify(demoAcceptance.criteria, null, 2));
    session.activity("system", "Demonstration branch prepared", session.state.branch);
    session.publish();
    demoTerminal(session, "Branch and work plan prepared.");
  });
  scheduleDemo(session, demoStepDuration, () => {
    session.state.phase = 4;
    session.state.artifacts = [...session.state.artifacts, "implementation-plan.md", "planner-output.json"];
    session.state.planTasks = plannedTasks(demoArtifactContents["planner-output.json"]);
    writeDemoDocument(session, "planner-output.json", demoArtifactContents["planner-output.json"]);
    session.activity("artifact", "Implementation plan approved", "implementation-plan.md");
    session.refreshPlanTasks();
    session.publish();
    demoTerminal(session, "Plan split into components, tests and data migration.");
  });
  scheduleDemo(session, demoStepDuration * 2, () => {
    session.state.phase = 5;
    session.state.action = "Delegating to developer";
    delegateDemoTask(session, "T1");
    delegateDemoTask(session, "T2");
    session.refreshPlanTasks();
    session.publish();
    demoTerminal(session, "Delegating the implementation to the developer agent…");
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
    session.state.action = "Running the tests";
    session.refreshPlanTasks();
    // The reviewers write their plan before they read what the authors concluded.
    session.state.artifacts = [...session.state.artifacts, "developer-report.md", "test-report.json", "assets/panneau-preferences.png", "qa-plan.md", "design-inventory.md"];
    session.artifactArrived("qa-plan.md", now());
    session.artifactArrived("design-inventory.md", now());
    writeDemoDocument(session, "assets/panneau-preferences.png", png(demoArtifactContents["assets/panneau-preferences.png"]), false);
    writeDemoDocument(session, "dev-evidence.json", JSON.stringify(demoAcceptance.developer, null, 2));
    session.state.evidenceUpdatedAt = now();
    session.activity("agent", "Implementation done, checks in progress");
    session.publish();
    demoTerminal(session, "Unit tests and TypeScript check done. Moving on to review…");
  });
  scheduleDemo(session, demoStepDuration * 4, () => {
    session.state.phase = 7;
    session.state.agents = session.state.agents.map((agent) => agent.id === "demo-reviewer" ? { ...agent, status: "failed" as const, endedAt: now() } : agent);
    session.state.artifacts = [...session.state.artifacts, "senior-review-round-1.md"];
    writeDemoDocument(session, "assets/alerte-critique.png", png(demoAcceptance.captures.roundOne), false);
    writeDemoDocument(session, "qa-evidence.json", JSON.stringify(demoAcceptance.qaRoundOne, null, 2));
    session.activity("attention", "Review: fixes requested", "The critical fallback ignores the time zone · a regression test is missing");
    session.publish();
    demoTerminal(session, "Review 1/2: changes requested on the fallback and its test coverage.");
  });
  scheduleDemo(session, demoStepDuration * 5, () => {
    session.state.phase = 5;
    delegateDemoTask(session, "T4");
    session.refreshPlanTasks();
    session.activity("agent", "developer resumes the implementation", "Applying the two review findings");
    session.publish();
    demoTerminal(session, "Looping back to implementation: fixing the fallback and adding the missing test…");
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
    session.activity("agent", "Fixes verified", "12 tests pass, including the new regression test");
    session.publish();
    demoTerminal(session, "Fixes done. All 12 tests pass, new review requested.");
  });
  scheduleDemo(session, demoStepDuration * 7, () => {
    session.state.phase = 7;
    session.state.agents = session.state.agents.map((agent) => agent.id === "demo-reviewer" ? { ...agent, status: "completed" as const, endedAt: now() } : agent);
    session.state.artifacts = [...session.state.artifacts, "senior-review-round-2.md", "qa-report.md", "designer-review.md", "assets/reference-panneau-preferences.png"];
    session.artifactArrived("qa-report.md", now());
    session.artifactArrived("designer-review.md", now());
    writeDemoDocument(session, "assets/reference-panneau-preferences.png", png(demoArtifactContents["assets/reference-panneau-preferences.png"]), false);
    writeDemoDocument(session, "design-evidence.json", JSON.stringify(demoAcceptance.design, null, 2));
    writeDemoDocument(session, "qa-evidence-round1.json", JSON.stringify(demoAcceptance.qaRoundOne, null, 2));
    writeDemoDocument(session, "assets/alerte-critique.png", png(demoAcceptance.captures.roundTwo), false);
    writeDemoDocument(session, "qa-evidence.json", JSON.stringify(demoAcceptance.qaRoundTwo, null, 2));
    // A second write, the way a review round overwrites the file: the badge has to light again.
    session.state.evidenceUpdatedAt = now();
    session.activity("agent", "Review 2/2 blocked", "Findings from the first round resolved, AC4 still failed");
    session.publish();
    demoTerminal(session, "Review 2/2: the findings from the first round are resolved, but AC4 is still failed. Loop limit reached: the merge request will go out as a draft.");
  });
  scheduleDemo(session, demoStepDuration * 8, () => {
    session.state.phase = 8;
    session.state.artifacts = [...session.state.artifacts, "mr-description.md"];
    session.activity("artifact", "Draft merge request prepared", "mr-description.md");
    session.publish();
    demoTerminal(session, "Merge request description generated, with a Blocked section for AC4.");
  });
  scheduleDemo(session, demoStepDuration * 9, () => {
    session.state.phase = 9;
    session.state.action = "Opening the merge request";
    session.state.mergeRequestUrl = `ticket-simule://${demoTicket(session).mergeRequest}`;
    session.activity("system", "Draft merge request opened (demo)", demoTicket(session).mergeRequest);
    session.activity("system", "Review report published", "Review 2/2 · blocked on AC4");
    session.publish();
    demoTerminal(session, "Final report published in the simulated merge request.");
  });
  scheduleDemo(session, demoStepDuration * 10, () => {
    session.state.phase = 10;
    session.state.action = undefined;
    session.state.status = "completed";
    session.state.endedAt = now();
    session.activity("system", "Demonstration completed", "No repository or ticket was modified.");
    session.publish();
    demoTerminal(session, "Simulated draft merge request ready. End of the demonstration.");
  });
  scheduleDemo(session, demoStepDuration * 11, () => {
    const worktreeName = `demo-self-improvement-${crypto.randomUUID().slice(0, 8)}`;
    demoState.pendingImprovement = { worktreeName, commits: 1, status: "ready" };
    session.activity("agent", "Improvements ready, awaiting approval");
    session.publish();
    demoTerminal(session, "Self-audit completed. Improvements are proposed in the right-hand panel.");
  });
}
