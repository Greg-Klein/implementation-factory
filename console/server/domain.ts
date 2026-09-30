import path from "node:path";
import type { AgentState, PlanDelegation, PlanTask, QueuedRun, QueuedRunView, RunState, RunStatus, RunSummary } from "./types.js";

export type QuestionOption = { label: string; description?: string };
export type Question = { question: string; header: string; options: QuestionOption[]; multiSelect: boolean };

/**
 * One line of readable text out of anything an agent reports, short enough for
 * the activity feed. A blank field carries no more information than a missing
 * one, so it comes back undefined and callers can fall back on it with `??`.
 */
export function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/\s+/g, " ").trim().slice(0, 180) || undefined;
}

export function normalizeQuestion(value: unknown): Question | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.question !== "string" || !input.question.trim()) return undefined;
  const options = Array.isArray(input.options) ? input.options.flatMap((option) => {
    if (!option || typeof option !== "object") return [];
    const candidate = option as Record<string, unknown>;
    if (typeof candidate.label !== "string" || !candidate.label.trim()) return [];
    return [{ label: candidate.label.trim(), description: typeof candidate.description === "string" ? candidate.description.trim() : undefined }];
  }) : [];
  return {
    question: input.question.trim(),
    header: typeof input.header === "string" && input.header.trim() ? input.header.trim() : "Question",
    options,
    multiSelect: input.multiSelect === true,
  };
}

export function resolveArtifactPath(rootDirectory: string, artifactPath: string) {
  const root = path.resolve(rootDirectory);
  const target = path.resolve(root, artifactPath);
  return target.startsWith(`${root}${path.sep}`) ? target : undefined;
}

export function normalizeAnswers(questions: Question[], answers: Record<string, string>) {
  const normalized = Object.fromEntries(questions.map(({ question }) => [question, answers[question]?.trim() ?? ""]));
  return Object.values(normalized).every(Boolean) ? normalized : undefined;
}

const DOCUMENT_EXTENSIONS = new Set([".md", ".json", ".txt"]);

/**
 * An artifact of the run is a document the workflow wrote to be read. The
 * screenshots and the downloaded design assets are the agents' working
 * material: they live in the repository, where the agents write them and read
 * them back, and listing them alongside the reports only buries the reports.
 */
