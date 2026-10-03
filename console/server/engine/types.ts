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
  /**
   * Answers the prompt the session raised as `session.prompt`, in the keystrokes
   * the agent expects. False when no such prompt is on screen any more, and
   * then nothing was typed.
   */
  answerPrompt(decision: SessionPromptDecision): boolean;
};

/** `accept`: let the session go on; `refuse`: the session ends, which is what the agent does with a refusal. */
export type SessionPromptDecision = "accept" | "refuse";

export type StartOptions = {
  /** Where the session runs: the worktree of the run. */
  cwd: string;
  /** What the session is named after: the repository the run belongs to, never the worktree directory. */
  sessionLabel: string;
  runId: string;
  /** The workflow entry point, already built by the engine and logged by the caller. */
  command: string;
  /** The plugin the session loads: the harness checkout itself. */
  pluginDir: string;
  /** Where the agent posts its events, secret included. */
  hookUrl: string;
  /** The file an event goes to when posting it failed, replayed by the harness later. */
  hookSpool: string;
  /** Variables the workflow reads, set in the agent's environment as they are. */
  environment?: Record<string, string>;
  onData(data: string): void;
  onExit(exitCode: number): void;
  /** What the agent says outside of its hooks: read off the terminal by the engine, the only code that knows what to look for. */
  onEvent?(event: EngineEvent): void;
};

/** One headless scheduling session: where it runs, and the two files of contracts/schedule.md. */
export type ScheduleOptions = {
  /** The main checkout of the repository the tickets belong to: the session runs there and reads it. */
  repository: string;
  pluginDir: string;
  /** Absolute, outside the repository. `outputPath` is fresh for every call, so a stale file is never read as a result. */
  inputPath: string;
  outputPath: string;
  /** After this long the session is killed and counts as failed. */
  timeoutMs: number;
};

/**
 * A scheduling session in flight. `finished` resolves when the process is
 * gone, however it went: its exit code says nothing about success, only the
 * output file does. `log` is the end of what it printed, kept for a diagnosis.
 */
export type ScheduleSession = { finished: Promise<{ timedOut: boolean; log: string }>; kill(): void };

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
  | { kind: "turn.end" }
  /**
   * The agent stopped at a prompt of its own before the session really started,
   * where no hook can fire. `folder_trust`: it asks whether the directory it was
   * started in may be trusted. Answered through `EngineSession.answerPrompt`.
   */
  | { kind: "session.prompt"; prompt: "folder_trust"; directory: string }
  /** That prompt left the screen, answered in the terminal or not. */
  | { kind: "session.prompt.end" };

/**
 * What one session of a run consumed: the pilot (no `agentId`) or one subagent.
 * A `call` is one request to the model. `firstContextTokens`: what the session
 * read before doing anything; `peakContextTokens`: the largest context of a call.
 */
export type SessionUsage = {
  sessionId: string;
  agentId?: string;
  agentType?: string;
  model?: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  firstContextTokens: number;
  peakContextTokens: number;
};

/** Where the usage of a run is read from. `isolated`: `cwd` belongs to this run alone, so every session found for it is the run's. */
export type UsageSource = { transcriptPath?: string; cwd: string; isolated: boolean };

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
  /** What the sessions of a run consumed so far, the pilot's and each subagent's. Empty when the agent keeps no such record. */
  sessionUsage(source: UsageSource): Promise<SessionUsage[]>;
  event(payload: Record<string, unknown>): EngineEvent | undefined;
  /** What the agent expects back once the user has answered a question. */
  questionAnswer(input: Record<string, unknown>, answers: Record<string, string>): unknown;
  /**
   * Predicts, without a terminal, which tickets of a batch conflict in one
   * repository. Reports nothing to the harness while it runs: no run owns it.
   * Undefined when the agent is not installed.
   */
  startSchedule(options: ScheduleOptions): ScheduleSession | undefined;
  /** Runs the self-improvement workflow on its own, detached from any run. Undefined when the agent is not installed. */
  startSelfImprovement(options: { worktreeName: string; feedbackDirectory: string; runId: string }): BackgroundProcess | undefined;
  /** Replays an improvement branch git alone could not, inside the worktree it already lives in. Undefined when the agent is not installed. */
  startConflictResolution(options: { worktreeName: string; onto: string }): BackgroundProcess | undefined;
};
