import { describe, expect, it } from "@jest/globals";
import { blockedDependencies, createSignals, DEFAULT_HEALTH_POLICY, evaluateRunHealth, healthSignalsView, recordEngineSignal, requiredFiles, wokeUpFromSuspension, type HealthInput, type RunSignals } from "../../server/run-health";
import { declaredCompletion, parseWorkflowState } from "../../server/workflow-state";
import type { AgentState, WorkflowState } from "../../server/types";

const T0 = Date.UTC(2026, 8, 27, 10, 0, 0);
const policy = DEFAULT_HEALTH_POLICY;
const seconds = (count: number) => count * 1_000;
const minutes = (count: number) => count * 60_000;

function input(overrides: Partial<Omit<HealthInput, "signals">> = {}, signals: Partial<RunSignals> = {}): HealthInput {
  const base = { ...createSignals(T0), ...signals };
  return { status: "running", sessionActive: true, stoppedBy: null, pendingQuestion: false, agents: [], artifacts: [], ...overrides, signals: healthSignalsView(base) };
}

const agent = (overrides: Partial<AgentState>): AgentState => ({ id: "a1", name: "implementation-harness:developer", status: "running", startedAt: new Date(T0).toISOString(), ...overrides });

function workflow(overrides: Partial<WorkflowState>): WorkflowState {
  return { schemaVersion: 1, revision: 1, state: "working", receivedAt: new Date(T0).toISOString(), ...overrides };
}

describe("waits that belong to someone", () => {
  it("should leave a question unanswered for an hour without calling it a failure", () => {
    const verdict = evaluateRunHealth(input({ pendingQuestion: true }, { pilotIdleSince: T0 }), T0 + minutes(60), policy);
    expect(verdict).toMatchObject({ health: "waiting", wait: { reason: "user_question" } });
    expect(verdict.incident).toBeUndefined();
  });

  it("should name a permission prompt as a wait on the user at the terminal", () => {
    const verdict = evaluateRunHealth(input({}, { permission: { since: T0, message: "Claude needs your permission to use Bash" } }), T0 + minutes(30), policy);
    expect(verdict).toMatchObject({ health: "waiting", wait: { reason: "permission" }, detail: "Claude needs your permission to use Bash" });
    expect(verdict.incident).toBeUndefined();
  });

  it("should not conclude anything from a call for attention that gives no cause", () => {
    const verdict = evaluateRunHealth(input({}, { unexplainedAttention: { since: T0 }, pilotIdleSince: T0 }), T0 + minutes(30), policy);
    expect(verdict).toMatchObject({ health: "waiting", wait: { reason: "unknown" } });
    expect(verdict.incident).toBeUndefined();
  });
});

describe("work that is silent on purpose", () => {
  it("should never restart or flag a background agent, and only voice a doubt after the silence threshold", () => {
    const quiet = input({ agents: [agent({})] }, { pilotIdleSince: T0 });
    expect(evaluateRunHealth(quiet, T0 + minutes(9), policy)).toMatchObject({ health: "waiting", wait: { reason: "agent" } });
    const doubt = evaluateRunHealth(quiet, T0 + minutes(11), policy);
    expect(doubt.health).toBe("suspected_stall");
    expect(doubt.detail).toMatch(/Un agent est toujours déclaré actif/);
    expect(doubt.incident).toBeUndefined();
  });

  it("should treat a long test run as work, then as a doubt, never as a stall", () => {
    const signals = createSignals(T0);
    recordEngineSignal(signals, { kind: "tool.start", tool: "Bash", command: "npm test", toolUseId: "t1", background: false, endReported: true }, T0, "Exécution des tests");
    const running = { ...input(), signals: healthSignalsView(signals) };
    expect(evaluateRunHealth(running, T0 + minutes(5), policy).health).toBe("healthy");
    const doubt = evaluateRunHealth(running, T0 + minutes(12), policy);
    expect(doubt.health).toBe("suspected_stall");
    expect(doubt.detail).toMatch(/Exécution des tests/);
    expect(doubt.incident).toBeUndefined();
  });

  it("should wait on a background command the pilot launched, until the pilot wakes up", () => {
    const signals = createSignals(T0);
    recordEngineSignal(signals, { kind: "tool.start", tool: "Monitor", toolUseId: "m1", background: true, endReported: false }, T0, "Attente du serveur");
    recordEngineSignal(signals, { kind: "turn.end" }, T0 + seconds(1));
    const verdict = evaluateRunHealth({ ...input(), signals: healthSignalsView(signals) }, T0 + minutes(5), policy);
    expect(verdict).toMatchObject({ health: "waiting", wait: { reason: "tool", on: "Attente du serveur" } });
    recordEngineSignal(signals, { kind: "tool.start", tool: "Read", toolUseId: "r1", background: false, endReported: false }, T0 + minutes(6));
    expect(signals.backgroundWaits.size).toBe(0);
    expect(signals.pilotIdleSince).toBeUndefined();
  });

  it("should trust a wait the workflow declares on a process until the doubt threshold", () => {
    const declared = workflow({ state: "waiting", nextAction: { kind: "await_process", taskIds: [], agents: [], description: "Serveur de dev en démarrage" } });
    const waitingRun = input({ workflow: declared }, { pilotIdleSince: T0 });
    expect(evaluateRunHealth(waitingRun, T0 + minutes(5), policy)).toMatchObject({ health: "waiting", wait: { reason: "tool" } });
    expect(evaluateRunHealth(waitingRun, T0 + minutes(11), policy).health).toBe("suspected_stall");
  });
});

