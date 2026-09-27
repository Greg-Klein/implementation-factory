import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { claudeCode, END_REPORTED_TOOLS } from "../../server/engine/claude-code";
import { engine } from "../../server/engine/index";

describe("engine contract", () => {
  it("should expose claude-code as the active engine", () => {
    expect(engine.id).toBe("claude-code");
    expect(engine.label).toBe("Claude Code");
  });

  it("should build the workflow command with and without an instruction", () => {
    expect(claudeCode.command("https://gitlab.com/acme/app/-/issues/258", ""))
      .toBe("/implementation-harness:implement https://gitlab.com/acme/app/-/issues/258");
    expect(claudeCode.command("https://gitlab.com/acme/app/-/issues/258", "reste sur desktop"))
      .toBe("/implementation-harness:implement https://gitlab.com/acme/app/-/issues/258 reste sur desktop");
  });

  it("should keep the documents of a run inside the project", () => {
    expect(claudeCode.taskDirectory("/tmp/repo")).toBe("/tmp/repo/.claude/tasks");
  });

  it("should name the transcript from an event payload", () => {
    expect(claudeCode.transcriptPath({ runId: "r1", payload: { transcript_path: "/tmp/session.jsonl" } })).toBe("/tmp/session.jsonl");
    expect(claudeCode.transcriptPath({ runId: "r1", payload: {} })).toBeUndefined();
    expect(claudeCode.transcriptPath({ runId: "r1" })).toBeUndefined();
  });
});

describe("engine event translation", () => {
  it("should turn subagent hooks into agent events", () => {
    expect(claudeCode.event({ hook_event_name: "SubagentStart", agent_type: "implementation-harness:developer", agent_id: "a1" }))
      .toEqual({ kind: "agent.start", agentId: "a1", agentName: "implementation-harness:developer" });
    expect(claudeCode.event({ hook_event_name: "SubagentStop", agent_type: "implementation-harness:developer", agent_id: "a1" }))
      .toEqual({ kind: "agent.stop", agentId: "a1", agentName: "implementation-harness:developer" });
  });

  it("should read a stopped background task as a killed agent", () => {
    expect(claudeCode.event({ hook_event_name: "PostToolUse", tool_name: "TaskStop", tool_input: { task_id: "a1" }, tool_response: {} }))
      .toEqual({ kind: "agent.kill", agentId: "a1" });
    expect(claudeCode.event({ hook_event_name: "PostToolUse", tool_name: "TaskStop", tool_input: {} })).toBeUndefined();
  });

  it("should pass the command whole, since it is matched against and never shown", () => {
    const command = `git commit -m "${"x".repeat(400)}"`;
    expect(claudeCode.event({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command, description: "Commit" } }))
      .toEqual({ kind: "tool.start", tool: "Bash", command, target: undefined, background: false, endReported: true });
  });

  it("should name the one field of a tool input the interface can show", () => {
    expect(claudeCode.event({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/repo/console/server/domain.ts" } }))
      .toMatchObject({ kind: "tool.start", tool: "Read", target: "/repo/console/server/domain.ts" });
    expect(claudeCode.event({ hook_event_name: "PreToolUse", tool_name: "Grep", tool_input: { pattern: "actionLabel", output_mode: "content" } }))
      .toMatchObject({ kind: "tool.start", tool: "Grep", target: "actionLabel" });
    expect(claudeCode.event({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: "developer", prompt: "…" } }))
      .toMatchObject({ kind: "tool.start", tool: "Agent", target: "developer" });
    expect(claudeCode.event({ hook_event_name: "PreToolUse", tool_name: "TodoWrite", tool_input: { todos: [] } }))
      .toMatchObject({ kind: "tool.start", tool: "TodoWrite", target: undefined });
  });

  it("should drop the notification that only says the session went quiet", () => {
    expect(claudeCode.event({ hook_event_name: "Notification", message: "Claude is waiting for your input" })).toBeUndefined();
    expect(claudeCode.event({ hook_event_name: "Notification", message: "Claude needs your permission to use Bash" }))
      .toEqual({ kind: "attention", message: "Claude needs your permission to use Bash", cause: "permission" });
  });

  it("should carry a tool response back for the merge request to be found in", () => {
    expect(claudeCode.event({ hook_event_name: "PostToolUse", tool_input: { command: "glab mr create" }, tool_response: { stdout: "ok" } }))
      .toEqual({ kind: "tool.end", command: "glab mr create", response: { stdout: "ok" } });
  });

  it("should turn a structured question into a question event", () => {
    const event = claudeCode.event({
      hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "q1",
      tool_input: { questions: [{ question: "Quelle base ?", header: "Branche", options: [{ label: "develop" }] }] },
    });
    expect(event).toMatchObject({ kind: "question", id: "q1" });
    expect(event && "questions" in event && event.questions).toHaveLength(1);
  });

  it("should not raise the question again on the call the harness already answered", () => {
    expect(claudeCode.event({
      hook_event_name: "PreToolUse", tool_name: "AskUserQuestion",
      tool_input: { questions: [{ question: "Quelle base ?", header: "Branche", options: [] }], answers: { "Quelle base ?": "develop" } },
    })).toBeUndefined();
  });

  it("should ignore an event the harness has no use for", () => {
    expect(claudeCode.event({ hook_event_name: "SessionStart" })).toBeUndefined();
    expect(claudeCode.event({})).toBeUndefined();
  });

  it("should hand the answers back in the shape Claude Code expects", () => {
    expect(claudeCode.questionAnswer({ questions: [] }, { "Quelle base ?": "develop" })).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { questions: [], answers: { "Quelle base ?": "develop" } },
      },
    });
  });
});

