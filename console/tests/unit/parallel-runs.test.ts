import { beforeEach, describe, expect, it } from "@jest/globals";
import { answerQuestion, processHook } from "../../server/hooks";
import { RunSession } from "../../server/run-session";

/**
 * Two runs going at once, which is the whole point of the registry above these
 * modules. Everything a run owns used to be module state shared by all of them:
 * one status, one terminal buffer, one pending question. These are the
 * properties that broke, expressed on the sessions themselves.
 */
let first: RunSession;
let second: RunSession;

// Demonstration identifiers keep the completions out of the self-improvement loop.
beforeEach(() => {
  first = new RunSession("demo-first", { status: "running", phase: 1, cwd: "/work/repo-a" });
  second = new RunSession("demo-second", { status: "running", phase: 1, cwd: "/work/repo-b" });
});

const hook = (session: RunSession, payload: Record<string, unknown>) => processHook(session, { runId: session.id, payload });

const question = {
  hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "q1",
  tool_input: { questions: [{ question: "Which base?", header: "Branch", options: [{ label: "develop" }] }] },
};

describe("two runs driven at the same time", () => {
  it("should apply an event only to the run that emitted it", () => {
    hook(first, { hook_event_name: "SubagentStart", agent_type: "implementation-harness:developer", agent_id: "a1" });
    expect(first.state.phase).toBe(5);
    expect(first.state.agents).toHaveLength(1);
    expect(second.state.phase).toBe(1);
    expect(second.state.agents).toEqual([]);
  });

  it("should keep each run's branch and merge request to itself", () => {
    hook(first, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git switch -c fix-258" } });
    hook(second, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git switch -c fix-301" } });
    expect(first.state.branch).toBe("fix-258");
    expect(second.state.branch).toBe("fix-301");
  });

  it("should park each run on its own question, and release only the one that was answered", () => {
    void hook(first, question);
    void hook(second, question);
    expect(first.state.status).toBe("attention");
    expect(second.state.status).toBe("attention");

    answerQuestion(first, { "Which base?": "develop" });
    expect(first.state.status).toBe("running");
    expect(first.state.pendingQuestion).toBeUndefined();
    // The other run is still blocked on its own decision, and nothing it holds moved.
    expect(second.state.status).toBe("attention");
    expect(second.state.pendingQuestion).toBeDefined();
  });

  it("should leave the agent of one run waiting when the other is answered", async () => {
    const parkedFirst = hook(first, question);
    const parkedSecond = hook(second, question);
    let secondReleased = false;
    void Promise.resolve(parkedSecond).then(() => { secondReleased = true; });

    answerQuestion(first, { "Which base?": "develop" });
    await expect(parkedFirst).resolves.toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    // A promise that resolved would have been observed by the microtask above.
    await Promise.resolve();
    expect(secondReleased).toBe(false);
  });

  it("should write terminal output into the buffer of its own run", () => {
    first.appendTerminal("compilation du projet A\n");
    second.appendTerminal("tests du projet B\n");
    expect(first.terminalBuffer).toBe("compilation du projet A\n");
    expect(second.terminalBuffer).toBe("tests du projet B\n");
  });

  it("should finish one run without touching the other", () => {
    first.state.phase = 9;
    hook(first, { hook_event_name: "Stop" });
    expect(first.state).toMatchObject({ status: "completed", phase: 10 });
    expect(second.state).toMatchObject({ status: "running", phase: 1 });
  });

  it("should record each conversation against its own run", () => {
    first.conversationMessage({ id: "m1", at: "2026-09-18T10:00:00.000Z", author: "claude", text: "Plan du ticket 258." });
    second.conversationMessage({ id: "m2", at: "2026-09-18T10:00:01.000Z", author: "claude", text: "Plan du ticket 301." });
    expect(first.state.messages.map((message) => message.id)).toEqual(["m1"]);
    expect(second.state.messages.map((message) => message.id)).toEqual(["m2"]);
  });

  it("should refuse a second answer to a question that is no longer waiting", () => {
    void hook(first, question);
    answerQuestion(first, { "Which base?": "develop" });
    expect(() => answerQuestion(first, { "Which base?": "main" })).toThrow(/No question/);
  });
});