describe("a pilot with nothing next", () => {
  it("should wait out the grace, then raise one incident naming what it observed", () => {
    const idle = input({ workflow: workflow({ state: "working", step: "5" }) }, { pilotIdleSince: T0 });
    expect(evaluateRunHealth(idle, T0 + seconds(59), policy).incident).toBeUndefined();
    const verdict = evaluateRunHealth(idle, T0 + seconds(61), policy);
    expect(verdict.health).toBe("stalled");
    expect(verdict.incident).toMatchObject({ kind: "no_next_action", fingerprint: `no_next_action:${T0}`, title: "Plus aucune action en cours" });
    expect(verdict.incident!.observations.map((observation) => observation.kind)).toEqual(expect.arrayContaining(["turn", "agents", "question", "workflow"]));
    expect(verdict.incident!.suggestedActions).toContain("request_continuation");
    // The same hand-back evaluated again is the same cause.
    expect(evaluateRunHealth(idle, T0 + minutes(5), policy).incident!.fingerprint).toBe(verdict.incident!.fingerprint);
  });

  it("should give the pilot its whole grace to wake up after the last agent ends", () => {
    const ended = agent({ status: "completed", endedAt: new Date(T0 + minutes(5)).toISOString(), name: "implementation-harness:senior-reviewer" });
    const idle = input({ agents: [ended] }, { pilotIdleSince: T0 });
    expect(evaluateRunHealth(idle, T0 + minutes(5) + seconds(10), policy).incident).toBeUndefined();
    expect(evaluateRunHealth(idle, T0 + minutes(6) + seconds(1), policy).incident?.fingerprint).toBe(`no_next_action:${T0}`);
  });

  it("should not let a declared wait on an agent hide that no agent is running", () => {
    const declared = workflow({ state: "waiting", nextAction: { kind: "await_agent", taskIds: ["T3"], agents: ["developer"] } });
    const verdict = evaluateRunHealth(input({ workflow: declared }, { pilotIdleSince: T0 }), T0 + minutes(2), policy);
    expect(verdict.incident?.kind).toBe("no_next_action");
    expect(verdict.incident!.observations.find((observation) => observation.kind === "declared_wait")?.detail).toMatch(/aucun agent ne tourne/);
  });

  it("should say so when the workflow never declares its next step, without requiring it", () => {
    const verdict = evaluateRunHealth(input({}, { pilotIdleSince: T0 }), T0 + minutes(2), policy);
    expect(verdict.incident!.observations.find((observation) => observation.kind === "workflow")?.detail).toMatch(/Aucun workflow-state\.json/);
  });

  it("should restart every grace from the wake-up after the machine slept", () => {
    const idle = input({}, { pilotIdleSince: T0, resumedAt: T0 + minutes(30) });
    expect(evaluateRunHealth(idle, T0 + minutes(30) + seconds(30), policy).incident).toBeUndefined();
    expect(evaluateRunHealth(idle, T0 + minutes(31) + seconds(1), policy).incident?.kind).toBe("no_next_action");
    expect(wokeUpFromSuspension(T0, T0 + minutes(5), policy)).toBe(true);
    expect(wokeUpFromSuspension(T0, T0 + seconds(15), policy)).toBe(false);
  });

  it("should take a declared end that holds, and question one that does not", () => {
    const delivered = workflow({ state: "completed", result: { delivery: "draft_merge_request", mergeRequestUrl: "https://gitlab.example/p/-/merge_requests/9", blockers: ["AC3 bloqué"] } });
    expect(evaluateRunHealth(input({ workflow: delivered }, { pilotIdleSince: T0 }), T0 + minutes(5), policy).health).toBe("healthy");
    const claimed = workflow({ state: "completed", result: { delivery: "merge_request", blockers: [] } });
    const verdict = evaluateRunHealth(input({ workflow: claimed }, { pilotIdleSince: T0 }), T0 + minutes(5), policy);
    expect(verdict.incident?.observations.find((observation) => observation.kind === "completion")?.detail).toMatch(/jamais ouverte/);
  });
});

