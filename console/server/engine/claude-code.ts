import * as pty from "node-pty";
import { spawn as spawnChild } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pluginRoot, remoteControl, sessionPermissionMode } from "../config.js";
import { normalizeQuestion, normalizeText, withoutBundlerVariables } from "../domain.js";
import { findExecutable } from "../repository.js";
import type { ConversationMessage, HookOutput } from "../types.js";
import { createTrustPromptWatcher, trustAnswerKeys } from "./trust-prompt.js";
import type { Engine, EngineEvent, EngineSession, ScheduleOptions, ScheduleSession, StartOptions } from "./types.js";

/** Long enough for the paste to be read before the submission keystroke arrives. */
const SUBMIT_DELAY_MS = 150;
/** How long a refused session is given to leave on its own before it is ended for it. */
const REFUSAL_EXIT_MS = 2_000;

/**
 * A harness started from inside a Claude Code session inherits markers that make
 * the spawned session behave like a nested one, transcript saving included, and
 * the conversation is read from that transcript. The bundler variables of the
 * console itself go with them: the agent runs builds of its own.
 */
function sessionEnvironment() {
  const environment = withoutBundlerVariables(process.env);
  for (const key of Object.keys(environment)) if (key === "CLAUDECODE" || key === "CLAUDE_PID" || key.startsWith("CLAUDE_CODE_")) delete environment[key];
  return environment;
}

/**
 * Slash commands, task notifications, hook output and the hand-back of a
 * subagent reach the session as tagged blocks. The attributes are part of the
 * form: `<agent-message from="…">` carries one, and a pattern that closed on the
 * tag name alone let that whole frame through as if the user had typed it.
 */
const TAGGED_INPUT = /^<[a-z][a-z-]*(?:\s[^>]*)?>/;

/**
 * The idle notification, matched on rather than matched away: should Claude Code
 * ever reword it, the harness falls back to calling the user too often, never to
 * leaving a blocked run silent.
 */
const IDLE_NOTIFICATION = /waiting for your input/i;

/**
 * Notification types Claude Code names. `idle_prompt` repeats the Stop event;
 * `auth_success` blocks nothing. A notification without a type falls back on
 * its message.
 */
const NOTIFICATION_CAUSES: Record<string, "permission" | "terminal_interaction" | null> = {
  permission_prompt: "permission",
  elicitation_dialog: "terminal_interaction",
  idle_prompt: null,
  auth_success: null,
};

/**
 * The tools whose end is reported by a PostToolUse hook: the matcher of
 * hooks/hooks.json. Any other call ends, as far as the console can tell, with
 * the turn of whoever made it.
 */
export const END_REPORTED_TOOLS = new Set(["Bash", "TaskStop"]);

/** A call that returns at once and wakes the pilot up later: a command in the background, a monitor. */
function backgroundCall(tool: string | undefined, input: Record<string, unknown> | undefined) {
  if (tool === "Monitor") return true;
  return tool === "Bash" && input?.run_in_background === true;
}

/**
 * The console submits an instruction as a bracketed paste, so Claude Code
 * records it wrapped in a paste marker. The dialogue shows what the user wrote,
 * not how it reached the session.
 */
const PASTE_MARKER = /<\/?pasted_content(?:\s[^>]*)?>/g;

const unwrapPaste = (text: string) => text.replace(PASTE_MARKER, "").trim();

function textOf(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text: string } => Boolean(block) && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
    .join("\n\n");
}

function conversationLine(line: string): ConversationMessage | undefined {
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!entry || typeof entry !== "object") return undefined;
  // Sidechains are the subagents talking to themselves, meta entries are the
  // expanded prompt of a slash command: neither is the dialogue.
  if (entry.isSidechain === true || entry.isMeta === true) return undefined;
  const id = typeof entry.uuid === "string" ? entry.uuid : undefined;
  if (!id) return undefined;
  const at = typeof entry.timestamp === "string" ? entry.timestamp : new Date().toISOString();
  // An instruction typed while Claude Code is mid-turn is recorded as a queued
  // command instead of a user message.
  if (entry.type === "attachment") {
    const attachment = entry.attachment as { type?: unknown; prompt?: unknown } | undefined;
    if (attachment?.type !== "queued_command" || typeof attachment.prompt !== "string") return undefined;
    const queued = unwrapPaste(attachment.prompt);
    return queued && !TAGGED_INPUT.test(queued) ? { id, at, author: "user", text: queued } : undefined;
  }
  const author = entry.type === "assistant" ? "claude" as const : entry.type === "user" ? "user" as const : undefined;
  if (!author) return undefined;
  const message = entry.message as { content?: unknown } | undefined;
  const body = textOf(message?.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  const text = author === "user" ? unwrapPaste(body) : body;
  if (!text || (author === "user" && TAGGED_INPUT.test(text))) return undefined;
  return { id, at, author, text };
}

