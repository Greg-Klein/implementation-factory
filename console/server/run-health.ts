import path from "node:path";
import type { EngineEvent } from "./engine/types.js";
import type { AgentState, IncidentAction, IncidentKind, IncidentObservation, PlanDelegation, PlanTask, RunHealth, RunStatus, RunWait, WaitReason, WorkflowState } from "./types.js";
import { declaredCompletion } from "./workflow-state.js";

/**
 * Who can move a run forward right now, from what the console actually
 * observed. Pure: the clock and the thresholds are parameters, so every rule
 * is testable without waiting.
 *
 * The rules lean one way on purpose. Silence alone is a doubt
 * (`suspected_stall`), never an incident: a test suite or a background agent
 * can be quiet for twenty minutes. An incident needs a positive observation:
 * the pilot handed control back and nothing identifiable is going to wake it
 * up, a producer finished without the file its contract requires, or the
 * session went away before the workflow reached a result.
 */

export type HealthPolicy = {
  /** How often the monitor looks at every live run. */
  tickMs: number;
  /** How long a pilot may sit at its prompt with nothing pending before it is an incident. */
  turnEndGraceMs: number;
  /** How long a required file may lag behind the end of the agent that writes it (archiving is not instant). */
  artifactGraceMs: number;
  /** Silence after which the console voices a doubt, and nothing more. */
  suspicionMs: number;
  /** After the machine slept, every clock restarts from the wake-up for this long. */
  resumeGraceMs: number;
};

export const DEFAULT_HEALTH_POLICY: HealthPolicy = {
  tickMs: 15_000,
  turnEndGraceMs: 60_000,
  artifactGraceMs: 30_000,
  suspicionMs: 10 * 60_000,
  resumeGraceMs: 120_000,
};

/** A gap this much longer than a tick means the process was frozen: a laptop lid, a debugger. */
export function wokeUpFromSuspension(previousTick: number | undefined, now: number, policy: HealthPolicy) {
  return previousTick !== undefined && now - previousTick > policy.tickMs * 4;
}

/**
 * Everything the console observed about a live run beyond its state: kept on
 * the session, in memory only. After a restart none of it proves anything,
 * which is why a restored run is never evaluated as live.
 */
export type RunSignals = {
  /** A hook, or the transcript growing: the session executes something. */
  lastExecutionAt: number;
  /** Something the workflow produced: an agent, a phase, a document, an answer, a merge request. */
  lastProgressAt: number;
  /** Terminal output. A spinner is output, never progress: kept apart, and never used to clear a doubt. */
  lastOutputAt: number;
  /** Set when the pilot handed control back, cleared as soon as it acts again. */
  pilotIdleSince?: number;
  /** The last time the pilot itself did something: whatever ended before that, it has taken over. */
  pilotLastActedAt?: number;
  /** The pilot, or the user in the terminal, said something after that turn ended. */
  permission?: { since: number; message?: string };
  terminalInteraction?: { since: number; message?: string };
  /** A call for attention whose cause the agent did not give. */
  unexplainedAttention?: { since: number; message?: string };
  /** Calls whose end the agent reports, by call id: a foreground command in the pilot or in a subagent. */
  activeTools: Map<string, { tool: string; agentId?: string; since: number; label?: string }>;
  /** Calls that return at once and wake the pilot later. They last until the pilot wakes up. */
  backgroundWaits: Map<string, { tool: string; since: number; label?: string }>;
  /** When the machine was seen waking up, so no grace is measured across the sleep. */
  resumedAt?: number;
  /** The session exited: when, and with which code. */
  exit?: { at: number; code: number };
};

export function createSignals(now: number): RunSignals {
  return { lastExecutionAt: now, lastProgressAt: now, lastOutputAt: now, activeTools: new Map(), backgroundWaits: new Map() };
}

function clearHumanWaits(signals: RunSignals) {
  signals.permission = undefined;
  signals.terminalInteraction = undefined;
  signals.unexplainedAttention = undefined;
}

/** The pilot acts again: it is no longer idle, and whatever it was waiting for in the background has woken it. */
export function pilotActs(signals: RunSignals, now: number) {
  if (signals.pilotIdleSince !== undefined) signals.backgroundWaits.clear();
  signals.pilotIdleSince = undefined;
  signals.pilotLastActedAt = now;
  signals.lastExecutionAt = now;
}

/**
 * Updates the signals with one event of the engine. Only facts the event
 * carries are recorded: a call without an identifier is not tracked, and a
 * call whose end is never reported ends with its caller's turn.
 */
