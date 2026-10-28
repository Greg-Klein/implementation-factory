import { demoStepDuration } from "./config.js";
import { now, reportFailure } from "./context.js";
import { demoAcceptanceOf, demoArtifactContentsOf, DEMO_SNAPSHOTS } from "./demo-data.js";
import { ingestAcceptanceInput, refreshAcceptance, refreshConfidence } from "./acceptance-runtime.js";
import { agentIdentity, agentRole, pairDelegation, plannedTasks } from "./domain.js";
import { runLanguage } from "./language.js";
import { pilotActs } from "./run-health.js";
import { texts } from "../lib/i18n/texts.js";
import type { Language } from "../lib/i18n/index.js";
import type { RunSession } from "./run-session.js";
import type { AgentState, PendingSelfImprovementReview } from "./types.js";

/** The demo has no real worktree to list, so it fakes one entry alongside the real ones. */
export const demoState: { pendingImprovement?: PendingSelfImprovementReview | undefined } = {};

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
  const role = agentRole("developer");
  const identity = agentIdentity(session.state.agents.length);
  const agent: AgentState = { id, name: "developer", ...identity, role, status: "running", startedAt: now() };
  session.state.agents = [agent, ...session.state.agents];
  session.state.planDelegations = pairDelegation([...session.state.planDelegations ?? [], { agentType: "developer", taskIds: [taskId] }], "developer", id);
  session.activity("agent", session.texts.demo.agentStarts(identity.nickname, role), taskId);
}

function finishDemoTask(session: RunSession, taskId: string) {
  session.state.agents = session.state.agents.map((agent) => agent.id === `demo-developer-${taskId}` ? { ...agent, status: "completed" as const, endedAt: now() } : agent);
  session.state.artifacts = [...session.state.artifacts, `developer-report-${taskId}.md`];
}

function startDemoReviewer(session: RunSession) {
  session.state.agents = [{ id: "demo-reviewer", name: "senior-reviewer", ...agentIdentity(session.state.agents.length), role: agentRole("senior-reviewer"), status: "running", startedAt: now() }, ...session.state.agents];
}

/** A document of the demo data. A name it does not hold is a mistake in this file, said at once. */
function demoDocument(session: RunSession, name: string) {
  const content = demoArtifactContentsOf(runLanguage(session.state))[name];
  if (content === undefined) throw new Error(`The demo has no document named ${name}.`);
  return content;
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
  demoTerminal(session, session.texts.demo.instructionNoted);
}

/**
 * The state a demo run starts from. The registry gives it a slot and a place in
 * the queue like any other run, so the simulated checkout is a real address as
 * far as the ticket lock is concerned. It has no worktree: nothing here is a git repository.
 */
export const DEMO_CWD = "~/workspace/acme-dashboard";
/** The incident scenario runs on a checkout of its own, so it can play beside the main demonstration. */
export const INCIDENT_DEMO_CWD = "~/workspace/acme-exports";

export function demoLaunchState(scenario: "workflow" | "incident" = "workflow", language: Language = "en") {
  const t = texts(language).demo;
  if (scenario === "incident") return {
    status: "running" as const, phase: 1, cwd: INCIDENT_DEMO_CWD, repository: INCIDENT_DEMO_CWD, issueUrl: "ticket-simule://IH-57", ticketTitle: t.incidentTicketTitle,
    instruction: t.incidentInstruction, startedAt: now(),
    action: t.actionReadingTicket,
  };
  return {
    status: "running" as const, phase: 1, cwd: DEMO_CWD, repository: DEMO_CWD, issueUrl: "ticket-simule://IH-42", ticketTitle: t.ticketTitle,
    instruction: t.workflowInstruction, startedAt: now(),
    action: t.actionReadingTicket,
  };
}

/**
 * What the registry stamped on a launch before the session existed was written
 * in English; the run's own language replaces it once the session is there.
 */
function localizeLaunch(session: RunSession, scenario: "workflow" | "incident") {
  const language = runLanguage(session.state);
  const launch = scenario === "incident" ? demoLaunchState("incident", language) : demoBatchLaunchState(session.state.issueUrl, language);
  session.state.ticketTitle = launch.ticketTitle;
  session.state.instruction = launch.instruction;
  session.state.action = launch.action;
}