function questionEvent(payload: Record<string, unknown>): EngineEvent | undefined {
  const input = payload.tool_input as Record<string, unknown> | undefined;
  // The hook fires again on the call the harness itself completed, and that
  // second pass carries the answers: it must not raise the question anew.
  if (!input || (input.answers && typeof input.answers === "object")) return undefined;
  const questions = Array.isArray(input.questions)
    ? input.questions.flatMap((question) => {
      const normalized = normalizeQuestion(question);
      return normalized ? [normalized] : [];
    })
    : [];
  if (questions.length === 0) return undefined;
  return { kind: "question", id: normalizeText(payload.tool_use_id), questions, input };
}

/**
 * The one field of a tool input worth naming in the interface. Claude Code puts
 * it under a different key for every tool, and which key won is of no interest
 * above this layer: what comes out is the file, the pattern, the agent or the
 * address the call is about, left raw for the caller to shorten as it sees fit.
 */
const TARGET_KEYS = ["file_path", "notebook_path", "pattern", "subagent_type", "skill", "url", "path"];

function toolTarget(input: Record<string, unknown> | undefined) {
  for (const key of TARGET_KEYS) {
    const target = normalizeText(input?.[key]);
    if (target) return target;
  }
  return undefined;
}

/**
 * The plan tasks a delegation is about. The workflow hands every developer the
 * report file it must write, suffixed with its task id, and that suffix is the
 * only link between an agent launch and the plan.
 */
const PLAN_TASK_REPORT = /developer-report-([A-Za-z0-9_.-]+?)\.md/g;

function delegatedPlanTaskIds(tool: string | undefined, input: Record<string, unknown> | undefined) {
  if (tool !== "Agent" && tool !== "Task") return undefined;
  const text = [input?.description, input?.prompt].filter((value) => typeof value === "string").join("\n");
  const ids = [...new Set([...text.matchAll(PLAN_TASK_REPORT)].map((match) => match[1]))];
  return ids.length > 0 ? ids : undefined;
}

function event(payload: Record<string, unknown>): EngineEvent | undefined {
  const name = normalizeText(payload.hook_event_name) ?? "Hook";
  if (name === "SubagentStart" || name === "SubagentStop") {
    // A payload that names no agent describes nothing the interface could show,
    // and an agent entered under an empty name would never be closed by its own
    // stop event.
    const agentName = normalizeText(payload.agent_type);
    if (!agentName) return undefined;
    const agentId = normalizeText(payload.agent_id) ?? `${agentName}-${Date.now()}`;
    return { kind: name === "SubagentStart" ? "agent.start" : "agent.stop", agentId, agentName };
  }
  if (name === "Notification") {
    const message = normalizeText(payload.message);
    const type = normalizeText(payload.notification_type);
    // Claude Code notifies a minute after the session last printed, background
    // agent still working or not, so the idle one repeats what the Stop event
    // already said, later and less accurately. Every other notification, a
    // permission request first of all, really does block on the user.
    if (type && type in NOTIFICATION_CAUSES) {
      const cause = NOTIFICATION_CAUSES[type];
      return cause ? { kind: "attention", message, cause } : undefined;
    }
    if (message && IDLE_NOTIFICATION.test(message)) return undefined;
    return { kind: "attention", message, cause: message && /permission/i.test(message) ? "permission" : "unknown" };
  }
  if (name === "Stop") return { kind: "turn.end" };
  const input = payload.tool_input as Record<string, unknown> | undefined;
  // The command is passed whole: what is shown gets shortened, what is matched
  // against must not be.
  const command = typeof input?.command === "string" ? input.command : undefined;
  // Filled only when the hook fired inside a subagent: the pilot's own calls carry none.
  const caller = normalizeText(payload.agent_id);
  const toolUseId = normalizeText(payload.tool_use_id);
  if (name === "PreToolUse") {
    const tool = normalizeText(payload.tool_name);
    if (tool === "AskUserQuestion") return questionEvent(payload);
    const planTaskIds = delegatedPlanTaskIds(tool, input);
    return {
      kind: "tool.start", tool: tool ?? "", command, target: toolTarget(input), ...(planTaskIds ? { planTaskIds } : {}),
      ...(toolUseId ? { toolUseId } : {}), ...(caller ? { agentId: caller } : {}),
      background: backgroundCall(tool, input), endReported: END_REPORTED_TOOLS.has(tool ?? ""),
    };
  }
  if (name === "PostToolUse") {
    // Claude Code fires no SubagentStop for a background agent it kills.
    if (normalizeText(payload.tool_name) === "TaskStop") {
      const agentId = normalizeText(input?.task_id) ?? normalizeText(input?.shell_id);
      return agentId ? { kind: "agent.kill", agentId } : undefined;
    }
    return { kind: "tool.end", command, response: payload.tool_response, ...(toolUseId ? { toolUseId } : {}), ...(caller ? { agentId: caller } : {}) };
  }
  return undefined;
}