export function recordEngineSignal(signals: RunSignals, event: EngineEvent, now: number, label?: string) {
  // A prompt before the session starts is no execution: the run state carries it, not the signals.
  if (event.kind === "session.prompt" || event.kind === "session.prompt.end") return;
  signals.lastExecutionAt = now;
  if (event.kind === "attention") {
    const entry = { since: now, ...(event.message ? { message: event.message } : {}) };
    if (event.cause === "permission") signals.permission = entry;
    else if (event.cause === "terminal_interaction") signals.terminalInteraction = entry;
    else signals.unexplainedAttention = entry;
    return;
  }
  // Anything the session does after a prompt means the prompt was answered.
  clearHumanWaits(signals);
  if (event.kind === "agent.start" || event.kind === "agent.stop" || event.kind === "agent.kill") {
    signals.lastProgressAt = now;
    if (event.kind !== "agent.start") for (const [id, tool] of signals.activeTools) if (tool.agentId === event.agentId) signals.activeTools.delete(id);
    return;
  }
  if (event.kind === "tool.start") {
    if (!event.agentId) pilotActs(signals, now);
    if (!event.toolUseId) return;
    if (event.background && !event.agentId) signals.backgroundWaits.set(event.toolUseId, { tool: event.tool, since: now, ...(label ? { label } : {}) });
    else if (event.endReported) signals.activeTools.set(event.toolUseId, { tool: event.tool, since: now, ...(event.agentId ? { agentId: event.agentId } : {}), ...(label ? { label } : {}) });
    return;
  }
  if (event.kind === "tool.end") {
    if (event.toolUseId) signals.activeTools.delete(event.toolUseId);
    return;
  }
  if (event.kind === "question") {
    if (signals.pilotIdleSince !== undefined) pilotActs(signals, now);
    return;
  }
  // turn.end: the pilot's own calls end with its turn, reported or not.
  signals.pilotIdleSince = now;
  for (const [id, tool] of signals.activeTools) if (!tool.agentId) signals.activeTools.delete(id);
}

/**
 * The files an agent's contract requires, by agent type. A reviewer that only
 * answers in chat (senior-reviewer) requires none, and a developer requires the
 * report of each plan task it was handed.
 */
const PRODUCER_CONTRACTS: Record<string, string[]> = {
  "ticket-planner": ["planner-output.json"],
  "qa-reviewer": ["qa-report.md", "qa-evidence.json", "qa-plan.md"],
  "designer-reviewer": ["designer-review.md", "design-evidence.json", "design-inventory.md"],
  "review-orchestrator": ["review-summary.md"],
};

function agentType(name: string) {
  return name.slice(name.lastIndexOf(":") + 1);
}

export function requiredFiles(agent: Pick<AgentState, "id" | "name">, delegations: PlanDelegation[]) {
  const type = agentType(agent.name);
  if (type === "developer") return delegations.filter((delegation) => delegation.agentId === agent.id).flatMap((delegation) => delegation.taskIds.map((taskId) => `developer-report-${taskId}.md`));
  return PRODUCER_CONTRACTS[type] ?? [];
}

/**
 * The plan tasks nothing can ever start: a dependency on a task the plan does
 * not have, or a cycle. Only reported when no remaining task is executable,
 * since a plan with one bad edge and work left elsewhere is not blocked yet.
 */
export function blockedDependencies(tasks: Pick<PlanTask, "id" | "status" | "dependencies">[]): { unknown: { task: string; missing: string }[]; cycle: string[] } | undefined {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const remaining = tasks.filter((task) => task.status !== "done");
  if (remaining.length === 0) return undefined;
  const executable = remaining.some((task) => (task.dependencies ?? []).every((dependency) => byId.get(dependency)?.status === "done"));
  if (executable) return undefined;
  const unknown = remaining.flatMap((task) => (task.dependencies ?? []).filter((dependency) => !byId.has(dependency)).map((missing) => ({ task: task.id, missing })));
  const cycle: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, trail: string[]): boolean => {
    if (state.get(id) === "done") return false;
    if (state.get(id) === "visiting") { cycle.push(...trail.slice(trail.indexOf(id))); return true; }
    state.set(id, "visiting");
    for (const dependency of byId.get(id)?.dependencies ?? []) if (byId.has(dependency) && byId.get(dependency)!.status !== "done" && visit(dependency, [...trail, dependency])) return true;
    state.set(id, "done");
    return false;
  };
  for (const task of remaining) if (visit(task.id, [task.id])) break;
  if (unknown.length === 0 && cycle.length === 0) return undefined;
  return { unknown, cycle: [...new Set(cycle)] };
}