/**
 * The batch of the demonstration: three invented tickets of the simulated
 * repository, and the schedule a scheduling session would have returned for
 * them. Two of them touch the same file, so one waits for the other's merge
 * request; the third runs beside them.
 */
export function demoBatch(language: Language) {
  const t = texts(language).demo;
  return {
    tickets: [
      { issueUrl: "ticket-simule://IH-42", title: t.batchTitle42, confidence: "high" as const, files: ["src/settings/notification-preferences.tsx", "src/settings/notification-preferences.test.tsx"], summary: t.batchSummary42 },
      { issueUrl: "ticket-simule://IH-43", title: t.batchTitle43, confidence: "medium" as const, files: ["src/settings/notification-preferences.tsx", "src/emails/weekly-digest.tsx"], summary: t.batchSummary43 },
      { issueUrl: "ticket-simule://IH-44", title: t.batchTitle44, confidence: "high" as const, files: ["src/audit/export.ts", "src/audit/export.test.ts"], summary: t.batchSummary44 },
    ],
    edges: [{ a: "ticket-simule://IH-42", b: "ticket-simule://IH-43", kind: "overlap" as const, reason: t.batchOverlap }],
  };
}

/** The batch in English: the tickets' addresses and files are what callers key on, whatever the language. */
export const DEMO_BATCH = demoBatch("en");

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
export function demoBatchLaunchState(issueUrl: string, language: Language = "en") {
  const ticket = demoBatch(language).tickets.find((candidate) => candidate.issueUrl === issueUrl);
  return { ...demoLaunchState("workflow", language), issueUrl, ...(ticket ? { ticketTitle: ticket.title } : {}) };
}

/**
 * A pilot that hands control back halfway, with nothing running and nothing
 * declared next: the case the health detector exists for. No incident is
 * staged here; the detector finds it on its own, after its grace period.
 */