function start({ cwd, sessionLabel, runId, command, pluginDir, hookUrl, hookSpool, environment, onData, onExit, onEvent }: StartOptions): EngineSession {
  const executable = findExecutable("claude");
  if (!executable) throw new Error("Claude Code est introuvable dans PATH.");
  const sessionName = `implementation-harness ${sessionLabel}`;
  // --remote-control takes an optional name, so leaving it empty would let the
  // parser swallow the prompt that follows as that name.
  const remote = remoteControl ? ["--remote-control", sessionName] : [];
  const terminal = pty.spawn(executable, ["--plugin-dir", pluginDir, "--permission-mode", sessionPermissionMode, "--model", "opus", "--name", sessionName, ...remote, command], {
    name: "xterm-256color", cols: 120, rows: 34, cwd,
    env: { ...sessionEnvironment(), ...environment, TERM: "xterm-256color", COLORTERM: "truecolor", IMPL_RUN_ID: runId, IMPL_HARNESS_HOOK_URL: hookUrl, IMPL_HOOK_SPOOL: hookSpool },
  });
  let alive = true;
  // The folder trust dialog comes before any hook: the terminal is where it is read from.
  const trust = createTrustPromptWatcher();
  terminal.onData((data) => {
    onData(data);
    const change = trust.feed(data);
    if (change === "shown") onEvent?.({ kind: "session.prompt", prompt: "folder_trust", directory: cwd });
    else if (change === "gone") onEvent?.({ kind: "session.prompt.end" });
  });
  terminal.onExit(({ exitCode }) => { alive = false; onExit(exitCode); });
  return {
    write: (data) => terminal.write(data),
    submit: (text) => {
      // Claude Code reads a burst of characters as a paste, and a carriage return
      // inside that burst is pasted content: it lands as a newline in the prompt
      // and the instruction is never submitted. The text goes as an explicit
      // paste, the submission as a keystroke of its own.
      terminal.write(`\u001b[200~${text}\u001b[201~`);
      setTimeout(() => { if (alive) terminal.write("\r"); }, SUBMIT_DELAY_MS);
    },
    resize: (cols, rows) => terminal.resize(cols, rows),
    kill: () => { alive = false; terminal.kill(); },
    answerPrompt: (decision) => {
      if (!alive || !trust.shown) return false;
      const keys = trustAnswerKeys(decision, trust.selected);
      trust.answered();
      // One keystroke per write: a burst is read as a paste, and the arrow would never move the cursor.
      keys.forEach((key, index) => setTimeout(() => { if (alive) terminal.write(key); }, index * SUBMIT_DELAY_MS));
      // A refusal ends the session whatever the dialog made of the keystroke.
      if (decision === "refuse") setTimeout(() => { if (alive) { alive = false; terminal.kill(); } }, REFUSAL_EXIT_MS).unref();
      return true;
    },
  };
}

/** What a scheduling session may do: read the tickets and the repository, write its output file, and nothing else. */
const SCHEDULE_TOOLS = [
  "Read", "Write", "Glob", "Grep", "Agent", "Skill",
  "Bash(glab issue view *)", "Bash(glab api *)",
  "Bash(git log *)", "Bash(git show *)", "Bash(git grep *)", "Bash(git ls-files *)", "Bash(git rev-parse *)",
  "Bash(ls *)",
];

