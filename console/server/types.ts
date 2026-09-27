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
/**
 * `assignee`: the agent that last took the task, by id and by the name and role the interface calls it.
 * `criterionIds` and `dependencies` are kept as the plan wrote them. "done" means a report exists, never that a criterion is verified.
 */
export type PlanTask = { id: string; title: string; complexity?: string; status: PlanTaskStatus; assignee?: { agentId: string; nickname?: string; avatar?: string; role?: string }; criterionIds?: string[]; dependencies?: string[] };

/** What the server concluded about one acceptance criterion, or one of its checks. See server/acceptance.ts. */
export type AcceptanceStatus = "verified" | "unverified" | "blocked" | "failed";
export type AcceptanceCounts = { total: number; verified: number; failed: number; blocked: number; unverified: number; stale: number };
/**
 * The compact side of the "Preuves" tab, carried by the run state and the side list.
 * `available`: the run wrote a criteria registry; without one the tab falls back on the reports alone.
 * `revision` moves every time the computation is redone with a different result.
 */
export type AcceptanceDigest = { available: boolean; revision: number; updatedAt: string; counts: AcceptanceCounts; diagnostics: number };

export type EvidenceSource = "qa" | "design" | "developer";
export type EvidenceMethod = "test" | "browser" | "static_analysis" | "manual";
/** `observed`: a measurement the producer made; `reported`: what an agent says of its own work; `confirmation`: a check of an earlier piece of evidence, named by `confirms`. */
export type EvidenceBasis = "observed" | "reported" | "confirmation";
/**
 * Whether a piece of evidence describes the code as it stands: `stale` when the
 * code changed since, `unknown` when its version cannot be established,
 * `inconclusive` when the code moved while it was being measured.
 */
export type EvidenceFreshness = "current" | "stale" | "unknown" | "inconclusive";
/** `path`: where the archived copy is read from (artifacts API); `source`: the file the producer named, relative to the task directory. */
export type EvidenceAttachmentView = { source: string; path?: string; archived: boolean };
export type EvidenceView = {
  /** Unique within the run: the report file, its archived version and the item. */
  key: string;
  id?: string;
  label: string;
  verdict: string;
  source: EvidenceSource;
  file: string;
  version: number;
  receivedAt: string;
  round?: number;
  producer?: { role?: string; agentId?: string };
  observedAt?: string;
  method?: EvidenceMethod;
  basis: EvidenceBasis;
  expected?: string;
  actual?: string;
  command?: string;
  note?: string;
  criterionIds: string[];
  checkIds: string[];
  taskIds: string[];
  snapshotId?: string;
  freshness: EvidenceFreshness;
  supersedes: string[];
  supersededBy?: string;
  confirms?: string;
  blocker?: { reason: string; action?: string };
  attachments: EvidenceAttachmentView[];
};
export type AcceptanceCheckView = { id: string; description: string; method?: EvidenceMethod; status: AcceptanceStatus; reasons: string[]; evidence: EvidenceView[]; history: EvidenceView[] };
export type AcceptanceCriterionView = {
  id: string; text: string; status: AcceptanceStatus;
  source?: { kind: string; reference?: string; excerpt?: string };
  expected?: string;
  tasks: { id: string; title: string }[];
  checks: AcceptanceCheckView[];
  /** Evidence naming the criterion without saying which of its checks it covers: shown, never counted. */
  unassigned: EvidenceView[];
  reasons: string[];
  /** Rebuilt from an older plan that had no identifiers: never verified. */
  reconstructed?: boolean;
};
export type AcceptanceDiagnostic = { level: "error" | "warning"; message: string; file?: string };
export type AcceptanceReportVersion = { file: string; version: number; receivedAt: string; hash: string; source?: EvidenceSource; round?: number; items: number; current: boolean };
/** Everything the "Preuves" tab shows about one run, computed once on the server and reused by the merge request summary. */
export type AcceptanceView = {
  available: boolean;
  registryRevision?: number;
  updatedAt: string;
  counts: AcceptanceCounts;
  /** "5 critères vérifiés sur 8 · 1 échec · …", the same sentence in the tab and in the merge request. */
  sentence: string;
  currentSnapshot?: { id: string; capturedAt: string };
  criteria: AcceptanceCriterionView[];
  /** Gates that verify the change as a whole, lint or typecheck, never counted against a criterion. */
  general: EvidenceView[];
  /** General checks only an earlier version of a report still carries, a previous round's lint for instance. */
  generalHistory: EvidenceView[];
  diagnostics: AcceptanceDiagnostic[];
  reports: AcceptanceReportVersion[];
};
/**
 * How a run is doing, orthogonal to its lifecycle status. `waiting`: someone or
 * something identified is expected to move it; `suspected_stall`: nothing
 * observed for a long while, which is a doubt and never a verdict; `stalled`:
 * an incident is open; `interrupted`: the session went away before the
 * workflow reached a result. See server/run-health.ts.
 */