export function startIncidentDemoRun(session: RunSession) {
  localizeLaunch(session, "incident");
  const t = session.texts.demo;
  session.activity("system", t.ticketLoaded, `IH-57 · ${t.incidentTicketTitle}`);
  session.publish();
  demoTerminal(session, t.readingTicket);
  scheduleDemo(session, demoStepDuration, () => {
    pilotActs(session.signals, Date.now());
    session.state.phase = 4;
    session.state.branch = "feat/ih-57-export-csv";
    session.state.artifacts = ["ticket-context.md", "implementation-plan.md"];
    session.state.planTasks = [
      { id: "T1", title: t.incidentTaskSerialize, status: "todo" },
      { id: "T2", title: t.incidentTaskButton, status: "todo", dependencies: ["T1"] },
    ];
    session.state.action = t.actionDelegating;
    delegateDemoTask(session, "T1");
    session.refreshPlanTasks();
    session.markProgress();
    session.publish();
    session.signal();
    demoTerminal(session, t.incidentPlanReady);
  });
  scheduleDemo(session, demoStepDuration * 2, () => {
    finishDemoTask(session, "T1");
    session.state.phase = 5;
    session.state.action = undefined;
    session.refreshPlanTasks();
    session.markProgress();
    // The pilot ends its turn here and launches nothing: T2 is left waiting.
    session.signals.pilotIdleSince = Date.now();
    session.activity("system", t.incidentHandedBack);
    session.publish();
    session.signal();
    demoTerminal(session, t.incidentT1Done);
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
  const t = session.texts.demo;
  scheduleDemo(session, Math.max(200, demoStepDuration / 2), () => {
    pilotActs(session.signals, Date.now());
    session.state.action = t.actionDelegating;
    delegateDemoTask(session, "T2");
    session.refreshPlanTasks();
    session.markProgress();
    session.publish();
    session.signal();
    demoTerminal(session, t.incidentResuming);
  });
  scheduleDemo(session, demoStepDuration * 1.5, () => {
    finishDemoTask(session, "T2");
    session.state.phase = 10;
    session.state.action = undefined;
    session.state.status = "completed";
    session.state.endedAt = now();
    session.refreshPlanTasks();
    session.markProgress();
    session.activity("system", t.incidentCompleted, t.noRepositoryModified);
    session.publish();
    session.signal();
    demoTerminal(session, t.incidentT2Done);
  });
}

export function startDemoRun(session: RunSession) {
  localizeLaunch(session, "workflow");
  const t = session.texts.demo;
  // The simulated code has two versions: the one the first review measured, and the one after the rework.
  for (const id of Object.values(DEMO_SNAPSHOTS)) session.evidence.rememberSnapshot(id, session.state.startedAt ?? now());
  session.evidence.currentSnapshot = { id: DEMO_SNAPSHOTS.implementation, capturedAt: now() };
  session.activity("system", t.ticketLoaded, `${demoTicket(session).reference} · ${session.state.ticketTitle ?? t.ticketTitle}`);
  session.publish();
  demoTerminal(session, t.readingTicket);
  scheduleDemo(session, demoStepDuration, () => {
    session.state.artifacts = ["ticket-context.md"];
    session.activity("artifact", t.ticketContextConsolidated, "ticket-context.md");
    session.publish();
    demoTerminal(session, t.criteriaExtracted);
  });
  scheduleDemo(session, demoStepDuration * 2, () => {
    session.state.phase = 2;
    session.state.action = undefined;
    session.state.status = "attention";
    session.state.pendingQuestion = {
      id: `demo-question-${session.id}`,
      questions: [
        {
          header: t.questionBaseHeader,
          question: t.questionBase,
          options: [
            { label: "develop", description: t.optionDevelop },
            { label: "main", description: t.optionMain },
          ],
          multiSelect: false,
        },
        {
          header: t.questionNotificationsHeader,
          question: t.questionNotifications,
          options: [
            { label: t.optionHideEverything, description: t.optionHideEverythingDescription },
            { label: t.optionKeepCritical, description: t.optionKeepCriticalDescription },
          ],
          multiSelect: false,
        },
      ],
    };
    session.activity("attention", t.decisionsWaiting);
    session.publish();
    demoTerminal(session, t.waitingForDecisions);
  });
}

export function continueDemoRun(session: RunSession) {
  const t = session.texts.demo;
  const acceptance = demoAcceptanceOf(runLanguage(session.state));
  scheduleDemo(session, 0, () => {
    session.state.phase = 3;
    session.state.action = t.actionCreatingBranch;
    session.state.branch = demoTicket(session).branch;
    writeDemoDocument(session, "acceptance-criteria.json", JSON.stringify(acceptance.criteria, null, 2));
    session.activity("system", t.branchPrepared, session.state.branch);
    session.publish();
    demoTerminal(session, t.branchAndPlanPrepared);
  });
  scheduleDemo(session, demoStepDuration, () => {
    session.state.phase = 4;
    session.state.artifacts = [...session.state.artifacts, "implementation-plan.md", "planner-output.json"];
    session.state.planTasks = plannedTasks(demoDocument(session, "planner-output.json"));
    writeDemoDocument(session, "planner-output.json", demoDocument(session, "planner-output.json"));
    session.activity("artifact", t.planApproved, "implementation-plan.md");
    session.refreshPlanTasks();
    session.publish();
    demoTerminal(session, t.planSplit);
  });
  scheduleDemo(session, demoStepDuration * 2, () => {
    session.state.phase = 5;
    session.state.action = t.actionDelegating;
    delegateDemoTask(session, "T1");
    delegateDemoTask(session, "T2");
    session.refreshPlanTasks();
    session.publish();
    demoTerminal(session, t.delegatingImplementation);
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
    session.state.action = t.actionRunningTests;
    session.refreshPlanTasks();
    // The reviewers write their plan before they read what the authors concluded.
    session.state.artifacts = [...session.state.artifacts, "developer-report.md", "test-report.json", "assets/panneau-preferences.png", "qa-plan.md", "design-inventory.md"];
    session.artifactArrived("qa-plan.md", now());
    session.artifactArrived("design-inventory.md", now());
    writeDemoDocument(session, "assets/panneau-preferences.png", png(demoDocument(session, "assets/panneau-preferences.png")), false);
    writeDemoDocument(session, "dev-evidence.json", JSON.stringify(acceptance.developer, null, 2));
    session.state.evidenceUpdatedAt = now();
    session.activity("agent", t.implementationDone);
    session.publish();
    demoTerminal(session, t.checksDone);
  });
  scheduleDemo(session, demoStepDuration * 4, () => {
    session.state.phase = 7;
    session.state.agents = session.state.agents.map((agent) => agent.id === "demo-reviewer" ? { ...agent, status: "failed" as const, endedAt: now() } : agent);
    session.state.artifacts = [...session.state.artifacts, "senior-review-round-1.md"];
    writeDemoDocument(session, "assets/alerte-critique.png", png(acceptance.captures.roundOne), false);
    writeDemoDocument(session, "qa-evidence.json", JSON.stringify(acceptance.qaRoundOne, null, 2));
    session.activity("attention", t.reviewFixesRequested, t.reviewFixesDetail);
    session.publish();
    demoTerminal(session, t.reviewOneTerminal);
  });
  scheduleDemo(session, demoStepDuration * 5, () => {
    session.state.phase = 5;
    delegateDemoTask(session, "T4");
    session.refreshPlanTasks();
    session.activity("agent", t.developerResumes, t.applyingFindings);
    session.publish();
    demoTerminal(session, t.loopingBack);
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
    session.activity("agent", t.fixesVerified, t.fixesVerifiedDetail);
    session.publish();
    demoTerminal(session, t.fixesDone);
  });
  scheduleDemo(session, demoStepDuration * 7, () => {
    session.state.phase = 7;
    session.state.agents = session.state.agents.map((agent) => agent.id === "demo-reviewer" ? { ...agent, status: "completed" as const, endedAt: now() } : agent);
    session.state.artifacts = [...session.state.artifacts, "senior-review-round-2.md", "qa-report.md", "designer-review.md", "assets/reference-panneau-preferences.png"];
    session.artifactArrived("qa-report.md", now());
    session.artifactArrived("designer-review.md", now());
    writeDemoDocument(session, "assets/reference-panneau-preferences.png", png(demoDocument(session, "assets/reference-panneau-preferences.png")), false);
    writeDemoDocument(session, "design-evidence.json", JSON.stringify(acceptance.design, null, 2));
    writeDemoDocument(session, "qa-evidence-round1.json", JSON.stringify(acceptance.qaRoundOne, null, 2));
    writeDemoDocument(session, "assets/alerte-critique.png", png(acceptance.captures.roundTwo), false);
    writeDemoDocument(session, "qa-evidence.json", JSON.stringify(acceptance.qaRoundTwo, null, 2));
    // A second write, the way a review round overwrites the file: the badge has to light again.
    session.state.evidenceUpdatedAt = now();
    session.activity("agent", t.reviewTwoBlocked, t.reviewTwoBlockedDetail);
    session.publish();
    demoTerminal(session, t.reviewTwoTerminal);
  });
  scheduleDemo(session, demoStepDuration * 8, () => {
    session.state.phase = 8;
    session.state.artifacts = [...session.state.artifacts, "mr-description.md"];
    session.activity("artifact", t.draftPrepared, "mr-description.md");
    session.publish();
    demoTerminal(session, t.descriptionGenerated);
  });
  scheduleDemo(session, demoStepDuration * 9, () => {
    session.state.phase = 9;
    session.state.action = t.actionOpeningMergeRequest;
    session.state.mergeRequestUrl = `ticket-simule://${demoTicket(session).mergeRequest}`;
    refreshConfidence(session).catch(reportFailure("Review confidence not computed", session.id));
    session.activity("system", t.draftOpened, demoTicket(session).mergeRequest);
    session.activity("system", t.reportPublished, t.reportPublishedDetail);
    session.publish();
    demoTerminal(session, t.finalReportPublished);
  });
  scheduleDemo(session, demoStepDuration * 10, () => {
    session.state.phase = 10;
    session.state.action = undefined;
    session.state.status = "completed";
    session.state.endedAt = now();
    session.activity("system", t.demoCompleted, t.noRepositoryModified);
    session.publish();
    demoTerminal(session, t.draftReady);
  });
  scheduleDemo(session, demoStepDuration * 11, () => {
    const worktreeName = `demo-self-improvement-${crypto.randomUUID().slice(0, 8)}`;
    demoState.pendingImprovement = { worktreeName, commits: 1, status: "ready" };
    session.activity("agent", t.improvementsReady);
    session.publish();
    demoTerminal(session, t.selfAuditCompleted);
  });
}
