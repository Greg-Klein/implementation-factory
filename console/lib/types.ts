export type Status = "idle" | "starting" | "running" | "attention" | "completed" | "stopped" | "failed";
/** `abandoned`: the agent was stopped, or the run ended, before it ever reported an outcome, so it has none to read. */
export type Agent = { id: string; name: string; nickname?: string; avatar?: string; role?: string; status: "running" | "completed" | "failed" | "abandoned"; startedAt: string; endedAt?: string };
export type Activity = { id: string; at: string; kind: string; title: string; detail?: string };
export type QuestionOption = { label: string; description?: string };
export type PendingQuestion = { id: string; questions: { question: string; header: string; options: QuestionOption[]; multiSelect: boolean }[] };
/** `mergesCleanly` is false when the branch does not merge even after the automatic replay: a conflict only a human can settle. */
export type PendingSelfImprovementReview = { worktreeName: string; branch?: string; commits: number; mergesCleanly?: boolean; status: "analyzing" | "ready" | "orphaned" };
export type ConversationMessage = { id: string; at: string; author: "claude" | "user"; text: string; pending?: boolean };
/** One task of `planner-output.json`, placed on the "Suivi" board by what the run has done with it. */
export type PlanTaskStatus = "todo" | "in_progress" | "done";
/** `assignee`: the agent that last took the task, by id and by the name and role the interface calls it. */
export type PlanTask = { id: string; title: string; complexity?: string; status: PlanTaskStatus; assignee?: { agentId: string; nickname?: string; avatar?: string; role?: string }; criterionIds?: string[]; dependencies?: string[] };
/** A developer handed plan tasks, paired with the agent it became once that agent starts. */
export type PlanDelegation = { agentType: string; taskIds: string[]; agentId?: string };
export type RunState = {
  id: string | null; status: Status; phase: number; cwd: string; issueUrl: string; instruction: string;
  startedAt: string | null; endedAt: string | null; agents: Agent[]; activities: Activity[]; messages: ConversationMessage[]; artifacts: string[]; branch?: string; mergeRequestUrl?: string; pendingQuestion?: PendingQuestion; error?: string;
  /** The engine process behind this run is still up, taking input, whether or not the workflow itself has finished. Absent on states built before this field existed. */
  sessionActive?: boolean;
  /** What Claude is doing at this instant, from the tool it last called. Absent as soon as it hands control back. */
  action?: string;
  /** When a file of the "Preuves" tab was last written, a rewrite by a later review round included. */
  evidenceUpdatedAt?: string;
  /** Read from GitLab once the run has started; absent until then, or when GitLab could not be reached. */
  ticketTitle?: string;
  /** The tasks of the plan, absent until `planner-output.json` has been read. */
  planTasks?: PlanTask[];
  /** Every developer handed plan tasks, in launch order, kept so the board survives the archive. */
  planDelegations?: PlanDelegation[];
  /** Acceptance coverage in figures; the full view comes from /api/runs/<id>/acceptance. */
  acceptance?: AcceptanceDigest;
};
/**
 * A run as the side list sees it. Mirrors RunSummary in server/types.ts: the
 * list is pushed to every open page on every event of every run, so it carries
 * what a row, a dot or a notification needs and nothing that grows with the
 * length of a run.
 */
export type RunSummary = {
  id: string; status: Status; phase: number; cwd: string; issueUrl: string; ticketTitle?: string;
  startedAt: string | null; endedAt: string | null;
  branch?: string; mergeRequestUrl?: string; error?: string; action?: string;
  sessionActive: boolean;
  pendingQuestionId?: string;
  pendingQuestionCount: number;
  runningAgents: number;
  lastMessageId?: string;
  lastMessageAuthor?: ConversationMessage["author"];
  evidenceUpdatedAt?: string;
  acceptance?: AcceptanceCounts;
  /** Whether this run still holds its slot and its checkout, which is what the queue waits on. */
  holdsRepository: boolean;
};
export type QueuedRun = { id: string; cwd: string; issueUrl: string; instruction: string; queuedAt: string };
export type QueuedRunView = QueuedRun & { reason: "slot" | "repository"; blockedBy?: string };
export type HarnessSnapshot = { runs: RunSummary[]; queued: QueuedRunView[]; maxConcurrentRuns: number };
/** `queuedId`: the waiting launch this notice is about, which stops being true as soon as that launch leaves the queue. */
export type Notice = { level: "info" | "attention"; title: string; detail?: string; at: string; queuedId?: string };
export type ServerMessage =
  | { type: "harness"; snapshot: HarnessSnapshot }
  | { type: "run"; state: RunState }
  | { type: "terminal.output"; runId: string; data: string }
  | { type: "notice"; level: "info" | "attention"; title: string; detail?: string; at: string; queuedId?: string }
  | { type: "error"; message: string; runId?: string };

export type RepositoryOption = { project: string; path: string; resolvedPath: string; exists: boolean };
export type RepositoryResponse = {
  repositories: RepositoryOption[];
  detected: (RepositoryOption & { source: "git" }) | null;
};
export type ArtifactResponse = { path: string; content: string; error?: string; encoding?: "utf8" | "base64"; contentType?: string };
export type EvidenceVerdict = "pass" | "fail" | "not_run" | "measured" | "confirmed" | "unverified";
export type EvidenceItem = { id?: string; label: string; verdict: EvidenceVerdict; expected?: string; actual?: string; command?: string; screenshot?: string; note?: string };
export type EvidenceReport = { source: "qa" | "design" | "developer"; status?: string; items: EvidenceItem[] };
export type PendingImprovementsResponse = { items: PendingSelfImprovementReview[]; error?: string };

/** Mirrors the acceptance types of server/types.ts, computed by server/acceptance.ts. */
export type AcceptanceStatus = "verified" | "unverified" | "blocked" | "failed";
export type AcceptanceCounts = { total: number; verified: number; failed: number; blocked: number; unverified: number; stale: number };
export type AcceptanceDigest = { available: boolean; revision: number; updatedAt: string; counts: AcceptanceCounts; diagnostics: number };
export type EvidenceSource = "qa" | "design" | "developer";
export type EvidenceMethod = "test" | "browser" | "static_analysis" | "manual";
export type EvidenceBasis = "observed" | "reported" | "confirmation";
export type EvidenceFreshness = "current" | "stale" | "unknown" | "inconclusive";
export type EvidenceAttachmentView = { source: string; path?: string; archived: boolean };
export type EvidenceView = {
  key: string; id?: string; label: string; verdict: string; source: EvidenceSource; file: string; version: number; receivedAt: string;
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
  tasks: { id: string; title: string }[]; checks: AcceptanceCheckView[]; unassigned: EvidenceView[]; reasons: string[]; reconstructed?: boolean;
};
export type AcceptanceDiagnostic = { level: "error" | "warning"; message: string; file?: string };
export type AcceptanceReportVersion = { file: string; version: number; receivedAt: string; hash: string; source?: EvidenceSource; round?: number; items: number; current: boolean };
export type AcceptanceView = {
  available: boolean; registryRevision?: number; updatedAt: string; counts: AcceptanceCounts; sentence: string; currentSnapshot?: { id: string; capturedAt: string };
  criteria: AcceptanceCriterionView[]; general: EvidenceView[]; generalHistory: EvidenceView[]; diagnostics: AcceptanceDiagnostic[]; reports: AcceptanceReportVersion[];
};
