export type Status = "idle" | "starting" | "running" | "attention" | "completed" | "stopped" | "failed";
/** `abandoned`: the agent was stopped, or the run ended, before it ever reported an outcome, so it has none to read. */
export type Agent = { id: string; name: string; nickname?: string; avatar?: string; role?: string; status: "running" | "completed" | "failed" | "abandoned"; startedAt: string; endedAt?: string };
export type Activity = { id: string; at: string; kind: string; title: string; detail?: string };
export type QuestionOption = { label: string; description?: string };
export type PendingQuestion = { id: string; questions: { question: string; header: string; options: QuestionOption[]; multiSelect: boolean }[]; askedAt?: string };
/** Mirrors SessionPrompt in server/types.ts: the folder trust dialog of the agent, waiting for the user. */
export type SessionPrompt = { id: string; kind: "folder_trust"; directory: string; since: string };
/** `mergesCleanly` is false when the branch does not merge even after the automatic replay: a conflict only a human can settle. */
export type PendingSelfImprovementReview = { worktreeName: string; branch?: string; commits: number; mergesCleanly?: boolean; status: "analyzing" | "ready" | "finished" };
export type ConversationMessage = { id: string; at: string; author: "claude" | "user"; text: string; pending?: boolean };
/** One task of `planner-output.json`, placed on the "Tracking" board by what the run has done with it. */
export type PlanTaskStatus = "todo" | "in_progress" | "done";
/** `assignee`: the agent that last took the task, by id and by the name and role the interface calls it. */
export type PlanTask = { id: string; title: string; complexity?: string; status: PlanTaskStatus; assignee?: { agentId: string; nickname?: string; avatar?: string; role?: string }; criterionIds?: string[]; dependencies?: string[]; summary?: string; description?: string; filePaths?: string[] };
/** A developer handed plan tasks, paired with the agent it became once that agent starts. */
export type PlanDelegation = { agentType: string; taskIds: string[]; agentId?: string };
/** Mirrors RunWorktree in server/types.ts. */
export type RunWorktree = { path: string; state: "active" | "kept" | "removed"; detail?: string; dependencies?: "clone" | "symlink" };
/** What became of a worktree removal this page asked for. */
export type WorktreeResult = { runId: string; outcome: "removed" | "confirm" | "refused"; message: string; risks?: string[] };
export type RunState = {
  id: string | null; status: Status; phase: number; cwd: string; issueUrl: string; instruction: string;
  /** The checkout the ticket was launched on; `cwd` is the worktree the session runs in. Absent on older archives. */
  repository?: string;
  /** The branch a stacked run was started on. */
  baseBranch?: string;
  /** The base the watcher named for this ticket. */
  ticketBaseBranch?: string;
  worktree?: RunWorktree;
  startedAt: string | null; endedAt: string | null; agents: Agent[]; activities: Activity[]; messages: ConversationMessage[]; artifacts: string[]; branch?: string; mergeRequestUrl?: string; pendingQuestion?: PendingQuestion; error?: string;
  /** The engine process behind this run is still up, taking input, whether or not the workflow itself has finished. Absent on states built before this field existed. */
  sessionActive?: boolean;
  /** The agent stopped at a prompt of its own before the session started, and the user has not answered yet. */
  sessionPrompt?: SessionPrompt;
  /** What Claude is doing at this instant, from the tool it last called. Absent as soon as it hands control back. */
  action?: string;
  /** When a file of the "Evidence" tab was last written, a rewrite by a later review round included. */
  evidenceUpdatedAt?: string;
  /** Read from GitLab once the run has started; absent until then, or when GitLab could not be reached. */
  ticketTitle?: string;
  /** The tasks of the plan, absent until `planner-output.json` has been read. */
  planTasks?: PlanTask[];
  /** Every developer handed plan tasks, in launch order, kept so the board survives the archive. */
  planDelegations?: PlanDelegation[];
  /** Non blocking remarks on how the reviewers worked, computed by the server (reviewPlanNotes). */
  reviewNotes?: string[];
  /** Acceptance coverage in figures; the full view comes from /api/runs/<id>/acceptance. */
  acceptance?: AcceptanceDigest;
  /** Who can move the run forward, as the health monitor sees it. See server/run-health.ts. */
  health?: RunHealthView;
  incidents?: RunIncident[];
  /** Tokens consumed so far, cache included, refreshed while the run goes. Mirrors RunUsage in server/types.ts. */
  usage?: RunUsage;
  /** A run read back from its archive after a restart: no session, nothing to act on but its incident. */
  archived?: boolean;
};
export type RunUsage = { total: number; output: number; pilot: number; pilotCalls: number; agents: number };
/**
 * A run as the side list sees it. Mirrors RunSummary in server/types.ts: the
 * list is pushed to every open page on every event of every run, so it carries
 * what a row, a dot or a notification needs and nothing that grows with the
 * length of a run.
 */
