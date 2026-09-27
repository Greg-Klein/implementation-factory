import { actionLabel, agentIdentity, agentRole, agentStopTarget, branchFromCommand, createsBranch, createsMergeRequest, isDeveloperDelegation, mergeRequestUrl, pairDelegation, normalizeAnswers, phaseForAgent, runInProgress } from "./domain.js";
import { now } from "./context.js";
import { continueDemoRun } from "./demo.js";
import { scheduleAutonomousReview } from "./self-improvement.js";
import { engine } from "./engine/index.js";
import type { EngineEvent } from "./engine/index.js";
import type { RunSession } from "./run-session.js";

function advancePhase(session: RunSession, phase: number) {
  session.state.phase = Math.max(session.state.phase, phase);
}

/** The agent resumed on its own, so the call for attention no longer holds. */
function resumeFromAttention(session: RunSession) {
  if (session.state.status === "attention" && !session.state.pendingQuestion) session.state.status = "running";
}

function rememberBranch(session: RunSession, command: string | undefined) {
  const branch = branchFromCommand(command);
  if (!branch || session.state.branch === branch) return;
  session.state.branch = branch;
  session.activity("system", "Branche de travail", branch);
}

/** The merge request is the deliverable of the run, and its address exists nowhere but in the output of the command that opened it. */
function rememberMergeRequest(session: RunSession, toolResponse: unknown) {
  if (session.state.mergeRequestUrl) return;
  const url = mergeRequestUrl(toolResponse);
  if (!url) return;
  session.state.mergeRequestUrl = url;
  advancePhase(session, 9);
  session.activity("system", "Merge request ouverte", url);
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
  session.state.pendingQuestion = { id: event.id ?? crypto.randomUUID(), questions: event.questions };
  // A finished run keeps its outcome: putting it back in progress would have
  // the next turn end close it again, a second time, with a second self-audit.
  if (runInProgress(session.state.status)) session.state.status = "attention";
  session.state.action = undefined;
  session.activity("attention", event.questions.length > 1 ? `${event.questions.length} décisions attendent ta réponse` : "Une décision attend ta réponse");

  return new Promise<unknown>((resolve) => {
    session.resolvePendingQuestion = resolve;
    session.publish();
  });
}

export function answerQuestion(session: RunSession, answers: Record<string, string>) {
  if (!session.state.pendingQuestion) throw new Error("Aucune question n'attend de réponse.");
  const normalizedAnswers = normalizeAnswers(session.state.pendingQuestion.questions, answers);
  if (!normalizedAnswers) throw new Error("Réponds à chaque question avant de continuer.");
  if (!session.pendingQuestionInput || !session.resolvePendingQuestion) {
    if (!session.demo) throw new Error(`Le pont de réponse avec ${engine.label} n'est plus actif.`);
    session.state.pendingQuestion = undefined;
    if (session.state.status === "attention") session.state.status = "running";
    session.activity("system", "Réponses reçues", Object.values(normalizedAnswers).join(" · "));
    session.publish();
    continueDemoRun(session);
    return;
  }

  const resolve = session.resolvePendingQuestion;
  const output = engine.questionAnswer(session.pendingQuestionInput, normalizedAnswers);
  session.resolvePendingQuestion = null;
  session.pendingQuestionInput = null;
  session.state.pendingQuestion = undefined;
  if (session.state.status === "attention") session.state.status = "running";
  session.activity("system", `Réponse transmise à ${engine.label}`);
  session.publish();
  resolve(output);
}

export function clearPendingQuestion(session: RunSession) {
  session.resolvePendingQuestion?.();
  session.resolvePendingQuestion = null;
  session.pendingQuestionInput = null;
  session.state.pendingQuestion = undefined;
}

function apply(session: RunSession, event: EngineEvent) {
  if (event.kind === "agent.start") {
    const known = session.state.agents.find((agent) => agent.id === event.agentId);
    const identity = known?.nickname ? { nickname: known.nickname, avatar: known.avatar } : agentIdentity(session.state.agents.length);
    session.state.agents = [{ id: event.agentId, name: event.agentName, ...identity, role: agentRole(event.agentName), status: "running", startedAt: now() }, ...session.state.agents.filter((agent) => agent.id !== event.agentId)];
    if (!known && session.state.planDelegations) session.state.planDelegations = pairDelegation(session.state.planDelegations, event.agentName, event.agentId);
    session.refreshPlanTasks();
    session.activity("agent", `${event.agentName} démarre`);
    advancePhase(session, phaseForAgent(event.agentName));
    resumeFromAttention(session);
    return;
  }
  if (event.kind === "agent.stop") {
    const stopped = agentStopTarget(session.state.agents, event.agentId, event.agentName);
    // The session is alive either way, but an unattributable stop must not
    // announce an agent finishing that the feed never saw start.
    if (stopped) {
      session.state.agents = session.state.agents.map((agent) => agent.id === stopped.id ? { ...agent, status: "completed" as const, endedAt: now() } : agent);
      session.activity("agent", `${stopped.name} termine`);
    }
    resumeFromAttention(session);
    return;
  }
  if (event.kind === "agent.kill") {
    const killed = session.state.agents.find((agent) => agent.id === event.agentId && agent.status === "running");
    if (killed) {
      session.state.agents = session.state.agents.map((agent) => agent.id === killed.id ? { ...agent, status: "abandoned" as const, endedAt: now() } : agent);
      session.activity("agent", `${killed.name} arrêté`);
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
      session.state.planDelegations = [...session.state.planDelegations ?? [], { agentType: event.target ?? "", taskIds: event.planTaskIds }];
      session.refreshPlanTasks();
    }
    if (createsBranch(event.command)) {
      advancePhase(session, 3);
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
    session.activity("attention", `${engine.label} attend ton attention`, event.message);
    return;
  }
  // The turn ends every time the agent hands back, including while it waits for
  // a background agent: the workflow is only over when nothing is still running.
  session.state.action = undefined;
  if (session.state.agents.some((agent) => agent.status === "running")) {
    session.state.status = "running";
    session.activity("agent", "Tour terminé, un agent continue en tâche de fond");
    return;
  }
  if (session.state.phase >= 9) session.state.phase = 10;
  session.state.status = session.state.phase >= 10 ? "completed" : "attention";
  // The workflow, not the session, decides when the run ended: the session then
  // sits idle at its prompt and may be killed much later.
  if (session.state.status === "completed") session.state.endedAt = now();
  session.activity("attention", session.state.phase >= 10 ? "Workflow terminé" : `${engine.label} attend une réponse`);
  if (session.state.phase >= 10) scheduleAutonomousReview(session);
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
  const event = engine.event((body.payload ?? {}) as Record<string, unknown>);
  if (!event) return;
  // A question publishes its own state from inside the promise it hands back,
  // and that promise is what keeps the agent waiting. It is raised even once
  // the workflow is over: the user can keep talking to the idle session, and a
  // question dropped here would only ever show in the terminal.
  if (event.kind === "question") return waitForQuestionAnswer(session, event);
  // A finished run keeps receiving events while the session sits idle at its
  // prompt, and an idle notification must not put it back in progress.
  if (!inProgress) return;
  apply(session, event);
  session.publish();
}