export function isRunDocument(relativePath: string) {
  return DOCUMENT_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

/**
 * The three files the "Preuves" tab reads, and only those: the `-roundN`
 * copies the review orchestrator keeps are history the tab never shows, so a
 * badge raised on one would point at nothing new. Mirrors SOURCES in
 * components/evidence-panel.tsx.
 */
const PANEL_EVIDENCE = /^(?:qa|design|dev)-evidence\.json$/;

export function isPanelEvidence(relativePath: string) {
  return PANEL_EVIDENCE.test(path.basename(relativePath));
}

/**
 * Wider than PANEL_EVIDENCE on purpose: a screenshot is archived the moment any
 * evidence file names it, and the developers write one per task while the
 * reviewers keep one per round. Waiting for the merged file would make the
 * archive depend on a merge that has already been skipped once.
 */
const EVIDENCE_REPORT = /^(?:qa|design|dev)-evidence(?:-[A-Za-z0-9]+)?\.json$/;

export function isEvidenceReport(relativePath: string) {
  return EVIDENCE_REPORT.test(path.basename(relativePath));
}

export function positiveDuration(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * A user-initiated stop is neither a crash nor a workflow that ran to its end:
 * calling it "completed" told the user the run had gone all the way (a merge
 * request, a published review) when they themselves had just cut it off,
 * sometimes before a single agent had started.
 */
export function terminalExitStatus(exitCode: number, intentionallyStopped: boolean, workflowComplete = false) {
  if (intentionallyStopped) return "stopped" as const;
  // A clean exit of the process proves nothing about the workflow: only a
  // result the workflow reached makes a session ending on its own a success.
  return workflowComplete ? "completed" as const : "failed" as const;
}

/**
 * What the feed says about a session that went away. A session the console
 * itself killed left the same line as a crash, which on a finished run read as
 * an incident where there was only a place given back.
 */
export function exitReport(stoppedBy: "user" | "queue" | null, exitCode: number, workflowComplete = true) {
  if (stoppedBy === "queue") return "Place libérée pour la file d'attente";
  if (stoppedBy === "user") return "Session arrêtée par l'utilisateur";
  if (!workflowComplete) return exitCode === 0 ? "Session terminée avant la fin du workflow" : "Session interrompue";
  return exitCode === 0 ? "Session terminée" : "Session interrompue";
}

/**
 * The autonomous loop only has something to learn from a run that left a trace:
 * a delegated agent, a produced document, or an unexpected exit. A session
 * stopped before any of that happened would otherwise spend a full improvement
 * cycle on empty signals.
 */
export function hasAuditableEvidence(snapshot: Pick<RunState, "status" | "agents" | "artifacts">) {
  return snapshot.status === "failed" || snapshot.agents.length > 0 || snapshot.artifacts.length > 0;
}

const IMPROVEMENT_WORKTREE_PREFIX = "self-improvement-";

export function improvementWorktreeName(runId: string) {
  return `${IMPROVEMENT_WORKTREE_PREFIX}${runId.slice(-8)}`;
}

/** Whether a worktree path is one the improvement loop created, whichever run named it. */
export function isImprovementWorktree(worktreePath: string) {
  return path.basename(worktreePath).startsWith(IMPROVEMENT_WORKTREE_PREFIX);
}

/**
 * The improvement worktree already in flight, out of every worktree registered
 * against the harness. One undecided branch at a time is the whole point: the
 * loop opened eleven in a day on 7 September, four of them conflicting with each
 * other, and each rotted as the harness branch moved on. A branch nobody has
 * ruled on is also the branch the next iteration would be diagnosed against, so
 * the loop waits for a verdict instead of stacking.
 */
export function improvementWorktreeInFlight(worktreePaths: string[]) {
  return worktreePaths.find(isImprovementWorktree);
}

/** The report /implementation-harness:improve writes last, next to the feedback, named after its branch. */
export function improvementReportName(worktreeName: string) {
  return `improvement-report-${worktreeName.slice(IMPROVEMENT_WORKTREE_PREFIX.length)}.md`;
}

/**
 * What the console says about an improvement worktree holding no commit ahead of
 * the harness. Git cannot tell an agent still reading from one that is done:
 * both leave a clean branch that is an ancestor of the harness, and the agent
 * writes its diagnosis next to the feedback, never in the worktree. Reading that
 * pair as "already integrated" showed every iteration as spent from its first
 * second, and hid the ones that ended without a commit. The report is what the
 * agent writes last, whatever the outcome, so it alone says the agent is done.
 */
export function commitlessImprovementStatus(worktree: { reported: boolean }) {
  return worktree.reported ? ("finished" as const) : ("analyzing" as const);
}

// The console is itself a Next server, and Next writes its bundler choice and
// NODE_ENV into the environment. Handing those down to an agent that runs a
// build makes it abort on conflicting bundler flags, whatever the code checked.
export function withoutBundlerVariables<T extends Record<string, string | undefined>>(environment: T) {
  const cleaned = { ...environment };
  for (const key of Object.keys(cleaned)) {
    if (key.startsWith("__NEXT_") || key === "TURBOPACK" || key === "NODE_ENV" || key === "NEXT_DEPLOYMENT_ID") delete cleaned[key];
  }
  return cleaned;
}

export function gitLabProjectPath(issueUrl: string) {
  try {
    const url = new URL(issueUrl);
    return url.pathname.match(/^\/(.+?)\/-\/(?:issues|work_items)\/\d+/)?.[1];
  } catch {
    return undefined;
  }
}

/** The GitLab API path of the issue a ticket URL points at, with the host it lives on. */
export function gitLabIssueEndpoint(issueUrl: string) {
  try {
    const url = new URL(issueUrl);
    const match = url.pathname.match(/^\/(.+?)\/-\/(?:issues|work_items)\/(\d+)/);
    return match ? { hostname: url.hostname, path: `projects/${encodeURIComponent(match[1])}/issues/${match[2]}` } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The agents a finished run leaves behind. A stop event can never arrive for an
 * agent whose session is gone, so one that was still running keeps reading as
 * running for good: the console spins a live timer on a run that ended hours
 * ago, and the next self-audit is handed a "running" agent to diagnose. Its real
 * outcome is unknowable at that point, and calling it completed or failed both
 * invent one, so it is abandoned.
 */
export function closeAbandonedAgents(agents: AgentState[], endedAt: string) {
  const abandoned = agents.filter((agent) => agent.status === "running");
  if (abandoned.length === 0) return { agents, abandoned };
  return { agents: agents.map((agent) => agent.status === "running" ? { ...agent, status: "abandoned" as const, endedAt } : agent), abandoned };
}

/** The agent a stop event closes: by id, or by name for one that reported no id. */
export function agentStopTarget(agents: AgentState[], agentId: string, agentName: string) {
  return agents.find((agent) => agent.id === agentId)
    ?? agents.find((agent) => agent.name === agentName && agent.status === "running");
}

export function runInProgress(status: RunStatus) {
  return status === "starting" || status === "running" || status === "attention";
}

export function phaseForAgent(agentName: string) {
  const name = agentName.slice(agentName.lastIndexOf(":") + 1);
  if (name === "ticket-planner") return 4;
  if (name === "developer") return 5;
  if (name.endsWith("-reviewer") || name === "review-orchestrator") return 6;
  return 0;
}

export function createsBranch(command: string | undefined) {
  return command !== undefined && /\bgit\b[^;&|]*?\b(?:checkout\s+-b|switch\s+(?:-c|--create))\b/.test(command);
}

const BRANCH_NAME = /\bgit\b[^;&|]*?\b(?:checkout\s+-b|switch\s+(?:-c|--create))\s+(?:--\s+)?("[^"]+"|'[^']+'|[^\s;&|]+)/;

/** The branch the workflow works on, read from the command that creates it. */
export function branchFromCommand(command: string | undefined) {
  const name = command?.match(BRANCH_NAME)?.[1];
  return name ? name.replace(/^["']|["']$/g, "") : undefined;
}

/**
 * Both shapes that open a merge request: the subcommand, and the REST call the
 * workflow uses so the description exists at creation time. The trailing guard
 * keeps the collection endpoint apart from the ones nested under a merge
 * request, `merge_requests/<iid>/notes` being a comment, not an opening.
 */
const OPENS_MERGE_REQUEST =
  /\b(?:glab|gh)\b[^;&|]*?(?:\b(?:mr|pr)\s+create\b|--method\s+POST\b[^;&|]*\/(?:merge_requests|pulls)(?![\w/]))/;

/**
 * What a shell command is busy doing. Ordered, first match wins, so a rule
 * always comes before the family it belongs to: opening the merge request
 * comes before being merely a call to GitLab.
 */
const SHELL_ACTIONS: [RegExp, string][] = [
  [OPENS_MERGE_REQUEST, "Ouverture de la merge request"],
  [/\b(?:glab|gh)\b[^;&|]*\b(?:mr|pr)\b/, "Consultation de la merge request"],
  [/\bglab\b[^;&|]*\b(?:issue|work-item)\b/, "Lecture du ticket GitLab"],
  [/\bglab\b/, "Consultation de GitLab"],
  [/\bgh\b/, "Consultation de GitHub"],
  [/\bgit\b[^;&|]*\b(?:checkout\s+-b|switch\s+(?:-c|--create))\b/, "Création de la branche"],
  [/\bgit\b[^;&|]*\bcommit\b/, "Commit des modifications"],
  [/\bgit\b[^;&|]*\bpush\b/, "Publication de la branche"],
  [/\bgit\b/, "Inspection du dépôt"],
  [/\b(?:jest|vitest|pytest|playwright|test:unit|test:integration)\b|\b(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b/, "Exécution des tests"],
  [/\btsc\b|\btypecheck\b/, "Vérification des types"],
  [/\b(?:eslint|biome|ruff|lint)\b/, "Analyse statique du code"],
  [/\b(?:build|make|cargo)\b/, "Build du projet"],
  [/\b(?:npm|pnpm|yarn)\s+(?:ci|install|add)\b/, "Installation des dépendances"],
  [/\b(?:grep|rg|ack)\b/, "Recherche dans le code"],
  [/\b(?:cat|head|tail|less|sed|awk)\b/, "Lecture des fichiers"],
  [/\b(?:ls|find|tree)\b/, "Exploration du dépôt"],
];

function named(prefix: string, target: string | undefined, fallback: string) {
  return target ? `${prefix} ${path.basename(target)}` : fallback;
}

const TOOL_ACTIONS: Record<string, (target?: string) => string> = {
  Read: (target) => named("Lecture de", target, "Lecture d'un fichier"),
  Edit: (target) => named("Modification de", target, "Modification d'un fichier"),
  NotebookEdit: (target) => named("Modification de", target, "Modification d'un notebook"),
  Write: (target) => named("Écriture de", target, "Écriture d'un fichier"),
  Grep: (target) => target ? `Recherche de « ${target} »` : "Recherche dans le code",
  Glob: () => "Parcours des fichiers",
  Task: (target) => target ? `Délégation à ${target}` : "Délégation à un agent",
  Agent: (target) => target ? `Délégation à ${target}` : "Délégation à un agent",
  Skill: (target) => target ? `Compétence ${target}` : "Chargement d'une compétence",
  TodoWrite: () => "Mise à jour du plan",
  WebSearch: () => "Recherche sur le web",
  WebFetch: (target) => {
    const host = target && URL.canParse(target) ? new URL(target).host : undefined;
    return host ? `Consultation de ${host}` : "Consultation du web";
  },
};

function externalToolAction(tool: string) {
  if (tool.startsWith("mcp__playwright__")) return "Pilotage du navigateur";
  if (/figma/i.test(tool)) return "Consultation de Figma";
  return tool.startsWith("mcp__") ? "Appel d'un outil externe" : undefined;
}

/**
 * What the interface says the agent is doing right now, read from the tool it
 * just called. A tool call is not a milestone and has no place in the activity
 * feed, but between two paragraphs of the dialogue it is the only thing that
 * says a silent session is working rather than stuck.
 */
export function actionLabel(tool: string, command?: string, target?: string) {
  if (tool === "Bash") return SHELL_ACTIONS.find(([pattern]) => pattern.test(command ?? ""))?.[1] ?? "Commande shell";
  return TOOL_ACTIONS[tool]?.(target) ?? externalToolAction(tool);
}

export function createsMergeRequest(command: string | undefined) {
  return command !== undefined && OPENS_MERGE_REQUEST.test(command);
}

const MERGE_REQUEST_URL = /https?:\/\/[^\s"'<>()\\]*?\/(?:-\/merge_requests|merge_requests|pull)\/\d+/;

/**
 * The created merge request only ever names itself in the output of the command
 * that opened it, and that output reaches the harness as a PostToolUse response
 * whose shape depends on the tool.
 */
export function mergeRequestUrl(toolResponse: unknown) {
  if (toolResponse === undefined || toolResponse === null) return undefined;
  const text = typeof toolResponse === "string" ? toolResponse : JSON.stringify(toolResponse);
  return text?.match(MERGE_REQUEST_URL)?.[0];
}

export function gitRemoteProjects(config: string): string[] {
  const projects = new Set<string>();
  for (const match of config.matchAll(/^\s*url\s*=\s*(.+)$/gm)) {
    const url = match[1].trim().replace(/\.git$/, "");
    const scp = url.match(/^[^/]+@[^:/]+:(.+)$/)?.[1];
    const project = scp ?? url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i)?.[1];
    if (project) projects.add(project.replace(/^\/+/, ""));
  }
  return [...projects];
}

/** A previous run leaves its documents in the project, and only this run's own count. */
export function belongsToRun(writtenAt: number, startedAt: string | null) {
  return startedAt !== null && writtenAt >= new Date(startedAt).getTime();
}

/** The directory the artifact watcher attaches to, one level above the documents. */
export function artifactWatchRoot(taskRoot: string) {
  return path.dirname(taskRoot);
}

/**
 * Which paths that watch is allowed to follow. A watch attached to the task
 * directory itself stops firing for good the moment the workflow deletes it,
 * and the workflow does exactly that mid-run, so the watch sits on the parent
 * and the directory becomes an ordinary entry that may come and go. The parent
 * holds much more than documents, `.claude/worktrees` being whole checkouts, so
 * nothing outside the task directory is ever descended into.
 */
export function watchedForArtifacts(taskRoot: string, candidate: string) {
  return candidate === artifactWatchRoot(taskRoot) || candidate === taskRoot || candidate.startsWith(taskRoot + path.sep);
}

export function phaseForArtifact(relativePath: string) {
  const name = path.basename(relativePath);
  if (name === "ticket-context.md") return 1;
  if (name === "open-questions.md") return 2;
  if (name === "planner-output.json") return 4;
  if (name.startsWith("developer-report") || name.startsWith("dev-evidence") || name === "browser-recipe.md") return 5;
  if (name.startsWith("senior-review") || name.startsWith("designer-review") || name.startsWith("qa-report") || name.startsWith("qa-evidence") || name.startsWith("design-evidence")) return 6;
  if (name === "review-summary.md") return 7;
  if (name === "mr-description.md") return 8;
  if (name === "mr-review-comment.md") return 9;
  return 0;
}

function identifierList(value: unknown) {
  return Array.isArray(value) ? value.flatMap((entry) => normalizeText(entry) ?? []) : [];
}

/** Unlike normalizeText, keeps the paragraph breaks and more than a line: the description is read in the task detail. */
function prose(value: unknown, limit: number) {
  if (typeof value !== "string") return undefined;
  return value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, limit) || undefined;
}

/**
 * The tasks of a `planner-output.json`, or undefined when the file is not a
 * plan yet: the planner writes it in one go, but a half-written read must not
 * wipe the board it already feeds.
 */
export function plannedTasks(content: string): PlanTask[] | undefined {
  let plan: unknown;
  try { plan = JSON.parse(content); } catch { return undefined; }
  const tasks = (plan as { tasks?: unknown } | null)?.tasks;
  if (!Array.isArray(tasks)) return undefined;
  return tasks.flatMap((task) => {
    const id = normalizeText((task as { id?: unknown } | null)?.id);
    if (!id) return [];
    const title = normalizeText((task as { title?: unknown }).title) ?? id;
    const complexity = normalizeText((task as { complexity?: unknown }).complexity);
    const criterionIds = identifierList((task as { criterion_ids?: unknown }).criterion_ids);
    const dependencies = identifierList((task as { dependencies?: unknown }).dependencies);
    const description = prose((task as { description?: unknown }).description, 1200);
    const filePaths = identifierList((task as { file_paths?: unknown }).file_paths);
    return [{
      id, title, ...(complexity ? { complexity } : {}), status: "todo" as const,
      ...(criterionIds.length ? { criterionIds } : {}), ...(dependencies.length ? { dependencies } : {}),
      ...(description ? { description } : {}), ...(filePaths.length ? { filePaths } : {}),
    }];
  });
}

function agentType(name: string) {
  return name.slice(name.lastIndexOf(":") + 1);
}

/** Only a developer works a plan task: a reviewer handed the reports to read is not starting one. */
export function isDeveloperDelegation(target: string | undefined) {
  return target !== undefined && agentType(target) === "developer";
}

/** Women and men alternate so agents launched together look apart. Each name is bound to its own picture in public/avatars. */
const NICKNAMES = [
  { name: "Léa", avatar: "lea" }, { name: "Tom", avatar: "tom" },
  { name: "Chloé", avatar: "chloe" }, { name: "Hugo", avatar: "hugo" },
  { name: "Inès", avatar: "ines" }, { name: "Louis", avatar: "louis" },
  { name: "Manon", avatar: "manon" }, { name: "Jules", avatar: "jules" },
  { name: "Zoé", avatar: "zoe" }, { name: "Arthur", avatar: "arthur" },
  { name: "Camille", avatar: "camille" }, { name: "Paul", avatar: "paul" },
];

const ROLES: Record<string, string> = {
  developer: "Dev",
  "ticket-planner": "Planif",
  "senior-reviewer": "Revue",
  "qa-reviewer": "QA",
  "designer-reviewer-figma": "Design",
  "review-orchestrator": "Orchestration",
  Explore: "Exploration",
};

/** The short French role an agent type is shown under, or the bare type when it has none. */
export function agentRole(name: string) {
  const type = agentType(name);
  return ROLES[type] ?? type;
}

/** The first name and picture of the agent started in that position of the run, the name numbered once the pool has gone round. */
export function agentIdentity(index: number) {
  const { name, avatar } = NICKNAMES[index % NICKNAMES.length];
  const round = Math.floor(index / NICKNAMES.length);
  return { nickname: round === 0 ? name : `${name} ${round + 1}`, avatar: `/avatars/${avatar}.webp` };
}

/**
 * Pairs a starting agent with the oldest unpaired delegation of its type. The
 * launch names the tasks but not the agent, the start names the agent but not
 * the tasks, and Claude Code starts agents in the order it launched them.
 */
export function pairDelegation(delegations: PlanDelegation[], startedType: string, agentId: string) {
  const index = delegations.findIndex((delegation) => !delegation.agentId && agentType(delegation.agentType) === agentType(startedType));
  if (index === -1) return delegations;
  return delegations.map((delegation, position) => position === index ? { ...delegation, agentId } : delegation);
}

/**
 * Where each plan task stands: done once its report exists, whatever relaunch
 * came after, in progress once a developer was handed it. The assignee is the
 * agent of the latest paired delegation, so a reworked task follows its new agent.
 */
export function planTaskBoard(tasks: PlanTask[], delegations: PlanDelegation[], agents: AgentState[], artifacts: string[]): PlanTask[] {
  const reports = new Set(artifacts.map((artifact) => path.basename(artifact)));
  return tasks.map(({ assignee: _previous, ...task }) => {
    const handed = delegations.filter((delegation) => delegation.taskIds.includes(task.id));
    const agentId = handed.findLast((delegation) => delegation.agentId)?.agentId;
    const agent = agentId ? agents.find((candidate) => candidate.id === agentId) : undefined;
    const status = reports.has(`developer-report-${task.id}.md`) ? "done" as const : handed.length > 0 ? "in_progress" as const : "todo" as const;
    if (!agentId) return { ...task, status };
    return { ...task, status, assignee: { agentId, nickname: agent?.nickname, avatar: agent?.avatar, role: agent?.role } };
  });
}

export function emptyState(): RunState {
  return { id: null, status: "idle", phase: 0, cwd: "", issueUrl: "", instruction: "", startedAt: null, endedAt: null, agents: [], activities: [], messages: [], artifacts: [], sessionActive: false };
}

/**
 * Whether a run still holds the checkout it was started on. The workflow reaching
 * its last phase does not release it: the session stays open at its prompt, the
 * user keeps talking to it and it keeps writing to the same working tree. Only a
 * session that is gone frees the repository, which is what the queue waits on,
 * and what sessionsToReleaseForQueue takes back when someone is waiting.
 */
export function runHoldsRepository(state: Pick<RunState, "status" | "sessionActive">) {
  return runInProgress(state.status) || state.sessionActive;
}

/** A run as the release decision reads it: what it holds, and since when it has nothing left to do. */
type HeldRun = { id: string; cwd: string; status: RunStatus; sessionActive: boolean; endedAt: string | null };

/**
 * The finished runs whose session has to go for the queue to move. Their
 * workflow is over but their session sits at its prompt, holding a checkout and
 * a slot: harmless while nobody is waiting, which is why the session is kept,
 * and unacceptable the moment a queued launch needs exactly what it holds. So a
 * run with nothing left to do yields to one that has work, rather than waiting
 * for the user to notice and free the place by hand.
 */
export function sessionsToReleaseForQueue(runs: HeldRun[], queue: QueuedRun[], maxConcurrentRuns: number) {
  if (queue.length === 0) return [];
  const idle = runs
    .filter((run) => runHoldsRepository(run) && !runInProgress(run.status))
    .sort((left, right) => (left.endedAt ?? "").localeCompare(right.endedAt ?? ""));
  const awaited = new Set(queue.map((entry) => entry.cwd));
  const released = new Set(idle.filter((run) => awaited.has(run.cwd)).map((run) => run.id));
  const held = runs.filter((run) => runHoldsRepository(run) && !released.has(run.id));
  // Whoever is still waiting with its checkout free is waiting on a slot alone,
  // and the run that finished first is the one that has held one the longest.
  const waitsOnSlot = queue.some((entry) => !held.some((run) => run.cwd === entry.cwd));
  if (waitsOnSlot && held.length >= maxConcurrentRuns) {
    const oldest = idle.find((run) => !released.has(run.id));
    if (oldest) released.add(oldest.id);
  }
  return [...released];
}

/**
 * The run as the side list sees it: everything a row, a dot or a notification
 * needs, and nothing that grows with the length of the run. See RunSummary.
 */
function openIncidentSummary(state: RunState) {
  const incident = state.incidents?.findLast((entry) => entry.status === "open");
  return incident ? { incident: { id: incident.id, kind: incident.kind, title: incident.title, revision: incident.revision } } : {};
}

export function summarizeRun(state: RunState): RunSummary {
  const lastMessage = state.messages.at(-1);
  return {
    id: state.id ?? "",
    status: state.status,
    phase: state.phase,
    cwd: state.cwd,
    issueUrl: state.issueUrl,
    ticketTitle: state.ticketTitle,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    branch: state.branch,
    mergeRequestUrl: state.mergeRequestUrl,
    error: state.error,
    action: state.action,
    sessionActive: state.sessionActive,
    pendingQuestionId: state.pendingQuestion?.id,
    pendingQuestionCount: state.pendingQuestion?.questions.length ?? 0,
    runningAgents: state.agents.filter((agent) => agent.status === "running").length,
    lastMessageId: lastMessage?.id,
    lastMessageAuthor: lastMessage?.author,
    evidenceUpdatedAt: state.evidenceUpdatedAt,
    ...(state.acceptance?.available ? { acceptance: state.acceptance.counts } : {}),
    holdsRepository: runHoldsRepository(state),
    ...(state.health ? { health: state.health.health } : {}),
    ...(openIncidentSummary(state)),
    ...(state.archived ? { archived: true } : {}),
  };
}

/**
 * How many runs may hold a session at once. A run is a full Claude Code session
 * with its own quota and its own CPU, so the ceiling exists to stop the console
 * from opening more of them than the machine, or the user, can follow.
 */
export function concurrencyLimit(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 10 ? parsed : fallback;
}

export const permissionModes = ["manual", "acceptEdits", "auto", "dontAsk", "bypassPermissions"] as const;

/**
 * A run is meant to go all the way without a watcher, so it carries its
 * permission mode explicitly instead of inheriting whatever the machine that
 * opens it happens to have configured.
 */
export function permissionMode(value: string | undefined, fallback: string) {
  const mode = value?.trim();
  return mode && (permissionModes as readonly string[]).includes(mode) ? mode : fallback;
}

/**
 * Why a queued launch is still waiting, and what it is waiting for. A checkout
 * held by a run always wins over the slot count: naming the free slot as the
 * blocker when the real one is a run on the same repository sends the user to
 * stop the wrong session. The queue is drained the moment either frees up, so an
 * entry still in it is always blocked by one of the two.
 */
export function describeQueue(queue: QueuedRun[], holders: Map<string, string>): QueuedRunView[] {
  return queue.map((entry) => {
    const blockedBy = holders.get(entry.cwd);
    return blockedBy ? { ...entry, reason: "repository" as const, blockedBy } : { ...entry, reason: "slot" as const };
  });
}

/**
 * The hook payloads a session could not post while the console was busy or
 * down, in the order it wrote them. A line cut short by a crash is skipped,
 * not allowed to take the rest of the file with it.
 */
export function spooledHooks(text: string) {
  const bodies: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const body = JSON.parse(line) as unknown;
      if (body && typeof body === "object" && !Array.isArray(body)) bodies.push(body as Record<string, unknown>);
    } catch { /* a torn line */ }
  }
  return bodies;
}

/**
 * Whether a merged improvement needs the console restarted to take effect. The
 * plugin (commands, agents, skills, hooks) is read again by every new session,
 * the console's own code only by a fresh `impl` process. The launcher and its
 * configuration also live outside the plugin.
 */
export function mergeNeedsRestart(changedPaths: string[]) {
  return changedPaths.some((file) => file.startsWith("console/") || file.startsWith("bin/"));
}