export type RunSummary = {
  id: string; status: Status; phase: number; cwd: string; repository?: string; worktree?: RunWorktree; issueUrl: string; ticketTitle?: string;
  startedAt: string | null; endedAt: string | null;
  branch?: string; mergeRequestUrl?: string; error?: string; action?: string;
  sessionActive: boolean;
  pendingQuestionId?: string;
  pendingQuestionCount: number;
  sessionPromptId?: string;
  runningAgents: number;
  lastMessageId?: string;
  lastMessageAuthor?: ConversationMessage["author"];
  evidenceUpdatedAt?: string;
  acceptance?: AcceptanceCounts;
  /** Whether this run still holds its ticket, which is what a launch on the same ticket waits on. */
  holdsRepository: boolean;
  /** Whether this run takes one of the concurrent slots: only while its workflow works. */
  takesSlot: boolean;
  health?: RunHealth;
  /** Tokens consumed so far, cache included. */
  tokens?: number;
  incident?: { id: string; kind: IncidentKind; title: string; revision: number };
  archived?: boolean;
};
/** Mirrors the queue and schedule types of server/types.ts. */
export type ScheduleConfidence = "high" | "medium" | "low";
export type QueueForce = { mode: "base" } | { mode: "stacked"; baseBranch: string; onto: string };
export type QueuedRun = { id: string; cwd: string; repository?: string; issueUrl: string; instruction: string; queuedAt: string; batchId?: string; analysing?: boolean; forced?: QueueForce; demo?: boolean };
export type QueueReason = "slot" | "ticket" | "analysis" | "conflict" | "merge" | "merge_unknown" | "dependency" | "order";
export type QueueCause = "overlap" | "depends_on" | "analysis_failed" | "low_confidence";
export type QueueBlocker = { issueUrl: string; runId?: string; queuedId?: string; mergeRequestUrl?: string; branch?: string };
export type QueuedRunView = QueuedRun & {
  reason: QueueReason; blockedBy?: string; blocking?: QueueBlocker; cause?: QueueCause; detail?: string;
  summary?: string; confidence?: ScheduleConfidence; analysisFailure?: string;
};
/** Mirrors TicketProposal in server/types.ts: a ticket a watcher found, waiting for the user's decision. */
export type TicketProposal = { issueUrl: string; title?: string; source?: string; baseBranch?: string; repositories?: string[]; refusal?: string };
/** Mirrors UnresolvedTicket in server/types.ts: a ticket of a batch no checkout was found for. */
export type UnresolvedTicket = { issueUrl: string; project?: string };
/** `archived`: runs of an earlier process left with an open incident, readable but not live. `proposals`: tickets found by a watcher, not started. */
export type HarnessSnapshot = { runs: RunSummary[]; queued: QueuedRunView[]; maxConcurrentRuns: number; archived?: RunSummary[]; proposals?: TicketProposal[] };
/** `queuedId`: the waiting launch this notice is about, which stops being true as soon as that launch leaves the queue. */
export type Notice = { level: "info" | "attention"; title: string; detail?: string; at: string; queuedId?: string };
export type ServerMessage =
  | { type: "harness"; snapshot: HarnessSnapshot }
  | { type: "run"; state: RunState }
  /** The run a launch of this page created, named by the `requestId` the page gave that launch. */
  | { type: "run.started"; runId: string; requestId?: string }
  | { type: "terminal.output"; runId: string; data: string }
  | { type: "notice"; level: "info" | "attention"; title: string; detail?: string; at: string; queuedId?: string; requestId?: string }
  | { type: "error"; message: string; runId?: string; requestId?: string }
  | { type: "batch.result"; batchId: string; accepted: number; duplicates: string[] }
  | { type: "batch.unresolved"; tickets: UnresolvedTicket[] }
  | ({ type: "worktree.result" } & WorktreeResult)
  | { type: "recipe.result"; repository: string; forgotten: boolean }
  | { type: "findings.result"; repository: string; forgotten: boolean }
  | { type: "incident.result"; runId: string; incidentId: string; requestId: string; outcome: "done" | "refused" | "duplicate"; message: string };