describe("engine event translation of a malformed agent payload", () => {
  it("should refuse an agent event without an agent type", () => {
    expect(claudeCode.event({ hook_event_name: "SubagentStart", agent_id: "a1" })).toBeUndefined();
    expect(claudeCode.event({ hook_event_name: "SubagentStop", agent_type: "" })).toBeUndefined();
  });

  it("should key an agent that reported no id on its name", () => {
    expect(claudeCode.event({ hook_event_name: "SubagentStart", agent_type: "developer" }))
      .toMatchObject({ kind: "agent.start", agentName: "developer" });
  });
});

describe("signals the health monitor reads from Claude Code", () => {
  it("should read the cause of a notification from its type before its wording", () => {
    expect(claudeCode.event({ hook_event_name: "Notification", notification_type: "permission_prompt", message: "Claude needs your permission" })).toMatchObject({ kind: "attention", cause: "permission" });
    expect(claudeCode.event({ hook_event_name: "Notification", notification_type: "elicitation_dialog", message: "Input needed" })).toMatchObject({ kind: "attention", cause: "terminal_interaction" });
    expect(claudeCode.event({ hook_event_name: "Notification", notification_type: "idle_prompt", message: "Anything" })).toBeUndefined();
    expect(claudeCode.event({ hook_event_name: "Notification", notification_type: "auth_success", message: "Logged in" })).toBeUndefined();
    expect(claudeCode.event({ hook_event_name: "Notification", message: "Something else" })).toMatchObject({ kind: "attention", cause: "unknown" });
  });

  it("should tell a subagent's call from the pilot's, and a background call from a foreground one", () => {
    expect(claudeCode.event({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "t1", agent_id: "a1", tool_input: { command: "npm test" } }))
      .toMatchObject({ kind: "tool.start", toolUseId: "t1", agentId: "a1", background: false, endReported: true });
    expect(claudeCode.event({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "t2", tool_input: { command: "npm run dev", run_in_background: true } }))
      .toMatchObject({ background: true });
    expect(claudeCode.event({ hook_event_name: "PreToolUse", tool_name: "Monitor", tool_use_id: "t3", tool_input: {} })).toMatchObject({ background: true, endReported: false });
    expect(claudeCode.event({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "t1", agent_id: "a1", tool_input: { command: "npm test" }, tool_response: {} }))
      .toMatchObject({ kind: "tool.end", toolUseId: "t1", agentId: "a1" });
  });

  it("should expect an end event only for the tools the plugin's PostToolUse hook matches, and see every call it waits on", () => {
    const hooks = JSON.parse(readFileSync(path.resolve(__dirname, "../../../hooks/hooks.json"), "utf8")) as { hooks: Record<string, { matcher?: string }[]> };
    const post = hooks.hooks.PostToolUse.map((entry) => entry.matcher ?? "").join("|").split("|");
    expect(new Set(post)).toEqual(END_REPORTED_TOOLS);
    const pre = hooks.hooks.PreToolUse.map((entry) => entry.matcher ?? "").join("|").split("|");
    expect(pre).toEqual(expect.arrayContaining(["Bash", "Monitor", "Agent"]));
  });
});
