import { defined } from "../lib/defined.js";
import { actionLabel, agentIdentity, forgeOf, agentRole, agentStopTarget, branchFromCommand, createsBranch, createsMergeRequest, delegatedTasks, isDeveloperDelegation, mergeRequestUrl, pairDelegation, normalizeAnswers, phaseForAgent, runInProgress } from "./domain.js";
import { now, reportFailure } from "./context.js";
import { continueDemoRun } from "./demo.js";
import { scheduleAutonomousReview } from "./self-improvement.js";
import { engine } from "./engine/index.js";
import type { EngineEvent } from "./engine/index.js";
import { recordEngineSignal } from "./run-health.js";
import { declaredCompletion } from "./workflow-state.js";
import { sessionStarted } from "./session-prompt.js";
import { recordRunMetrics } from "./run-metrics-runtime.js";
import type { RunSession } from "./run-session.js";

/**
 * Closes the run once the workflow is over: the pilot handed control back,
 * nothing it launched is still running, and either the last phase was reached
 * or the workflow declared an end that holds against what the run shows.
 * Reaching the last phase is not an end while a command the pilot left in the
 * background has yet to wake it: the review comment and the archive still follow.
 */
export function closeWorkflowIfDone(session: RunSession) {
  if (!runInProgress(session.state.status) || session.state.pendingQuestion) return false;
  if (session.signals.pilotIdleSince === undefined || session.state.agents.some((agent) => agent.status === "running")) return false;
  const declared = declaredCompletion(session.state.workflow, session.state.mergeRequestUrl).complete;
  if (!declared && (Math.max(session.state.phase, session.inferredPhase) < 9 || session.signals.backgroundWaits.size > 0)) return false;
  session.state.phase = 10;
  session.state.status = "completed";
  session.state.action = undefined;
  // The workflow, not the session, decides when the run ended: the session then
  // sits idle at its prompt and may be killed much later.
  session.state.endedAt = now();
  session.markProgress();
  session.activity("attention", "Workflow completed");
  // The figures of the run as delivered; the session's exit writes them once more, final.
  recordRunMetrics(session).catch(reportFailure("Run metrics not recorded", session.id));
  scheduleAutonomousReview(session);
  return true;
}

/** The agent resumed on its own, so the call for attention no longer holds. */
function resumeFromAttention(session: RunSession) {
  if (session.state.status === "attention" && !session.state.pendingQuestion) session.state.status = "running";
}

function rememberBranch(session: RunSession, command: string | undefined) {
  const branch = branchFromCommand(command);
  if (!branch || session.state.branch === branch) return;
  session.state.branch = branch;
  session.activity("system", "Working branch", branch);
}

/** The merge request is the deliverable of the run, and its address exists nowhere but in the output of the command that opened it. */
function rememberMergeRequest(session: RunSession, toolResponse: unknown) {
  if (session.state.mergeRequestUrl) return;
  const url = mergeRequestUrl(toolResponse);
  if (!url) return;
  session.state.mergeRequestUrl = url;
  session.markProgress();
  session.inferPhase(9);
  session.activity("system", forgeOf(url) === "github" ? "Pull request opened" : "Merge request opened", url);
}

/**
 * Parks the agent until the user answers in the interface. The promise is what
 * keeps it waiting, and resolving it is what lets it go: whichever engine is
 * driving, it must be able to wait on this. One promise per run, so a decision
 * raised by one run never releases the agent of another.
 */
function waitForQuestionAnswer(session: RunSession, event: Extract<EngineEvent, { kind: "question" }>) {
  if (session.resolvePendingQuestion) return undefined;
  session.pendingQuestionInput = event.input;
  session.state.pendingQuestion = { id: event.id ?? crypto.randomUUID(), questions: event.questions, askedAt: now() };
  // A finished run keeps its outcome: putting it back in progress would have
  // the next turn end close it again, a second time, with a second self-audit.
  if (runInProgress(session.state.status)) session.state.status = "attention";
  session.state.action = undefined;
  session.activity("attention", event.questions.length > 1 ? `${event.questions.length} decisions are waiting for your answer` : "A decision is waiting for your answer");

  return new Promise<unknown>((resolve) => {
    session.resolvePendingQuestion = resolve;
    session.publish();
    session.signal();
  });
}

