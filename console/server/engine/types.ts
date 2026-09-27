import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { Question } from "../domain.js";
import type { ConversationMessage } from "../types.js";

/** Spawned with stdio ["ignore", "pipe", "pipe"], so both output streams are readable. */
export type BackgroundProcess = ChildProcessByStdio<null, Readable, Readable>;

/**
 * Everything the harness needs from the coding agent it drives, and nothing
 * else. The harness above this line knows about runs, phases, agents and
 * documents; only an implementation below it knows about a particular agent's
 * executable, its hook vocabulary and its transcript format.
 *
 * There is one implementation today, claude-code. The interface exists so that
 * a second one is a file to write rather than a surgery to perform. See
 * ~/workspace/opencode-question-bridge for the spike that proved the hardest
 * part of it, the blocking question, is portable.
 */

export type EngineSession = {
  /** Raw keystrokes from the embedded terminal. */
  write(data: string): void;
  /** An instruction typed in the interface, submitted the way this agent expects. */
  submit(text: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};

export type StartOptions = {
  cwd: string;
  runId: string;
  /** The workflow entry point, already built by the engine and logged by the caller. */
  command: string;
  /** The plugin the session loads, with the prompts edited in the settings. */
  pluginDir: string;
  /** Instructions appended to the agent's own system prompt. */
  systemPrompt?: string;
  /** Where the agent posts its events, secret included. */
  hookUrl: string;
  /** The file an event goes to when posting it failed, replayed by the harness later. */
  hookSpool: string;
  /** Variables the workflow reads, set in the agent's environment as they are. */
  environment?: Record<string, string>;
  onData(data: string): void;
  onExit(exitCode: number): void;
};

/**
 * One thing the agent reported, said in the harness's own words. Whatever
 * shape the agent uses for hooks, events or notifications reaches the harness
 * as one of these.
 */
export type EngineEvent =
  | { kind: "agent.start"; agentId: string; agentName: string }
  | { kind: "agent.stop"; agentId: string; agentName: string }
  /** The agent was stopped from the outside, which reports no outcome of its own. */
  | { kind: "agent.kill"; agentId: string }
  /**
   * What the harness reads from a tool call: the command it may recognise, and
   * the name of the tool with a neutral `target` (a file, a pattern, an agent,
   * a host) for the interface to say what the agent is doing right now.
   * `planTaskIds`: the tasks of the plan a delegation was handed, if any.
   */
  | {
    kind: "tool.start"; tool: string; command?: string; target?: string; planTaskIds?: string[];
    /** Pairs this start with its end, when the agent reports both. */
    toolUseId?: string;
    /** The subagent that made the call; absent when the pilot itself did. */
    agentId?: string;
    /** The call hands back at once and keeps working, and the pilot is woken up when it is done: a wait, not an action. */
    background?: boolean;
    /** Whether an end event will follow for this call. Without one, the call ends with its caller's turn. */
    endReported?: boolean;
  }
  | { kind: "tool.end"; command?: string; response: unknown; toolUseId?: string; agentId?: string }
  | { kind: "question"; id?: string; questions: Question[]; input: Record<string, unknown> }
  /**
   * The agent calls for the user. `cause`: a permission prompt, another
   * interaction only the terminal can answer, or nothing the agent said.
   */
  | { kind: "attention"; message?: string; cause: "permission" | "terminal_interaction" | "unknown" }
  /** The pilot handed control back, which does not mean the workflow is over. A subagent's end is `agent.stop`. */
  | { kind: "turn.end" };

export type Engine = {
  readonly id: string;
  /** How the agent is named in the interface, in errors and in the activity feed. */
  readonly label: string;
  /** The executable, or null when it is not installed. */
  locate(): string | null;
  /** The command that starts the workflow on a ticket. */
  command(issueUrl: string, instruction: string): string;
  start(options: StartOptions): EngineSession;
  /** Where the workflow leaves its documents inside the project. */
  taskDirectory(cwd: string): string;
  /** The file the dialogue is read from, named by the agent in its own events. */
  transcriptPath(payload: Record<string, unknown>): string | undefined;
  /** One line of that file, or nothing when the line is not part of the dialogue. */
  conversationLine(line: string): ConversationMessage | undefined;
  event(payload: Record<string, unknown>): EngineEvent | undefined;
  /** What the agent expects back once the user has answered a question. */
  questionAnswer(input: Record<string, unknown>, answers: Record<string, string>): unknown;
  /** Runs the self-improvement workflow on its own, detached from any run. Undefined when the agent is not installed. */
  startSelfImprovement(options: { worktreeName: string; feedbackDirectory: string; runId: string }): BackgroundProcess | undefined;
  /** Replays an improvement branch git alone could not, inside the worktree it already lives in. Undefined when the agent is not installed. */
  startConflictResolution(options: { worktreeName: string; onto: string }): BackgroundProcess | undefined;
};