export type HealthInput = {
  status: RunStatus;
  sessionActive: boolean;
  stoppedBy: "user" | "queue" | null;
  pendingQuestion: boolean;
  /** The session waits on a prompt of its own, the folder trust dialog, answered from the console. */
  sessionPrompt?: boolean;
  agents: Pick<AgentState, "id" | "name" | "status" | "startedAt" | "endedAt">[];
  artifacts: string[];
  planTasks?: Pick<PlanTask, "id" | "status" | "dependencies">[];
  planDelegations?: PlanDelegation[];
  mergeRequestUrl?: string;
  workflow?: WorkflowState;
  signals: Pick<RunSignals, "lastExecutionAt" | "lastProgressAt" | "pilotIdleSince" | "pilotLastActedAt" | "permission" | "terminalInteraction" | "unexplainedAttention" | "resumedAt" | "exit"> & {
    activeTools: { tool: string; agentId?: string; since: number; label?: string }[];
    backgroundWaits: { tool: string; since: number; label?: string }[];
  };
};

export type IncidentCandidate = {
  kind: IncidentKind;
  fingerprint: string;
  title: string;
  reason: string;
  observations: IncidentObservation[];
  expectedNextAction?: string;
  suggestedActions: IncidentAction[];
};

export type HealthVerdict = { health: RunHealth; wait?: RunWait; title?: string; detail?: string; incident?: IncidentCandidate };