describe("a result its producer never wrote", () => {
  const ended = new Date(T0).toISOString();
  const qa = agent({ id: "qa1", name: "implementation-harness:qa-reviewer", status: "completed", endedAt: ended });

  it("should give the file its archiving grace, then name it", () => {
    const run = input({ agents: [qa] }, { pilotIdleSince: T0, pilotLastActedAt: T0 - seconds(10) });
    expect(evaluateRunHealth(run, T0 + seconds(20), policy).incident).toBeUndefined();
    const verdict = evaluateRunHealth(run, T0 + seconds(31), policy);
    expect(verdict.incident).toMatchObject({ kind: "missing_result", title: "Rapport QA attendu", fingerprint: "missing_result:qa1:qa-report.md" });
  });

  it("should stay quiet once the report arrives, or when the pilot took over after the agent", () => {
    const arrived = input({ agents: [qa], artifacts: ["qa-report.md", "qa-evidence.json"] }, { pilotIdleSince: T0, pilotLastActedAt: T0 - seconds(10) });
    expect(evaluateRunHealth(arrived, T0 + seconds(40), policy).incident).toBeUndefined();
    const takenOver = input({ agents: [qa] }, { pilotIdleSince: T0 + seconds(5), pilotLastActedAt: T0 + seconds(2) });
    expect(evaluateRunHealth(takenOver, T0 + seconds(40), policy).incident).toBeUndefined();
  });

  it("should require nothing of a reviewer that answers in chat", () => {
    const senior = agent({ id: "s1", name: "implementation-harness:senior-reviewer", status: "completed", endedAt: ended });
    expect(requiredFiles(senior, [])).toEqual([]);
    const verdict = evaluateRunHealth(input({ agents: [senior] }, { pilotIdleSince: T0, pilotLastActedAt: T0 - 1 }), T0 + seconds(45), policy);
    expect(verdict.incident).toBeUndefined();
  });

  it("should expect a developer's report for each task it was handed", () => {
    expect(requiredFiles({ id: "d1", name: "implementation-harness:developer" }, [{ agentType: "developer", taskIds: ["T2", "T3"], agentId: "d1" }])).toEqual(["developer-report-T2.md", "developer-report-T3.md"]);
  });
});

describe("a plan nothing can execute", () => {
  it("should name a dependency on a task the plan does not have", () => {
    expect(blockedDependencies([{ id: "T1", status: "done" }, { id: "T2", status: "todo", dependencies: ["T9"] }])).toEqual({ unknown: [{ task: "T2", missing: "T9" }], cycle: [] });
  });

  it("should name a cycle, and say nothing while some task can still run", () => {
    expect(blockedDependencies([{ id: "T1", status: "todo", dependencies: ["T2"] }, { id: "T2", status: "todo", dependencies: ["T1"] }])?.cycle.sort()).toEqual(["T1", "T2"]);
    expect(blockedDependencies([{ id: "T1", status: "todo" }, { id: "T2", status: "todo", dependencies: ["T9"] }])).toBeUndefined();
  });

  it("should raise the precise diagnosis rather than the generic one", () => {
    const verdict = evaluateRunHealth(input({ planTasks: [{ id: "T1", status: "done" }, { id: "T2", status: "todo", dependencies: ["T9"] }] }, { pilotIdleSince: T0 }), T0 + minutes(2), policy);
    expect(verdict.incident).toMatchObject({ kind: "unresolvable_dependency" });
    expect(verdict.incident!.reason).toMatch(/T2 dépend de T9/);
  });
});