/**
 * The arguments of a headless scheduling session. `--allowedTools` is variadic:
 * the list goes as one comma-separated argument and `--` closes the options,
 * or the flag swallows the prompt. The session may remove its own output file,
 * which is how the command reports an output it could not make valid.
 */
export function scheduleArguments({ pluginDir, inputPath, outputPath }: Pick<ScheduleOptions, "pluginDir" | "inputPath" | "outputPath">) {
  const outputDirectory = path.dirname(outputPath);
  return [
    "-p",
    "--plugin-dir", pluginDir,
    "--add-dir", pluginDir,
    "--add-dir", outputDirectory,
    "--model", "sonnet",
    "--permission-mode", "dontAsk",
    "--permission-prompts", "none",
    "--allowedTools", [...SCHEDULE_TOOLS, `Bash(rm ${outputDirectory}/*)`].join(","),
    "--output-format", "json",
    "--", `/implementation-harness:schedule ${inputPath} ${outputPath}`,
  ];
}

/**
 * The environment of a scheduling session. The plugin hooks load there too
 * and must stay silent: without a run identifier and a hook address they post
 * nothing, even when the console itself was started from inside a run.
 */
export function scheduleEnvironment<T extends Record<string, string | undefined>>(environment: T): T {
  const cleaned = { ...environment };
  for (const key of ["IMPL_RUN_ID", "IMPL_HARNESS_HOOK_URL", "IMPL_HOOK_SPOOL"]) delete cleaned[key];
  return cleaned;
}

const SCHEDULE_LOG = 20_000;

function startSchedule(options: ScheduleOptions): ScheduleSession | undefined {
  const executable = findExecutable("claude");
  if (!executable) return undefined;
  // Standard input closed: an open one is read as the prompt.
  const child = spawnChild(executable, scheduleArguments(options), { cwd: options.repository, env: scheduleEnvironment(sessionEnvironment()), stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  let timedOut = false;
  const keep = (chunk: Buffer) => { log = (log + chunk.toString()).slice(-SCHEDULE_LOG); };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  const finished = new Promise<{ timedOut: boolean; log: string }>((resolve) => {
    const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, options.timeoutMs);
    const done = () => { clearTimeout(timeout); resolve({ timedOut, log }); };
    child.once("close", done);
    child.once("error", (error) => { log += `\n${error.message}`; done(); });
  });
  return { finished, kill: () => { child.kill("SIGKILL"); } };
}

export const claudeCode: Engine = {
  id: "claude-code",
  label: "Claude Code",
  locate: () => findExecutable("claude"),
  command: (issueUrl, instruction) => `/implementation-harness:implement ${issueUrl}${instruction ? ` ${instruction}` : ""}`,
  start,
  taskDirectory: (cwd) => path.join(cwd, ".claude", "tasks"),
  transcriptPath: (payload) => {
    const inner = payload.payload as Record<string, unknown> | undefined;
    const transcript = inner?.transcript_path;
    return typeof transcript === "string" && transcript ? transcript : undefined;
  },
  conversationLine,
  event,
  questionAnswer: (input, answers): HookOutput => ({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { ...input, answers } },
  }),
  startSchedule,
  startSelfImprovement: ({ worktreeName, feedbackDirectory, runId }) => {
    const executable = findExecutable("claude");
    if (!executable) return undefined;
    return spawnChild(executable, [
      "--background", "--worktree", worktreeName,
      "--add-dir", pluginRoot,
      "--plugin-dir", pluginRoot,
      "--permission-mode", "auto",
      "--name", `implementation-harness self-improvement ${runId.slice(-8)}`,
      `/implementation-harness:improve ${feedbackDirectory}`,
    ], { cwd: pluginRoot, env: { ...sessionEnvironment(), CLAUDE_CODE_AUTO_MODE_SERVER: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  },
  startConflictResolution: ({ worktreeName, onto }) => {
    const executable = findExecutable("claude");
    if (!executable) return undefined;
    return spawnChild(executable, [
      "--background", "--worktree", worktreeName,
      "--add-dir", pluginRoot,
      "--plugin-dir", pluginRoot,
      "--permission-mode", "auto",
      "--name", `implementation-harness rebase ${worktreeName.slice(-8)}`,
      `/implementation-harness:rebase ${onto}`,
    ], { cwd: pluginRoot, env: { ...sessionEnvironment(), CLAUDE_CODE_AUTO_MODE_SERVER: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  },
};