export type RepositoryOption = { project: string; path: string; resolvedPath: string; exists: boolean };
export type RepositoryResponse = {
  repositories: RepositoryOption[];
  detected: (RepositoryOption & { source: "git" }) | null;
};
/** The runtime recipe the console keeps for a repository, `null` when it has none. */
/** A kind of defect the reviews of a repository found on several tickets, with its latest examples. */
export type RecurringFindingView = { category: string; label: string; tickets: number; findings: number; examples: { severity: string; file?: string; summary: string }[] };
/** The review findings the console keeps for a repository: how many, over how many tickets, and the kinds its next run is told about. */
export type FindingsResponse = { repository: string; findings?: { kept: number; tickets: number; recurring: RecurringFindingView[] }; error?: string };
export type RecipeResponse = { repository: string; recipe: { content: string; updatedAt: string } | null; error?: string };
export type ArtifactResponse = { path: string; content: string; error?: string; encoding?: "utf8" | "base64"; contentType?: string };
export type EvidenceVerdict = "pass" | "fail" | "not_run" | "measured" | "confirmed" | "unverified";
export type EvidenceItem = { id?: string; label: string; verdict: EvidenceVerdict; expected?: string; actual?: string; command?: string; screenshot?: string; attachments?: unknown[]; note?: string; kind?: string };
/** A report as `normalizeEvidenceReport` hands it to the page, never as the agent wrote it. */
export type EvidenceReport = { source?: EvidenceSource; status?: string; items: EvidenceItem[] };
export type PendingImprovementsResponse = { items: PendingSelfImprovementReview[]; error?: string };

/** Mirrors the acceptance types of server/types.ts, computed by server/acceptance.ts. */
export type AcceptanceStatus = "verified" | "unverified" | "blocked" | "failed";
export type AcceptanceCounts = { total: number; verified: number; failed: number; blocked: number; unverified: number; stale: number };
export type AcceptanceQaView = { status: string; file: string; round?: number; mandate?: string[]; consistent: boolean; unobserved: string[]; warning?: string };
export type AcceptanceQaDigest = { status: string; consistent: boolean; unobserved: number };
export type AcceptanceDigest = { available: boolean; revision: number; updatedAt: string; counts: AcceptanceCounts; diagnostics: number; qa?: AcceptanceQaDigest };
export type EvidenceSource = "qa" | "design" | "developer";
export type EvidenceMethod = "test" | "browser" | "static_analysis" | "manual";
export type EvidenceBasis = "observed" | "reported" | "confirmation";
export type EvidenceFreshness = "current" | "stale" | "unknown" | "inconclusive";
export type EvidenceAttachmentView = { source: string; path?: string; archived: boolean };
export type EvidenceView = {
  key: string; id?: string; label: string; verdict: string; kind?: "attempt"; source: EvidenceSource; file: string; version: number; receivedAt: string;
  round?: number; producer?: { role?: string; agentId?: string }; observedAt?: string; method?: EvidenceMethod; basis: EvidenceBasis;
  expected?: string; actual?: string; command?: string; note?: string;
  criterionIds: string[]; checkIds: string[]; taskIds: string[];
  snapshotId?: string; freshness: EvidenceFreshness; supersedes: string[]; supersededBy?: string; confirms?: string;
  blocker?: { reason: string; action?: string };
  attachments: EvidenceAttachmentView[];
};
export type AcceptanceCheckView = { id: string; description: string; method?: EvidenceMethod; status: AcceptanceStatus; reasons: string[]; evidence: EvidenceView[]; history: EvidenceView[] };
export type AcceptanceCriterionView = {
  id: string; text: string; status: AcceptanceStatus; source?: { kind: string; reference?: string; excerpt?: string }; expected?: string;
  tasks: { id: string; title: string }[]; checks: AcceptanceCheckView[]; unassigned: EvidenceView[]; attempts: EvidenceView[]; reasons: string[]; reconstructed?: boolean;
};
export type AcceptanceDiagnostic = { level: "error" | "warning"; message: string; file?: string };
export type AcceptanceReportVersion = { file: string; version: number; receivedAt: string; hash: string; source?: EvidenceSource; round?: number; items: number; current: boolean; status?: string; mandate?: string[] };
export type AcceptanceView = {
  available: boolean; registryRevision?: number; updatedAt: string; counts: AcceptanceCounts; sentence: string; currentSnapshot?: { id: string; capturedAt: string };
  criteria: AcceptanceCriterionView[]; general: EvidenceView[]; generalHistory: EvidenceView[]; diagnostics: AcceptanceDiagnostic[]; reports: AcceptanceReportVersion[]; qa?: AcceptanceQaView;
};