const clock = (at: number) => new Date(at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
const iso = (at: number) => new Date(at).toISOString();
/** "10 minutes", "1 minute", "40 seconds": the silence as a duration. */
function duration(ms: number) {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1_000))} second${ms >= 1_500 ? "s" : ""}`;
  const count = Math.round(ms / 60_000);
  return `${count} minute${count > 1 ? "s" : ""}`;
}

function waiting(reason: WaitReason, since: number, title: string, detail: string, on?: string, liftedBy?: string): HealthVerdict {
  return { health: "waiting", wait: { reason, since: iso(since), ...(on ? { on } : {}), ...(liftedBy ? { liftedBy } : {}) }, title, detail };
}

/** "developer-report-T3.md" reads better as the report it is. */
function fileLabel(file: string) {
  const name = path.basename(file);
  if (name === "qa-plan.md") return "QA test plan";
  if (name === "design-inventory.md") return "Design inventory";
  if (name.startsWith("qa-")) return "QA report";
  if (name.startsWith("design")) return "Design report";
  if (name.startsWith("developer-report-")) return `Report of ${name.slice("developer-report-".length, -".md".length)}`;
  if (name === "planner-output.json") return "Plan";
  if (name === "review-summary.md") return "Review summary";
  return name;
}

const LIVE_ACTIONS: IncidentAction[] = ["open_terminal", "request_continuation", "view_diagnostic", "stop", "dismiss"];

/**
 * The matrix of section B4 of the plan. Order matters: an explicit human wait
 * beats everything, an agent or a command at work beats every incident, and
 * among incidents a precise one (a missing file, a broken plan) beats the
 * generic "nothing next".
 */
export function evaluateRunHealth(input: HealthInput, now: number, policy: HealthPolicy = DEFAULT_HEALTH_POLICY): HealthVerdict {
  const signals = input.signals;
  // No grace is ever measured across a sleep of the machine.
  const after = (at: number) => Math.max(at, signals.resumedAt ?? 0);
  const quietFor = now - after(Math.max(signals.lastExecutionAt, signals.lastProgressAt));

  if (input.status === "completed" || input.status === "stopped" || input.status === "idle") return { health: "healthy" };
  if (input.status === "failed") {
    if (!signals.exit || input.stoppedBy) return { health: "healthy" };
    const exit = signals.exit;
    return {
      health: "interrupted", title: "Session interrupted",
      detail: `The session stopped at ${clock(exit.at)} before the workflow reached a result.`,
      incident: {
        kind: "lost_session", fingerprint: `lost_session:${exit.at}`,
        title: "Session interrupted",
        reason: `The Claude Code session stopped with code ${exit.code} before the workflow reached a result.`,
        observations: [
          { kind: "exit", at: iso(exit.at), detail: `Process exit, code ${exit.code}.` },
          ...(signals.pilotIdleSince !== undefined ? [{ kind: "turn", at: iso(signals.pilotIdleSince), detail: "Last pilot turn ended." }] : []),
          { kind: "progress", at: iso(signals.lastProgressAt), detail: "Last progress observed." },
        ],
        expectedNextAction: "Read the diagnostic, then relaunch the ticket if the work must continue.",
        suggestedActions: ["view_diagnostic", "dismiss"],
      },
    };
  }
  if (input.status === "starting" || !input.sessionActive) return { health: "healthy" };

  if (input.sessionPrompt) return waiting("user_question", now, "Waiting for a decision", "Claude Code asks to trust the folder before starting.", "you", "your answer");
  if (input.pendingQuestion) return waiting("user_question", now, "Waiting for a decision", "The workflow is waiting for your answer to continue.", "you", "your answer");
  if (signals.permission) return waiting("permission", signals.permission.since, "Waiting for permission", signals.permission.message ?? "Claude Code is waiting for your approval in the terminal.", "you", "your approval in the terminal");
  if (signals.terminalInteraction) return waiting("terminal_interaction", signals.terminalInteraction.since, "Waiting for input in the terminal", signals.terminalInteraction.message ?? "Claude Code is waiting for an answer only the terminal can receive.", "you", "your input in the terminal");
  if (signals.unexplainedAttention) return waiting("unknown", signals.unexplainedAttention.since, "Claude Code asks for your attention", signals.unexplainedAttention.message ?? "The signal does not say why: look at the terminal.", "you");

  const running = input.agents.filter((agent) => agent.status === "running");
  const suspicion = (detail: string): HealthVerdict => ({ health: "suspected_stall", title: "No progress observed", detail: `No new progress observed for ${duration(quietFor)}. ${detail}` });

  if (running.length > 0) {
    if (quietFor >= policy.suspicionMs) return suspicion(running.length > 1 ? `${running.length} agents are still declared active.` : "One agent is still declared active.");
    const names = running.map((agent) => agentType(agent.name)).join(", ");
    return signals.pilotIdleSince !== undefined
      ? waiting("agent", signals.pilotIdleSince, running.length > 1 ? `Waiting for ${running.length} agents` : "Waiting for an agent", names, names, "the agent finishing")
      : { health: "healthy" };
  }
  if (signals.activeTools.length > 0) {
    if (quietFor >= policy.suspicionMs) return suspicion(`A command is still running (${signals.activeTools[0].label ?? signals.activeTools[0].tool}).`);
    return { health: "healthy" };
  }
  if (signals.pilotIdleSince === undefined) {
    if (quietFor >= policy.suspicionMs) return suspicion("Claude Code has not handed back, but has not reported anything either.");
    return { health: "healthy" };
  }

  // The pilot handed control back, and no agent or command of its own is at work.
  const idleSince = signals.pilotIdleSince;
  // An agent ending wakes the pilot up: the grace runs from the last thing that could have woken it.
  const lastAgentEnd = Math.max(0, ...input.agents.flatMap((agent) => agent.endedAt ? [new Date(agent.endedAt).getTime()] : []));
  const idleFor = now - after(Math.max(idleSince, lastAgentEnd));
  const workflow = input.workflow;
  const declared = workflow?.nextAction;
  if (signals.backgroundWaits.length > 0) {
    const wait = signals.backgroundWaits[0];
    if (quietFor >= policy.suspicionMs) return suspicion(`Claude Code is still waiting for ${wait.label ?? wait.tool} in the background.`);
    return waiting("tool", wait.since, "Waiting for a background task", wait.label ?? wait.tool, wait.label ?? wait.tool, "the background task finishing");
  }
  // A wait the workflow declares on something the console cannot see: a process, a dependency. Trusted until the doubt threshold, never beyond.
  if (workflow?.state === "waiting" && declared && (declared.kind === "await_process" || declared.kind === "await_dependency") && !(declared.expectedArtifact && input.artifacts.includes(declared.expectedArtifact))) {
    const reason: WaitReason = declared.kind === "await_process" ? "tool" : "dependency";
    if (quietFor >= policy.suspicionMs) return suspicion(`The workflow declares it is waiting: ${declared.description ?? declared.kind}.`);
    return waiting(reason, idleSince, "Wait declared by the workflow", declared.description ?? declared.kind, declared.description, declared.expectedArtifact);
  }
  const completion = declaredCompletion(workflow, input.mergeRequestUrl);
  if (completion.complete) return { health: "healthy" };

  const observations: IncidentObservation[] = [
    { kind: "turn", at: iso(idleSince), detail: `Claude Code handed back at ${clock(idleSince)}.` },
    { kind: "agents", detail: "No active agent." },
    { kind: "question", detail: "No pending question or permission." },
  ];
  if (!workflow) observations.push({ kind: "workflow", detail: "No workflow-state.json: the workflow does not declare its next step (old or custom prompt)." });
  else observations.push({ kind: "workflow", at: workflow.receivedAt, detail: `The workflow declares itself "${workflow.state}"${workflow.step ? ` at step ${workflow.step}` : ""}${declared ? `, next action ${declared.kind}${declared.description ? `: ${declared.description}` : ""}` : ""}.` });
  if (declared?.kind === "await_agent") observations.push({ kind: "declared_wait", detail: `Wait declared${declared.agents.length ? ` on ${declared.agents.join(", ")}` : ""}${declared.taskIds.length ? ` for ${declared.taskIds.join(", ")}` : ""}, but no agent is running.` });
  if (completion.problem) observations.push({ kind: "completion", detail: completion.problem });

  // A producer finished without the file its contract requires, and nobody took over.
  for (const agent of input.agents) {
    if (agent.status !== "completed" || !agent.endedAt) continue;
    const endedAt = new Date(agent.endedAt).getTime();
    // The pilot acted after this agent ended: it took over, whatever the agent left.
    if (signals.pilotLastActedAt !== undefined && signals.pilotLastActedAt > endedAt) continue;
    if (now - after(endedAt) < policy.artifactGraceMs || idleFor < policy.artifactGraceMs) continue;
    const missing = requiredFiles(agent, input.planDelegations ?? []).filter((file) => !input.artifacts.includes(file));
    if (missing.length === 0) continue;
    const file = missing[0];
    return {
      health: "stalled", title: `${fileLabel(file)} expected`,
      detail: `${agentType(agent.name)} finished without writing ${file}, and nothing takes over.`,
      incident: {
        kind: "missing_result", fingerprint: `missing_result:${agent.id}:${file}`,
        title: `${fileLabel(file)} expected`,
        reason: `The ${agentType(agent.name)} agent finished at ${clock(endedAt)} without writing ${file}, which its contract requires, and Claude Code has started nothing since.`,
        observations: [{ kind: "producer", at: agent.endedAt, detail: `${agentType(agent.name)} finished.` }, { kind: "missing", detail: `Missing file: ${missing.join(", ")}.` }, ...observations],
        expectedNextAction: `Relaunch ${agentType(agent.name)} or write ${file}, then resume the workflow.`,
        suggestedActions: LIVE_ACTIONS,
      },
    };
  }
  if (idleFor < policy.turnEndGraceMs) return { health: "healthy" };

  const blocked = input.planTasks ? blockedDependencies(input.planTasks) : undefined;
  if (blocked) {
    const parts = [
      ...blocked.unknown.map((entry) => `${entry.task} depends on ${entry.missing}, which is not in the plan`),
      ...(blocked.cycle.length ? [`${blocked.cycle.join(", ")} depend on each other`] : []),
    ];
    return {
      health: "stalled", title: "Plan blocked by its dependencies",
      detail: `No remaining task can run: ${parts.join("; ")}.`,
      incident: {
        kind: "unresolvable_dependency",
        fingerprint: `unresolvable_dependency:${[...blocked.unknown.map((entry) => `${entry.task}>${entry.missing}`), ...blocked.cycle].sort().join(",")}`,
        title: "Plan blocked by its dependencies",
        reason: `No remaining task can run: ${parts.join("; ")}.`,
        observations: [{ kind: "plan", detail: parts.join("; ") }, ...observations],
        expectedNextAction: "Fix the plan (missing or circular dependency), then resume the implementation.",
        suggestedActions: LIVE_ACTIONS,
      },
    };
  }

  const expected = declared?.description ?? (workflow?.step ? `The rest of the workflow after step ${workflow.step}.` : "The rest of the workflow.");
  return {
    health: "stalled", title: "Nothing in progress",
    detail: "Claude Code handed back with no active agent, no question and no next step in progress. It may be waiting for an answer written in the conversation.",
    incident: {
      kind: "no_next_action", fingerprint: `no_next_action:${idleSince}`,
      title: "Nothing in progress",
      reason: `Claude Code handed back at ${clock(idleSince)} with no active agent, no question and no next step in progress, while the workflow is not finished.`,
      observations,
      expectedNextAction: expected,
      suggestedActions: LIVE_ACTIONS,
    },
  };
}

/** How the evaluation of a run reads the signals, whatever holds them. */
export function healthSignalsView(signals: RunSignals): HealthInput["signals"] {
  return {
    lastExecutionAt: signals.lastExecutionAt, lastProgressAt: signals.lastProgressAt, pilotIdleSince: signals.pilotIdleSince, pilotLastActedAt: signals.pilotLastActedAt,
    permission: signals.permission, terminalInteraction: signals.terminalInteraction, unexplainedAttention: signals.unexplainedAttention,
    resumedAt: signals.resumedAt, exit: signals.exit,
    activeTools: [...signals.activeTools.values()],
    backgroundWaits: [...signals.backgroundWaits.values()],
  };
}
