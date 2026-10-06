import { beforeEach, describe, expect, it } from "@jest/globals";

import { answerQuestion, processHook, withdrawQuestion } from "../../server/hooks";
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

  it("should stay on the step the workflow declares when an agent or a merge request points further", () => {
    session.state.phase = 5;
    session.state.workflow = { schemaVersion: 1, revision: 4, state: "waiting", step: "5", receivedAt: "2026-10-04T16:00:00.000Z" };
    hook({ hook_event_name: "SubagentStart", agent_type: "implementation-harness:senior-reviewer", agent_id: "a1" });
    expect(session.state.phase).toBe(5);
    expect(session.inferredPhase).toBe(6);
  });

  it("should still close a run whose workflow stopped declaring before the end, from what the documents show", () => {
    session.state.phase = 8;
    session.state.workflow = { schemaVersion: 1, revision: 9, state: "working", step: "8", receivedAt: "2026-10-04T16:00:00.000Z" };
    session.inferPhase(10);
    expect(session.state.phase).toBe(8);
    hook({ hook_event_name: "Stop" });
    expect(session.state).toMatchObject({ status: "completed", phase: 10 });
  });

  it("should light up the branch step when the branch is created", () => {
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git switch -c fix-258" } });
    expect(session.state.phase).toBe(3);
  });

  it("should keep tool calls out of the feed, and still read the branch from them", () => {
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" } });
    expect(session.state.activities).toEqual([]);
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git switch -c fix-258" } });
    expect(session.state.activities).toEqual([expect.objectContaining({ title: "Working branch", detail: "fix-258" })]);
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
    expect(session.state.action).toBe("Reading the GitLab ticket");
    hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/repo/console/server/domain.ts" } });
    expect(session.state.action).toBe("Reading domain.ts");
    // The action is an instant, never a milestone: the feed keeps none of it.
    expect(session.state.activities).toEqual([]);
    hook({ hook_event_name: "Stop" });
    expect(session.state.action).toBeUndefined();
  });

  it("should stop claiming an action while it waits for the user to decide", () => {
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm run test:unit" } });
    expect(session.state.action).toBe("Running the tests");
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

  it("should keep the run open while a command the pilot left in the background has yet to wake it", () => {
    session.state.phase = 9;
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "b1", tool_input: { command: "./upload.sh", run_in_background: true } });
    hook({ hook_event_name: "Stop" });
    expect(session.state).toMatchObject({ status: "running", phase: 9, endedAt: null });

    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "b2", tool_input: { command: "glab mr note 12" } });
    hook({ hook_event_name: "Stop" });
    expect(session.state).toMatchObject({ status: "completed", phase: 10 });
  });

  it("should close on a declared end even with a command still in the background", () => {
    session.state.phase = 9;
    session.state.mergeRequestUrl = "https://gitlab.example/mr/12";
    session.state.workflow = { schemaVersion: 1, revision: 1, state: "completed", receivedAt: new Date().toISOString(), result: { delivery: "merge_request", blockers: [] } };
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "b1", tool_input: { command: "npm run dev", run_in_background: true } });
    hook({ hook_event_name: "Stop" });
    expect(session.state.status).toBe("completed");
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
      tool_input: { questions: [{ question: "Which scope?", header: "Scope", options: [{ label: "One file" }] }] },
    });
    expect(session.state.pendingQuestion?.questions).toEqual([expect.objectContaining({ question: "Which scope?" })]);
    expect(session.state.status).toBe("completed");

    answerQuestion(session, { "Which scope?": "One file" });
    await expect(parked).resolves.toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(session.state).toMatchObject({ status: "completed", endedAt: "2026-09-18T14:00:45.000Z", pendingQuestion: undefined });
  });

  it("should withdraw a question whose hook stopped waiting, and take the next one", async () => {
    const ask = (id: string, question: string) => hook({
      hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: id,
      tool_input: { questions: [{ question, header: "Scope", options: [{ label: "One file" }] }] },
    });
    const parked = ask("q1", "Which scope?");
    expect(session.state).toMatchObject({ status: "attention", pendingQuestion: { id: "q1" } });

    // Another question's request closing says nothing about this one.
    expect(withdrawQuestion(session, "q0")).toBe(false);
    expect(session.state.pendingQuestion?.id).toBe("q1");

    expect(withdrawQuestion(session, "q1")).toBe(true);
    await expect(parked).resolves.toBeUndefined();
    expect(session.state.pendingQuestion).toBeUndefined();
    expect(session.state.status).toBe("running");
    expect(() => answerQuestion(session, { "Which scope?": "One file" })).toThrow("No question is waiting for an answer.");

    void ask("q2", "Which base?");
    expect(session.state.pendingQuestion).toMatchObject({ id: "q2", questions: [expect.objectContaining({ question: "Which base?" })] });
  });

  it("should ignore a question from a finished run whose session is gone", () => {
    session.state = { ...session.state, status: "stopped", sessionActive: false };
    void hook({
      hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "q1",
      tool_input: { questions: [{ question: "Which scope?", header: "Scope", options: [] }] },
    });
    expect(session.state.pendingQuestion).toBeUndefined();
  });
});