export function answerQuestion(session: RunSession, answers: Record<string, string>) {
  if (!session.state.pendingQuestion) throw new Error("No question is waiting for an answer.");
  const normalizedAnswers = normalizeAnswers(session.state.pendingQuestion.questions, answers);
  if (!normalizedAnswers) throw new Error("Answer every question before continuing.");
  if (!session.pendingQuestionInput || !session.resolvePendingQuestion) {
    if (!session.demo) throw new Error(`The answer bridge with ${engine.label} is no longer active.`);
    session.state.pendingQuestion = undefined;
    if (session.state.status === "attention") session.state.status = "running";
    session.activity("system", "Answers received", Object.values(normalizedAnswers).join(" · "));
    session.markProgress();
    session.publish();
    session.signal();
    continueDemoRun(session);
    return;
  }

  const resolve = session.resolvePendingQuestion;
  const output = engine.questionAnswer(session.pendingQuestionInput, normalizedAnswers);
  session.resolvePendingQuestion = null;
  session.pendingQuestionInput = null;
  session.state.pendingQuestion = undefined;
  if (session.state.status === "attention") session.state.status = "running";
  session.activity("system", `Answer sent to ${engine.label}`);
  session.markProgress();
  session.publish();
  session.signal();
  resolve(output);
}

export function clearPendingQuestion(session: RunSession) {
  session.resolvePendingQuestion?.();
  session.resolvePendingQuestion = null;
  session.pendingQuestionInput = null;
  session.state.pendingQuestion = undefined;
}

/**
 * The session stopped waiting for an answer: the hook request that carried the
 * question closed before anyone answered (the hook was interrupted, or timed
 * out). Left in place, the question could no longer be answered, hid every
 * later one and kept the run from ever closing.
 */
export function withdrawQuestion(session: RunSession, questionId: string) {
  if (session.state.pendingQuestion?.id !== questionId) return false;
  clearPendingQuestion(session);
  if (session.state.status === "attention") session.state.status = "running";
  session.activity("system", "Question withdrawn", `${engine.label} stopped waiting for the answer.`);
  session.publish();
  session.signal();
  return true;
}