describe("the end of a session", () => {
  it("should call a session gone before any result interrupted, whatever its exit code", () => {
    const verdict = evaluateRunHealth(input({ status: "failed", sessionActive: false }, { exit: { at: T0, code: 0 } }), T0 + 1, policy);
    expect(verdict).toMatchObject({ health: "interrupted", incident: { kind: "lost_session", fingerprint: `lost_session:${T0}` } });
    expect(verdict.incident!.suggestedActions).not.toContain("request_continuation");
  });

  it("should see nothing wrong in a finished workflow closed by the queue, nor in a stop the user asked for", () => {
    expect(evaluateRunHealth(input({ status: "completed", sessionActive: false, stoppedBy: "queue" }, { exit: { at: T0, code: 143 } }), T0 + 1, policy)).toEqual({ health: "healthy" });
    expect(evaluateRunHealth(input({ status: "stopped", sessionActive: false, stoppedBy: "user" }, { exit: { at: T0, code: 143 } }), T0 + 1, policy)).toEqual({ health: "healthy" });
  });
});

describe("engine signals", () => {
  it("should keep a subagent's calls out of the pilot's turn, and pair a call with its end by id", () => {
    const signals = createSignals(T0);
    recordEngineSignal(signals, { kind: "turn.end" }, T0);
    recordEngineSignal(signals, { kind: "tool.start", tool: "Bash", toolUseId: "sub-1", agentId: "a1", background: false, endReported: true }, T0 + 1);
    expect(signals.pilotIdleSince).toBe(T0);
    expect([...signals.activeTools.keys()]).toEqual(["sub-1"]);
    recordEngineSignal(signals, { kind: "tool.end", response: {}, toolUseId: "sub-1", agentId: "a1" }, T0 + 2);
    expect(signals.activeTools.size).toBe(0);
  });

  it("should end a subagent's open calls with the subagent, and the pilot's with its turn", () => {
    const signals = createSignals(T0);
    recordEngineSignal(signals, { kind: "tool.start", tool: "Bash", toolUseId: "p1", background: false, endReported: true }, T0);
    recordEngineSignal(signals, { kind: "tool.start", tool: "Bash", toolUseId: "s1", agentId: "a1", background: false, endReported: true }, T0);
    recordEngineSignal(signals, { kind: "agent.stop", agentId: "a1", agentName: "developer" }, T0 + 1);
    expect([...signals.activeTools.keys()]).toEqual(["p1"]);
    recordEngineSignal(signals, { kind: "turn.end" }, T0 + 2);
    expect(signals.activeTools.size).toBe(0);
  });

  it("should clear a permission prompt as soon as the session does anything else", () => {
    const signals = createSignals(T0);
    recordEngineSignal(signals, { kind: "attention", cause: "permission", message: "Permission" }, T0);
    expect(signals.permission).toBeDefined();
    recordEngineSignal(signals, { kind: "tool.end", response: {} }, T0 + 1);
    expect(signals.permission).toBeUndefined();
  });
});

describe("workflow-state.json", () => {
  const at = new Date(T0).toISOString();

  it("should read a valid declaration and keep only what it can trust", () => {
    const reading = parseWorkflowState(JSON.stringify({ schemaVersion: 1, revision: 3, state: "waiting", step: "5", nextAction: { kind: "await_agent", taskIds: ["T2", 4], agents: ["developer"], expectedArtifact: "../../etc/passwd" } }), at);
    expect(reading).toEqual({ state: { schemaVersion: 1, revision: 3, state: "waiting", step: "5", nextAction: { kind: "await_agent", taskIds: ["T2"], agents: ["developer"] }, receivedAt: at } });
  });

  it("should turn a partial write or an unknown schema into a diagnostic, never a state", () => {
    expect(parseWorkflowState('{"schemaVersion":1,"revis', at)).toHaveProperty("error");
    expect(parseWorkflowState(JSON.stringify({ schemaVersion: 2, revision: 1, state: "working" }), at)).toHaveProperty("error");
    expect(parseWorkflowState(JSON.stringify({ schemaVersion: 1, revision: 1, state: "done" }), at)).toHaveProperty("error");
  });

  it("should accept an end without a merge request only with its blockers written down", () => {
    expect(declaredCompletion(workflow({ state: "completed", result: { delivery: "none", blockers: ["Environnement de recette inaccessible"] } }), undefined)).toEqual({ complete: true });
    expect(declaredCompletion(workflow({ state: "completed", result: { delivery: "none", blockers: [] } }), undefined).complete).toBe(false);
    expect(declaredCompletion(workflow({ state: "completed", result: { delivery: "merge_request", blockers: [] } }), "https://gitlab.example/mr/1")).toEqual({ complete: true });
  });
});