export type RunHealth = "healthy" | "waiting" | "suspected_stall" | "stalled" | "interrupted";
export type WaitReason = "user_question" | "permission" | "terminal_interaction" | "agent" | "tool" | "dependency" | "unknown";
/** `on`: who or what is expected (an agent, a command, the user); `liftedBy`: the event that ends the wait. */
export type RunWait = { reason: WaitReason; since: string; on?: string; liftedBy?: string };
export type IncidentKind = "no_next_action" | "lost_session" | "missing_result" | "unresolvable_dependency";
export type IncidentStatus = "open" | "resolved" | "dismissed";
/** Actions the interface may offer on an incident. Only the last three have an effect on the server. */
export type IncidentAction = "answer" | "open_terminal" | "view_diagnostic" | "request_continuation" | "stop" | "dismiss";
/**
 * One decision taken on an incident, written before its effect: after a crash
 * between the two, `pending` becomes `unknown`, and nothing is ever replayed,
 * since a write into a terminal is not a transaction.
 */
export type IncidentDecision = { requestId: string; action: IncidentAction; at: string; outcome: "pending" | "done" | "refused" | "unknown"; detail?: string };
export type IncidentObservation = { kind: string; at?: string; detail: string };
export type RunIncident = {
  id: string;
  runId: string;
  kind: IncidentKind;
  status: IncidentStatus;
  /** Moves on every change, so an action decided on an older state is refused. */
  revision: number;
  detectedAt: string;
  updatedAt: string;
  /** Same cause, same fingerprint: one incident and one notification per stable cause. */
  fingerprint: string;
  /** The factual title and the cause in one sentence, as the interface shows them. */
  title: string;
  reason: string;
  observations: IncidentObservation[];
  expectedNextAction?: string;
  suggestedActions: IncidentAction[];
  /** Set once the user asked the live session to go on; resolved only when it visibly does. */
  continuation?: { requestedAt: string; requestId: string };
  decisions: IncidentDecision[];
  resolution?: { at: string; outcome: string; detail?: string };
};
/** What the run view and the list read: the classification, and the sentence that explains it. */
export type RunHealthView = {
  health: RunHealth;
  wait?: RunWait;
  /** Set for everything but a plain `healthy`: a short factual title and one sentence. */
  title?: string;
  detail?: string;
  /** The contract the workflow declares about itself, or why it is not read. */
  workflow?: { state: WorkflowStateName; revision: number; nextAction?: string; receivedAt: string } | { missing: true };
  evaluatedAt: string;
};
export type WorkflowStateName = "working" | "waiting" | "completed" | "blocked";
/** `workflow-state.json` as read: what the pilot says it is doing and what comes next. See server/workflow-state.ts. */
export type WorkflowState = {
  schemaVersion: 1;
  revision: number;
  state: WorkflowStateName;
  step?: string;
  nextAction?: { kind: string; taskIds: string[]; agents: string[]; expectedArtifact?: string; description?: string };
  result?: { delivery: "merge_request" | "draft_merge_request" | "none"; mergeRequestUrl?: string; blockers: string[] };
  receivedAt: string;
};
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
  /** Acceptance coverage in figures; the full view is served by /api/runs/<id>/acceptance. */
  acceptance?: AcceptanceDigest;
  /** Absent on archives written before run health existed, and on runs never evaluated. */
  health?: RunHealthView;
  /** Every incident of the run, open or not, oldest first. */
  incidents?: RunIncident[];
  /** The last valid `workflow-state.json`, when the workflow writes one. */
  workflow?: WorkflowState;
  /** Set on an archive the console reads back after a restart: the run has no session and takes no instruction. */
  archived?: boolean;
  /** The format of run.json, absent before version 2. */
  schemaVersion?: number;
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
  /** Acceptance figures only, and only once the run wrote a criteria registry. */
  acceptance?: AcceptanceCounts;
  /** Whether this run still holds its slot and its checkout, which is what the queue waits on. */
  holdsRepository: boolean;
  health?: RunHealth;
  /** The open incident, as little of it as a row and a notification need. */
  incident?: { id: string; kind: IncidentKind; title: string; revision: number };
  /** A run read back from its archive after a restart: no session, no slot, no checkout. */
  archived?: boolean;
};

/** A launch the console accepted but has not started yet, kept in the order it was asked. */
export type QueuedRun = { id: string; cwd: string; issueUrl: string; instruction: string; queuedAt: string };
/**
 * Why a queued launch has not started, computed when the queue is read rather
 * than stored: a run ending changes the answer for every entry behind it.
 */
export type QueuedRunView = QueuedRun & { reason: "slot" | "repository"; blockedBy?: string };

/** Everything every open page is told about, whichever run it has opened. */
/** `archived`: runs of an earlier process left with an open incident, readable but not live. */
export type HarnessSnapshot = { runs: RunSummary[]; queued: QueuedRunView[]; maxConcurrentRuns: number; archived: RunSummary[] };

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
  /** `scenario`: the regular workflow, or the pilot handing back with nothing next. */
  | { type: "demo.start"; scenario?: "workflow" | "incident" }
  | { type: "feedback.submit"; runId: string; body: string }
  | { type: "question.answer"; runId: string; answers: Record<string, string> }
  | { type: "selfImprovement.approve"; worktreeName: string }
  | { type: "selfImprovement.reject"; worktreeName: string }
  /**
   * An action on an incident, taken on the state the page was shown: the server
   * refuses it when `expectedRevision` is no longer the incident's, and a
   * `requestId` seen before is answered without acting twice.
   */
  | { type: "incident.action"; runId: string; incidentId: string; expectedRevision: number; requestId: string; action: IncidentAction; reason?: string };

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
  | { type: "error"; message: string; runId?: string }
  /** What became of an incident action, answered to the page that asked. */
  | { type: "incident.result"; runId: string; incidentId: string; requestId: string; outcome: "done" | "refused" | "duplicate"; message: string };