function apply(session: RunSession, event: EngineEvent) {
  // Read off the terminal, never carried by a hook: see session-prompt.ts.
  if (event.kind === "session.prompt" || event.kind === "session.prompt.end") return;
  recordEngineSignal(session.signals, event, Date.now(), event.kind === "tool.start" ? actionLabel(event.tool, event.command, event.target) : undefined);
  if (event.kind === "agent.start") {
    const known = session.state.agents.find((agent) => agent.id === event.agentId);
    const identity = known?.nickname ? { nickname: known.nickname, ...defined({ avatar: known.avatar }) } : agentIdentity(session.state.agents.length);
    session.state.agents = [{ id: event.agentId, name: event.agentName, ...identity, role: agentRole(event.agentName), status: "running", startedAt: now() }, ...session.state.agents.filter((agent) => agent.id !== event.agentId)];
    if (!known && session.state.planDelegations) session.state.planDelegations = pairDelegation(session.state.planDelegations, event.agentName, event.agentId);
    session.refreshPlanTasks();
    session.activity("agent", `${event.agentName} starts`);
    session.inferPhase(phaseForAgent(event.agentName));
    resumeFromAttention(session);
    return;
  }
  if (event.kind === "agent.stop") {
    const stopped = agentStopTarget(session.state.agents, event.agentId, event.agentName);
    // The session is alive either way, but an unattributable stop must not
    // announce an agent finishing that the feed never saw start.
    if (stopped) {
      session.state.agents = session.state.agents.map((agent) => agent.id === stopped.id ? { ...agent, status: "completed" as const, endedAt: now() } : agent);
      session.activity("agent", `${stopped.name} finishes`);
    }
    resumeFromAttention(session);
    return;
  }
  if (event.kind === "agent.kill") {
    const killed = session.state.agents.find((agent) => agent.id === event.agentId && agent.status === "running");
    if (killed) {
      session.state.agents = session.state.agents.map((agent) => agent.id === killed.id ? { ...agent, status: "abandoned" as const, endedAt: now() } : agent);
      session.activity("agent", `${killed.name} stopped`);
    }
    resumeFromAttention(session);
    return;
  }
  // A tool call is not a milestone: two hundred of them in a run bury the dozen
  // events that tell what the workflow did. The terminal panel keeps the detail;
  // what the feed takes from a tool call is the branch it creates. The call does
  // say what the agent is doing at this instant, and that goes to the live
  // indicator, which holds one line and forgets it.
  if (event.kind === "tool.start") {
    session.state.action = actionLabel(event.tool, event.command, event.target);
    if (event.planTaskIds && isDeveloperDelegation(event.target)) {
      session.state.planDelegations = [...session.state.planDelegations ?? [], { agentType: event.target ?? "", taskIds: delegatedTasks(event.planTaskIds, session.state.artifacts) }];
      session.refreshPlanTasks();
    }
    if (createsBranch(event.command)) {
      session.inferPhase(3);
      rememberBranch(session, event.command);
    }
    resumeFromAttention(session);
    return;
  }
  if (event.kind === "tool.end") {
    if (createsMergeRequest(event.command)) rememberMergeRequest(session, event.response);
    resumeFromAttention(session);
    return;
  }
  if (event.kind === "attention") {
    session.state.status = "attention";
    session.state.action = undefined;
    const title = event.cause === "permission" ? "Waiting for permission in the terminal" : event.cause === "terminal_interaction" ? "Waiting for input in the terminal" : `${engine.label} is waiting for your attention`;
    session.activity("attention", title, event.message);
    return;
  }
  // The turn ends every time the agent hands back, including while it waits for
  // a background agent: the workflow is only over when nothing is still running.
  session.state.action = undefined;
  if (session.state.agents.some((agent) => agent.status === "running")) {
    session.state.status = "running";
    session.activity("agent", "Turn ended, an agent continues in the background");
    return;
  }
  if (closeWorkflowIfDone(session)) return;
  // A hand-back mid-workflow is not a verdict yet: it may be a wait the console
  // cannot see, or nothing left to do. The health monitor tells the two apart
  // after a grace period, with an incident when nothing is going to happen.
  session.state.status = "running";
  session.activity("system", `${engine.label} handed back`);
}

/**
 * One hook payload, applied to the run that emitted it. Every hook carries the
 * run it belongs to (`IMPL_RUN_ID` in the session environment), which is what
 * lets several sessions post to the same local server without their events
 * landing on each other's run.
 */
export function processHook(session: RunSession, body: Record<string, unknown>) {
  const inProgress = runInProgress(session.state.status);
  if (!inProgress && !session.state.sessionActive) return;
  // Any hook proves the session runs, the one of its start included, which names no event of the factory.
  const started = sessionStarted(session);
  const event = engine.event((body.payload ?? {}) as Record<string, unknown>);
  if (!event) {
    if (started) { session.publish(); session.signal(); }
    return;
  }
  // A question publishes its own state from inside the promise it hands back,
  // and that promise is what keeps the agent waiting. It is raised even once
  // the workflow is over: the user can keep talking to the idle session, and a
  // question dropped here would only ever show in the terminal.
  if (event.kind === "question") {
    recordEngineSignal(session.signals, event, Date.now());
    return waitForQuestionAnswer(session, event);
  }
  // A finished run keeps receiving events while the session sits idle at its
  // prompt, and an idle notification must not put it back in progress.
  if (!inProgress) return;
  apply(session, event);
  session.publish();
  session.signal();
}