/** Mirrors the run health types of server/types.ts. */
export type RunHealth = "healthy" | "waiting" | "suspected_stall" | "stalled" | "interrupted";
export type WaitReason = "user_question" | "permission" | "terminal_interaction" | "agent" | "tool" | "dependency" | "unknown";
export type RunWait = { reason: WaitReason; since: string; on?: string; liftedBy?: string };
export type IncidentKind = "no_next_action" | "lost_session" | "missing_result" | "unresolvable_dependency";
export type IncidentAction = "answer" | "open_terminal" | "view_diagnostic" | "request_continuation" | "stop" | "dismiss";
export type IncidentDecision = { requestId: string; action: IncidentAction; at: string; outcome: "pending" | "done" | "refused" | "unknown"; detail?: string };
export type RunIncident = {
  id: string; runId: string; kind: IncidentKind; status: "open" | "resolved" | "dismissed"; revision: number; detectedAt: string; updatedAt: string; fingerprint: string;
  title: string; reason: string; observations: { kind: string; at?: string; detail: string }[]; expectedNextAction?: string; suggestedActions: IncidentAction[];
  continuation?: { requestedAt: string; requestId: string }; decisions: IncidentDecision[]; resolution?: { at: string; outcome: string; detail?: string };
};
export type RunHealthView = {
  health: RunHealth; wait?: RunWait; title?: string; detail?: string;
  workflow?: { state: string; revision: number; nextAction?: string; receivedAt: string } | { missing: true };
  evaluatedAt: string;
};
/** What became of an incident action this page sent, shown next to the incident. */
export type IncidentResult = { incidentId: string; requestId: string; outcome: "done" | "refused" | "duplicate"; message: string };

/** Mirrors the metrics types of server/types.ts, computed by server/run-metrics.ts and served by /api/metrics. */
export type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
export type SessionMetrics = TokenUsage & { calls: number; model?: string; firstContext: number; peakContext: number };
export type AgentMetrics = SessionMetrics & { agentId: string; name: string; activeMs?: number };
export type RunMetrics = {
  schemaVersion: 1;
  runId: string;
  computedAt: string;
  final: boolean;
  harness?: { version?: string; commit?: string };
  ticket: { issueUrl: string; title?: string; repository: string };
  outcome: { status: Status; phase: number; delivery: "merge_request" | "draft_merge_request" | "none"; mergeRequestUrl?: string; questions: number; incidents: string[]; acceptance?: AcceptanceCounts; qaStatus?: string; worktree?: string };
  time: { startedAt: string | null; endedAt: string | null; elapsedMs: number; reopened?: { count: number; ms: number }; userWaitMs: number; waits: { reason: "question" | "session_prompt" | "terminal"; count: number; ms: number }[]; activeMs: number; incidentMs: number; phases: { phase: number; enteredAt: string; ms: number }[]; gate?: { ms: number; steps: { step: string; runs: number; ms: number }[] } };
  complexity: { tasks: number; sizes: { S: number; M: number; L: number }; criteria: number; reviewTier?: 0 | 1 | 2; diff?: { files: number; insertions: number; deletions: number } };
  rework: { launches: Record<string, number>; reworkDevelopers: number; lostAgents: number };
  tokens?: { total: TokenUsage; pilot: SessionMetrics; agents: AgentMetrics[]; pilotShare: number };
};
export type MetricsResponse = { runs: RunMetrics[]; error?: string };
