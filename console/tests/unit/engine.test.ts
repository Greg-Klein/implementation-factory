import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { claudeCode, END_REPORTED_TOOLS, scheduleArguments, scheduleEnvironment, sessionArguments } from "../../server/engine/claude-code";
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
    const untargeted = claudeCode.event({ hook_event_name: "PreToolUse", tool_name: "TodoWrite", tool_input: { todos: [] } });
    expect(untargeted).toMatchObject({ kind: "tool.start", tool: "TodoWrite" });
    expect(untargeted).not.toHaveProperty("target");
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
    const post = hooks.hooks.PostToolUse!.map((entry) => entry.matcher ?? "").join("|").split("|");
    expect(new Set(post)).toEqual(END_REPORTED_TOOLS);
    const pre = hooks.hooks.PreToolUse!.map((entry) => entry.matcher ?? "").join("|").split("|");
    expect(pre).toEqual(expect.arrayContaining(["Bash", "Monitor", "Agent"]));
  });
});

describe("the pilot's session", () => {
  const args = sessionArguments({ pluginDir: "/opt/harness", sessionName: "implementation-harness run-1", command: "/implementation-harness:implement https://gitlab.com/g/p/-/issues/1" });
  const valueOf = (flag: string) => args[args.indexOf(flag) + 1]!;

  it("should load the plugin on Opus and end with the command", () => {
    expect(valueOf("--plugin-dir")).toBe("/opt/harness");
    expect(valueOf("--model")).toBe("opus");
    expect(args.at(-1)).toBe("/implementation-harness:implement https://gitlab.com/g/p/-/issues/1");
  });

  it("should replace the user's output style with the concise one", () => {
    expect(JSON.parse(valueOf("--settings"))).toEqual({ outputStyle: "Concise" });
  });
});

describe("the headless scheduling session", () => {
  const options = { pluginDir: "/opt/harness", inputPath: "/data/schedule/call-1/input.json", outputPath: "/data/schedule/call-1/output.json" };
  const args = scheduleArguments(options);
  const valueOf = (flag: string) => args[args.indexOf(flag) + 1]!;

  it("should run without a terminal, on Sonnet, asking nothing", () => {
    expect(args[0]).toBe("-p");
    expect(valueOf("--model")).toBe("sonnet");
    expect(valueOf("--permission-mode")).toBe("dontAsk");
    expect(valueOf("--permission-prompts")).toBe("none");
    expect(valueOf("--output-format")).toBe("json");
  });

  it("should leave the user's own settings out, so a personal hook cannot rewrite a command into a refused one", () => {
    expect(valueOf("--setting-sources")).toBe("project,local");
  });

  it("should load the plugin and reach the plugin and the output directory", () => {
    expect(valueOf("--plugin-dir")).toBe("/opt/harness");
    expect(args.flatMap((arg, index) => arg === "--add-dir" ? [args[index + 1]] : [])).toEqual(["/opt/harness", "/data/schedule/call-1"]);
  });

  it("should pass the allowed tools as one argument, so the variadic flag cannot swallow the prompt", () => {
    const tools = valueOf("--allowedTools");
    expect(args.filter((arg) => arg === "--allowedTools")).toHaveLength(1);
    expect(tools.split(",")).toEqual([
      "Read", "Write", "Glob", "Grep", "Agent", "Skill",
      "Bash(glab issue view *)", "Bash(glab api *)",
      "Bash(gh issue view *)", "Bash(gh api *)",
      "Bash(git log *)", "Bash(git show *)", "Bash(git grep *)", "Bash(git ls-files *)", "Bash(git rev-parse *)",
      "Bash(ls *)", "Bash(rm /data/schedule/call-1/*)",
    ]);
    // Nothing that writes to the repository or to GitLab.
    expect(tools).not.toMatch(/Edit|git (?:checkout|switch|commit|push|fetch|stash)|glab mr/);
    expect(args[args.indexOf("--allowedTools") + 2]).not.toMatch(/^Bash/);
  });

  it("should close the options before the prompt, which is the schedule command with its two paths", () => {
    expect(args.at(-2)).toBe("--");
    expect(args.at(-1)).toBe("/implementation-harness:schedule /data/schedule/call-1/input.json /data/schedule/call-1/output.json");
  });

  it("should keep the plugin hooks silent: no run identifier, no hook address, no spool", () => {
    expect(scheduleEnvironment({ PATH: "/usr/bin", IMPL_RUN_ID: "run-1", IMPL_HARNESS_HOOK_URL: "http://127.0.0.1:3210/api/hooks?token=x", IMPL_HOOK_SPOOL: "/data/runs/run-1/hooks-spool.jsonl" }))
      .toEqual({ PATH: "/usr/bin" });
  });

  it("should name its output file to the guard, and never inherit the one of another session", () => {
    expect(scheduleEnvironment({ PATH: "/usr/bin", IMPL_RUN_ID: "run-1" }, "/data/schedule/call-1/output.json"))
      .toEqual({ PATH: "/usr/bin", IMPL_SCHEDULE_OUTPUT: "/data/schedule/call-1/output.json" });
    expect(scheduleEnvironment({ PATH: "/usr/bin", IMPL_SCHEDULE_OUTPUT: "/data/schedule/call-0/output.json" })).toEqual({ PATH: "/usr/bin" });
  });
});
