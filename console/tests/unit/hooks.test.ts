import { beforeEach, describe, expect, it } from "@jest/globals";

import { answerQuestion, processHook } from "../../server/hooks";
import { RunSession } from "../../server/run-session";

// A demonstration identifier keeps the completion out of the self-improvement loop.
let session: RunSession;
const hook = (payload: Record<string, unknown>) => processHook(session, { runId: session.id, payload });

beforeEach(() => {
  session = new RunSession("demo-hooks", { status: "running", phase: 1 });
});

describe("workflow signals from Claude Code hooks", () => {
  it("should follow the phase of the agent that starts working", () => {
    hook({ hook_event_name: "SubagentStart", agent_type: "implementation-harness:ticket-planner", agent_id: "a1" });
    expect(session.state.phase).toBe(4);
    hook({ hook_event_name: "SubagentStart", agent_type: "implementation-harness:developer", agent_id: "a2" });
    expect(session.state.phase).toBe(5);
    hook({ hook_event_name: "SubagentStart", agent_type: "Explore", agent_id: "a3" });
    expect(session.state.phase).toBe(5);
  });

  it("should light up the branch step when the branch is created", () => {
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git switch -c fix-258" } });
    expect(session.state.phase).toBe(3);
  });

  it("should keep tool calls out of the feed, and still read the branch from them", () => {
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" } });
    expect(session.state.activities).toEqual([]);
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git switch -c fix-258" } });
    expect(session.state.activities).toEqual([expect.objectContaining({ title: "Branche de travail", detail: "fix-258" })]);
  });

  it("should stay quiet when the session goes idle while a background agent works", () => {
    hook({ hook_event_name: "SubagentStart", agent_type: "implementation-harness:developer", agent_id: "a1" });
    hook({ hook_event_name: "Stop" });
    const announced = session.state.activities.length;
    hook({ hook_event_name: "Notification", message: "Claude is waiting for your input" });
    expect(session.state.status).toBe("running");
    expect(session.state.activities).toHaveLength(announced);
  });

  it("should drop the call for attention as soon as Claude Code resumes", () => {
    hook({ hook_event_name: "Notification", message: "Claude needs your permission" });
    expect(session.state.status).toBe("attention");
    hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "a.ts" } });
    expect(session.state.status).toBe("running");
  });

  it("should keep the run alive while a background agent works", () => {
    session.state.phase = 9;
    hook({ hook_event_name: "SubagentStart", agent_type: "implementation-harness:senior-reviewer", agent_id: "a1" });
    hook({ hook_event_name: "Stop" });
    expect(session.state.status).toBe("running");
    expect(session.state.phase).toBe(9);

    hook({ hook_event_name: "SubagentStop", agent_type: "implementation-harness:senior-reviewer", agent_id: "a1" });
    hook({ hook_event_name: "Stop" });
    expect(session.state).toMatchObject({ status: "completed", phase: 10 });
  });

  it("should say what the agent is doing, and forget it as soon as the turn ends", () => {
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "glab issue view 258" } });
    expect(session.state.action).toBe("Lecture du ticket GitLab");
    hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/repo/console/server/domain.ts" } });
    expect(session.state.action).toBe("Lecture de domain.ts");
    // The action is an instant, never a milestone: the feed keeps none of it.
    expect(session.state.activities).toEqual([]);
    hook({ hook_event_name: "Stop" });
    expect(session.state.action).toBeUndefined();
  });

  it("should stop claiming an action while it waits for the user to decide", () => {
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm run test:unit" } });
    expect(session.state.action).toBe("Exécution des tests");
    hook({
      hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "q1",
      tool_input: { questions: [{ question: "Quelle base ?", header: "Branche", options: [{ label: "develop" }] }] },
    });
    expect(session.state.status).toBe("attention");
    expect(session.state.action).toBeUndefined();
  });

  it("should ignore an agent event that names no agent", () => {
    hook({ hook_event_name: "SubagentStart", agent_type: "  ", agent_id: "a1" });
    expect(session.state.agents).toEqual([]);
    expect(session.state.activities).toEqual([]);
  });

  it("should not announce a stop it cannot attribute to a running agent", () => {
    hook({ hook_event_name: "SubagentStop", agent_type: "implementation-harness:developer", agent_id: "a1" });
    expect(session.state.agents).toEqual([]);
    expect(session.state.activities).toEqual([]);
  });

  it("should close an agent that reported no id, by its name", () => {
    hook({ hook_event_name: "SubagentStart", agent_type: "implementation-harness:developer" });
    hook({ hook_event_name: "SubagentStop", agent_type: "implementation-harness:developer" });
    expect(session.state.agents).toHaveLength(1);
    expect(session.state.agents[0]).toMatchObject({ name: "implementation-harness:developer", status: "completed" });
  });

  it("should close a background agent that was killed, so the run can end", () => {
    session.state.phase = 9;
    hook({ hook_event_name: "SubagentStart", agent_type: "implementation-harness:developer", agent_id: "a1" });
    hook({ hook_event_name: "PostToolUse", tool_name: "TaskStop", tool_input: { task_id: "a1" }, tool_response: {} });
    expect(session.state.agents[0]).toMatchObject({ id: "a1", status: "abandoned" });
    hook({ hook_event_name: "Stop" });
    expect(session.state.status).toBe("completed");
  });

  it("should ignore a stopped task that is not a running agent", () => {
    hook({ hook_event_name: "PostToolUse", tool_name: "TaskStop", tool_input: { task_id: "shell-1" }, tool_response: {} });
    expect(session.state.agents).toEqual([]);
    expect(session.state.activities).toEqual([]);
  });

  it("should date the end of the run from the workflow, not from the session", () => {
    session.state.phase = 9;
    expect(session.state.endedAt).toBeNull();
    hook({ hook_event_name: "Stop" });
    expect(session.state).toMatchObject({ status: "completed", phase: 10 });
    // The session then sits idle at its prompt and may be killed much later.
    expect(session.state.endedAt).not.toBeNull();
  });

  it("should leave a mid-workflow hand-back to the health monitor, without dating the end of the run", () => {
    session.state.phase = 5;
    hook({ hook_event_name: "Stop" });
    // Not "attention" straight away: a hand-back is a verdict only once nothing is going to wake the pilot.
    expect(session.state).toMatchObject({ status: "running", endedAt: null });
    expect(session.signals.pilotIdleSince).toBeDefined();
  });

  it("should leave a finished run alone when the idle session keeps notifying", () => {
    session.state = { ...session.state, status: "completed", phase: 10 };
    hook({ hook_event_name: "Notification", message: "Claude is waiting for your input" });
    expect(session.state.status).toBe("completed");
    hook({ hook_event_name: "Stop" });
    expect(session.state.status).toBe("completed");
  });

  it("should still raise a question asked by the idle session of a finished run, and leave its outcome alone", async () => {
    session.state = { ...session.state, status: "completed", phase: 10, sessionActive: true, endedAt: "2026-09-18T14:00:45.000Z" };
    const parked = hook({
      hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "q1",
      tool_input: { questions: [{ question: "Quelle portée ?", header: "Portée", options: [{ label: "Un fichier" }] }] },
    });
    expect(session.state.pendingQuestion?.questions).toEqual([expect.objectContaining({ question: "Quelle portée ?" })]);
    expect(session.state.status).toBe("completed");

    answerQuestion(session, { "Quelle portée ?": "Un fichier" });
    await expect(parked).resolves.toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(session.state).toMatchObject({ status: "completed", endedAt: "2026-09-18T14:00:45.000Z", pendingQuestion: undefined });
  });

  it("should ignore a question from a finished run whose session is gone", () => {
    session.state = { ...session.state, status: "stopped", sessionActive: false };
    void hook({
      hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "q1",
      tool_input: { questions: [{ question: "Quelle portée ?", header: "Portée", options: [] }] },
    });
    expect(session.state.pendingQuestion).toBeUndefined();
  });
});
