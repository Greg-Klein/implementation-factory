import type { Question } from "./domain.js";

export type RunStatus = "idle" | "starting" | "running" | "attention" | "completed" | "stopped" | "failed";
/** `abandoned`: the agent was stopped, or the run ended, before it ever reported an outcome, so it has none to read. */
export type AgentStatus = "running" | "completed" | "failed" | "abandoned";
/** `nickname`: a first name given in start order within the run, so two agents of one type can be told apart; `avatar`: the picture bound to that name; `role`: the short French label of its type. */
export type AgentState = { id: string; name: string; nickname?: string; avatar?: string; role?: string; status: AgentStatus; startedAt: string; endedAt?: string };
export type Activity = { id: string; at: string; kind: "system" | "agent" | "tool" | "artifact" | "attention"; title: string; detail?: string };
export type PendingQuestion = { id: string; questions: Question[] };
/**
 * One worktree the improvement loop left for a verdict, independent of any run: it is
 * discovered by listing worktrees, never tied to the run that happened to spawn it.
 * `mergesCleanly` is false when the branch no longer merges into the harness even
 * after the automatic replay, which means a conflict git cannot resolve on its own:
 * the promotion is not one click.
 */
export type PendingSelfImprovementReview = { worktreeName: string; branch?: string; commits: number; mergesCleanly?: boolean; status: "analyzing" | "ready" | "orphaned" };
export type ConversationMessage = { id: string; at: string; author: "claude" | "user"; text: string; pending?: boolean };
/** One task of `planner-output.json`, placed on the "Suivi" board by what the run has done with it. */
export type PlanTaskStatus = "todo" | "in_progress" | "done";
/** `assignee`: the agent that last took the task, by id and by the name and role the interface calls it. */
export type PlanTask = { id: string; title: string; complexity?: string; status: PlanTaskStatus; assignee?: { agentId: string; nickname?: string; avatar?: string; role?: string } };
/** A developer handed plan tasks, paired with the agent it became once that agent starts. */
export type PlanDelegation = { agentType: string; taskIds: string[]; agentId?: string };
export type RunState = {
  id: string | null; status: RunStatus; phase: number; cwd: string; issueUrl: string; instruction: string;
  startedAt: string | null; endedAt: string | null; agents: AgentState[]; activities: Activity[]; messages: ConversationMessage[]; artifacts: string[]; branch?: string; mergeRequestUrl?: string; pendingQuestion?: PendingQuestion; error?: string;
  /** The engine process behind this run is still up, taking input, whether or not the workflow itself has finished. */
  sessionActive: boolean;
  /** What the agent is doing at this instant, from the tool it last called. Cleared as soon as it hands control back. */
  action?: string;
  /** When a file of the "Preuves" tab was last written, a rewrite by a later review round included. */
  evidenceUpdatedAt?: string;
  /** Read from GitLab once the run has started; absent until then, or when GitLab could not be reached. */
  ticketTitle?: string;
  /** The tasks of the plan, absent until `planner-output.json` has been read. */
  planTasks?: PlanTask[];
  /** Every developer handed plan tasks, in launch order, kept so the board survives the archive. */
  planDelegations?: PlanDelegation[];
};

/**
 * A run as the list of runs shows it. Deliberately not a `RunState`: the list is
 * broadcast to every open page on every event of every run, and carrying four
 * hundred messages, a thousand activities and every artifact path of each run
 * through that would make one busy run slow the whole console down. Everything
 * the side list needs to draw a row, raise a dot or ring a notification is here;
 * the rest arrives only for the run the page has opened.
 */
export type RunSummary = {
  id: string; status: RunStatus; phase: number; cwd: string; issueUrl: string; ticketTitle?: string;
  startedAt: string | null; endedAt: string | null;
  branch?: string; mergeRequestUrl?: string; error?: string; action?: string;
  sessionActive: boolean;
  /** How many decisions this run is blocked on, and which batch they belong to, so an alert fires once per batch. */
  pendingQuestionId?: string;
  pendingQuestionCount: number;
  runningAgents: number;
  /** What the unread dots of this row are measured against, same pair as inside the run view. */
  lastMessageId?: string;
  lastMessageAuthor?: ConversationMessage["author"];
  evidenceUpdatedAt?: string;
  /** Whether this run still holds its slot and its checkout, which is what the queue waits on. */
  holdsRepository: boolean;
};

/** A launch the console accepted but has not started yet, kept in the order it was asked. */
export type QueuedRun = { id: string; cwd: string; issueUrl: string; instruction: string; queuedAt: string };
/**
 * Why a queued launch has not started, computed when the queue is read rather
 * than stored: a run ending changes the answer for every entry behind it.
 */
export type QueuedRunView = QueuedRun & { reason: "slot" | "repository"; blockedBy?: string };

/** Everything every open page is told about, whichever run it has opened. */
export type HarnessSnapshot = { runs: RunSummary[]; queued: QueuedRunView[]; maxConcurrentRuns: number };

export type RepositoryOption = { project: string; path: string; resolvedPath: string; exists: boolean };
export type HookOutput = { hookSpecificOutput: { hookEventName: "PreToolUse"; permissionDecision: "allow"; updatedInput: Record<string, unknown> } };

/**
 * Every message that acts on a run names it. The console holds several at once
 * and the page that sends this one is not necessarily showing the run the user
 * last opened, so nothing is ever applied to an implicit "current" run.
 */
export type ClientMessage =
  | { type: "run.start"; cwd: string; issueUrl: string; instruction?: string }
  | { type: "run.subscribe"; runId: string | null }
  | { type: "terminal.input"; runId: string; data: string }
  | { type: "instruction.send"; runId: string; text: string }
  | { type: "terminal.resize"; runId: string; cols: number; rows: number }
  | { type: "run.stop"; runId: string }
  | { type: "run.close"; runId: string }
  | { type: "queue.cancel"; queuedId: string }
  | { type: "demo.start" }
  | { type: "feedback.submit"; runId: string; body: string }
  | { type: "question.answer"; runId: string; answers: Record<string, string> }
  | { type: "selfImprovement.approve"; worktreeName: string }
  | { type: "selfImprovement.reject"; worktreeName: string };

export type ServerMessage =
  /** The list of runs and the queue, sent to every page on every change. */
  | { type: "harness"; snapshot: HarnessSnapshot }
  /** The full state of one run, sent only to the pages that opened it. */
  | { type: "run"; state: RunState }
  | { type: "terminal.output"; runId: string; data: string }
  /**
   * Something the harness did that belongs to no run: the improvement loop
   * replaying a branch, a queued launch that could not start. It used to land in
   * the activity feed of whichever run happened to be current, which with
   * several runs means a feed picked at random. `queuedId` names the waiting
   * launch a notice is about, so the page can drop it once that launch is gone.
   */
  | { type: "notice"; level: "info" | "attention"; title: string; detail?: string; at: string; queuedId?: string }
  /** A launch or a panel action that failed, answered to the page that asked for it. */
  | { type: "error"; message: string; runId?: string };
