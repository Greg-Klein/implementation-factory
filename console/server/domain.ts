import { createHash } from "node:crypto";
import path from "node:path";
import { normalizeTicketUrl, parseDeliveryUrl, parseTicketUrl, parseTicketUrls, ticketIdentity, ticketReference, type Forge, type ForgeAddress } from "../lib/ticket-urls.js";
import type { AgentState, MergeWatch, PlanDelegation, PlanTask, QueueCause, QueuedRun, QueuedRunView, ResolvedTicket, RunState, RunStatus, RunSummary, ScheduleConfidence, ScheduledTicket, ScheduleEdge, TicketProposal } from "./types.js";

/** How a pasted list of ticket URLs is read, shared with the launch form. See lib/ticket-urls.ts. */
export { normalizeTicketUrl, parseDeliveryUrl, parseTicketUrl, parseTicketUrls, ticketIdentity, ticketReference };
export type { Forge, ForgeAddress };

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
export function exitReport(stoppedBy: "user" | "queue" | null, exitCode: number, workflowComplete = true, trustRefused = false) {
  if (trustRefused) return "Session fermée, dossier non approuvé";
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

/** The project a ticket belongs to, as its remote names it: `group/platform/repo` on GitLab, `owner/repo` on GitHub. */
export function ticketProjectPath(issueUrl: string) {
  return parseTicketUrl(issueUrl)?.project;
}

/** What the CLI of a forge is asked: which one, on which host, at which API path. */
export type ForgeEndpoint = { forge: Forge; hostname: string; path: string };

/** The API path of the issue a ticket URL points at, with the forge and the host it lives on. */
export function issueEndpoint(issueUrl: string): ForgeEndpoint | undefined {
  const ticket = parseTicketUrl(issueUrl);
  if (!ticket) return undefined;
  const path = ticket.forge === "github" ? `repos/${ticket.project}/issues/${ticket.number}` : `projects/${encodeURIComponent(ticket.project)}/issues/${ticket.number}`;
  return { forge: ticket.forge, hostname: ticket.hostname, path };
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

/** The workflow file that says how the target repository's app is started and reached. */
export const RUNTIME_RECIPE_FILE = "runtime-recipe.md";

/**
 * Where the console keeps that file between the runs of one repository. Named
 * after the checkout for a person reading the directory, and after its full
 * path so two checkouts of the same name never share a recipe.
 */
export function runtimeRecipeStore(storageRoot: string, repository: string) {
  const checkout = path.resolve(repository);
  const name = path.basename(checkout).replace(/[^\w.-]+/g, "-") || "repository";
  const digest = createHash("sha256").update(checkout).digest("hex").slice(0, 10);
  return path.join(storageRoot, "repositories", `${name}-${digest}`, RUNTIME_RECIPE_FILE);
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

/**
 * `qa-plan.md` and `design-inventory.md` are deliberately absent: a reviewer
 * writes them before it starts, so they are the output of no step and must
 * not open the next one while the review is still running.
 */
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

/**
 * What each reviewer writes before it reads the authors' conclusions, and the
 * report that must come after it.
 */
const REVIEW_PLANS = [
  { plan: "qa-plan.md", report: "qa-report.md", planLabel: "Le plan de test QA", reportLabel: "le rapport QA" },
  { plan: "design-inventory.md", report: "designer-review.md", planLabel: "L'inventaire design", reportLabel: "la revue de design" },
];

/**
 * Whether each reviewer's plan was first seen before its report, from the
 * arrival time of each document. A remark, never a verdict: it says the order
 * cannot be shown, not that the review is wrong. Nothing is said while the
 * report itself has not arrived, or when its arrival time is unknown.
 */
export function reviewPlanNotes(arrivals: Record<string, string> | undefined) {
  const notes: string[] = [];
  for (const { plan, report, planLabel, reportLabel } of REVIEW_PLANS) {
    const reportAt = Date.parse(arrivals?.[report] ?? "");
    if (Number.isNaN(reportAt)) continue;
    const planAt = Date.parse(arrivals?.[plan] ?? "");
    if (Number.isNaN(planAt)) notes.push(`${planLabel} (${plan}) n'est pas arrivé avant ${reportLabel} : rien ne montre qu'il a été écrit en premier.`);
    else if (planAt > reportAt) notes.push(`${planLabel} (${plan}) est arrivé après ${reportLabel} : rien ne montre qu'il a été écrit en premier.`);
  }
  return notes;
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
    const summary = prose((task as { summary?: unknown }).summary, 400);
    const description = prose((task as { description?: unknown }).description, 4000);
    const filePaths = identifierList((task as { file_paths?: unknown }).file_paths);
    return [{
      id, title, ...(complexity ? { complexity } : {}), status: "todo" as const,
      ...(criterionIds.length ? { criterionIds } : {}), ...(dependencies.length ? { dependencies } : {}),
      ...(summary ? { summary } : {}), ...(description ? { description } : {}), ...(filePaths.length ? { filePaths } : {}),
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
  "designer-reviewer": "Design",
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
 * Whether a run still holds its slot and its ticket. The workflow reaching its
 * last phase does not release them: the session stays open at its prompt, the
 * user keeps talking to it and it keeps writing to its worktree. Only a session
 * that is gone frees them, which is what the queue waits on, and what
 * sessionsToReleaseForQueue takes back when someone is waiting.
 */
export function runHoldsRepository(state: Pick<RunState, "status" | "sessionActive">) {
  return runInProgress(state.status) || state.sessionActive;
}

/** The checkout a run was launched on. A run archived before worktrees ran in that checkout itself. */
export function sourceRepository(run: { repository?: string; cwd: string }) {
  return run.repository || run.cwd;
}

/**
 * What two launches must not share. Every run works in a worktree of its own,
 * so two tickets of one repository no longer fight over a working tree; two runs
 * on the same ticket would still fight over its branch and its merge request.
 * The ticket is compared without its query or fragment, the way a pasted URL varies.
 */
export function runLockKey(run: { repository?: string; cwd: string; issueUrl: string }) {
  return `${sourceRepository(run).replace(/\/+$/, "")}\n${ticketIdentity(run.issueUrl)}`;
}

/** A run as the release decision reads it: what it holds, and since when it has nothing left to do. */
type HeldRun = { id: string; cwd: string; repository?: string; issueUrl: string; status: RunStatus; sessionActive: boolean; endedAt: string | null };
type Launch = { cwd: string; repository?: string; issueUrl: string };

/**
 * The finished runs whose session has to go for the queue to move. Their
 * workflow is over but their session sits at its prompt, holding a ticket and
 * a slot: harmless while nobody is waiting, which is why the session is kept,
 * and unacceptable the moment a queued launch needs exactly what it holds. So a
 * run with nothing left to do yields to one that has work, rather than waiting
 * for the user to notice and free the place by hand.
 */
export function sessionsToReleaseForQueue(runs: HeldRun[], queue: Launch[], maxConcurrentRuns: number) {
  if (queue.length === 0) return [];
  const idle = runs
    .filter((run) => runHoldsRepository(run) && !runInProgress(run.status))
    .sort((left, right) => (left.endedAt ?? "").localeCompare(right.endedAt ?? ""));
  const awaited = new Set(queue.map(runLockKey));
  const released = new Set(idle.filter((run) => awaited.has(runLockKey(run))).map((run) => run.id));
  const held = runs.filter((run) => runHoldsRepository(run) && !released.has(run.id));
  // Whoever is still waiting with its ticket free is waiting on a slot alone,
  // and the run that finished first is the one that has held one the longest.
  const heldKeys = new Set(held.map(runLockKey));
  const waitsOnSlot = queue.some((entry) => !heldKeys.has(runLockKey(entry)));
  if (waitsOnSlot && held.length >= maxConcurrentRuns) {
    const oldest = idle.find((run) => !released.has(run.id));
    if (oldest) released.add(oldest.id);
  }
  return [...released];
}

/** Where the worktrees of the runs live inside a repository, ignored through `.git/info/exclude`. */
export const RUN_WORKTREES_DIRECTORY = ".claude/worktrees";

export function runWorktreePath(repository: string, runId: string) {
  return path.join(repository, ...RUN_WORKTREES_DIRECTORY.split("/"), runId);
}

/** Whether a path is one the console itself would have created: nothing else is ever removed. */
export function isRunWorktreePath(repository: string, candidate: string) {
  const relative = path.relative(path.join(repository, ...RUN_WORKTREES_DIRECTORY.split("/")), candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative) && !relative.includes(path.sep);
}

/** A comma-separated setting read as a list; empty or absent falls back on the defaults. */
export function listSetting(value: string | undefined, fallback: string[]) {
  const entries = (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 0 ? entries : fallback;
}

function nameMatches(pattern: string, name: string) {
  const expression = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${expression}$`).test(name);
}

/**
 * What a fresh worktree lacks and takes from the main checkout, chosen from
 * the ignored entries git lists there (`ls-files --others --ignored
 * --exclude-standard --directory`, a directory ending with a slash).
 * `directories` are dependency directories matched by name at any depth;
 * `files` are ignored files matched by name. A copy pattern holding a slash is
 * a path from the root, returned in `paths` and taken whether git ignores it or
 * not. Nothing under the worktrees directory is ever taken.
 */
export function worktreeProvisioning(ignoredEntries: string[], linkNames: string[], copyPatterns: string[]) {
  const namePatterns = copyPatterns.filter((pattern) => !pattern.includes("/"));
  const directories: string[] = [];
  const files: string[] = [];
  for (const entry of ignoredEntries) {
    if (!entry || entry === `${RUN_WORKTREES_DIRECTORY}/` || entry.startsWith(`${RUN_WORKTREES_DIRECTORY}/`) || `${RUN_WORKTREES_DIRECTORY}/`.startsWith(entry)) continue;
    const directory = entry.endsWith("/");
    const relative = directory ? entry.slice(0, -1) : entry;
    const name = relative.split("/").pop() ?? "";
    if (directory) { if (linkNames.some((pattern) => nameMatches(pattern, name))) directories.push(relative); }
    else if (namePatterns.some((pattern) => nameMatches(pattern, name))) files.push(relative);
  }
  const paths = copyPatterns.filter((pattern) => pattern.includes("/")).map((pattern) => pattern.replace(/^\/+/, "")).filter((pattern) => !pattern.split("/").includes(".."));
  return { directories, files, paths };
}

/** A path written as a line of `.git/info/exclude`: anchored at the root, its glob characters taken literally. */
export function excludeLine(relativePath: string, { directory = false }: { directory?: boolean } = {}) {
  return `/${relativePath.replace(/[\\*?[\]]/g, "\\$&")}${directory ? "/" : ""}`;
}

/** The exclude file with the missing lines appended, or undefined when it already holds them all. */
export function withExcludeLines(content: string, lines: string[]) {
  const present = new Set(content.split("\n").map((line) => line.trim()));
  const missing = [...new Set(lines)].filter((line) => !present.has(line));
  if (missing.length === 0) return undefined;
  return `${content}${content && !content.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`;
}

/** What git says of a worktree on disk. `pushed`: its HEAD is on a remote-tracking branch. */
export type WorktreeFacts = { exists: boolean; clean: boolean; pushed: boolean };

/**
 * Whether the worktree of a run may go, and how. `allowed`: its session is gone,
 * so nothing is working in it. `automatic`: the console removes it on its own,
 * which takes a finished run with a real merge request, its evidence archived,
 * a clean tree and a HEAD the remote already has. `reasons` say why it is kept
 * instead, and `risks` what a removal asked by hand would lose, which is what
 * the interface asks a confirmation for. The branch is never part of a removal.
 */
export function worktreeRemoval(
  run: Pick<RunState, "status" | "sessionActive" | "mergeRequestUrl" | "workflow" | "archiveSyncedAt">,
  facts: WorktreeFacts,
): { allowed: boolean; automatic: boolean; reasons: string[]; risks: string[] } {
  const allowed = !runHoldsRepository(run);
  const risks = [...(facts.clean ? [] : ["changements non commités"]), ...(facts.pushed ? [] : ["changements non poussés"])];
  const reasons: string[] = [];
  if (!allowed) reasons.push("session encore ouverte");
  const draft = run.workflow?.result?.delivery === "draft_merge_request";
  if (!run.mergeRequestUrl) reasons.push("aucune merge request");
  else if (draft || run.workflow?.state === "blocked") reasons.push("merge request en brouillon sur un run bloqué");
  else if (run.status !== "completed") reasons.push("run non terminé");
  if (run.mergeRequestUrl && !run.archiveSyncedAt) reasons.push("archive des preuves non confirmée");
  reasons.push(...risks);
  return { allowed, automatic: facts.exists && reasons.length === 0, reasons, risks };
}

/** What the interface says of a worktree, in one line. */
export function worktreeKeptDetail(reasons: string[]) {
  return reasons.length > 0 ? `Worktree conservé : ${reasons.join(", ")}` : "Worktree conservé";
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
    repository: sourceRepository(state),
    ...(state.worktree ? { worktree: state.worktree } : {}),
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
    ...(state.sessionPrompt ? { sessionPromptId: state.sessionPrompt.id } : {}),
    runningAgents: state.agents.filter((agent) => agent.status === "running").length,
    lastMessageId: lastMessage?.id,
    lastMessageAuthor: lastMessage?.author,
    evidenceUpdatedAt: state.evidenceUpdatedAt,
    ...(state.acceptance?.available ? { acceptance: state.acceptance.counts } : {}),
    holdsRepository: runHoldsRepository(state),
    ...(state.health ? { health: state.health.health } : {}),
    ...(state.usage ? { tokens: state.usage.total } : {}),
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

/** The API path of the merge request or pull request a URL points at, with the forge, the host and its number. */
export function deliveryEndpoint(mergeRequestUrl: string): (ForgeEndpoint & { number: string }) | undefined {
  const delivery = parseDeliveryUrl(mergeRequestUrl);
  if (!delivery) return undefined;
  const path = delivery.forge === "github" ? `repos/${delivery.project}/pulls/${delivery.number}` : `projects/${encodeURIComponent(delivery.project)}/merge_requests/${delivery.number}`;
  return { forge: delivery.forge, hostname: delivery.hostname, path, number: delivery.number };
}

/**
 * A run is meant to go all the way without a watcher, so it carries its
 * permission mode explicitly instead of inheriting whatever the machine that
 * opens it happens to have configured.
 */
export function permissionMode(value: string | undefined, fallback: string) {
  const mode = value?.trim();
  return mode && (permissionModes as readonly string[]).includes(mode) ? mode : fallback;
}

/** A ticket of the demonstration: it has no repository, no GitLab and nothing to keep across a restart. */
export function isSimulatedTicket(issueUrl: string) {
  return issueUrl.startsWith("ticket-simule://");
}

const CONFIDENCES: readonly string[] = ["high", "medium", "low"];
const EDGE_KINDS: readonly string[] = ["overlap", "depends_on"];

export type SchedulePrediction = { issueUrl: string; areas: string[]; files: string[]; confidence: ScheduleConfidence; summary: string };
export type ScheduleOutputEdge = { a: string; b: string; kind: "overlap" | "depends_on"; order?: [string, string]; reason: string };
export type ScheduleOutput = { tickets: SchedulePrediction[]; edges: ScheduleOutputEdge[] };
/** `state`: where a known ticket stands, as the contract names it. */
export type KnownTicket = { ticket: ScheduledTicket; state: "queued" | "running" | "awaiting_merge" };

/** The input file of a scheduling session, as contracts/schedule.md defines it. */
export function scheduleInput(repository: string, tickets: string[], known: KnownTicket[]) {
  return {
    repository,
    tickets: tickets.map((issueUrl) => ({ issue_url: issueUrl })),
    known: known.map(({ ticket, state }) => ({ issue_url: ticket.issueUrl, areas: ticket.areas, files: ticket.files, state })),
  };
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "") : [];
}

/**
 * The output of a scheduling session held against the rules of
 * contracts/schedule.md. The whole file is refused on the first rule that
 * fails: a schedule that is partly wrong would let two conflicting tickets run
 * together, which is worse than running the batch one ticket at a time.
 * `error` is a French phrase, shown to the user as the reason of the failure.
 */
export function validateSchedule(input: { tickets: string[]; known: string[] }, output: unknown): { ok: true; schedule: ScheduleOutput } | { ok: false; error: string } {
  const refuse = (error: string) => ({ ok: false as const, error });
  if (!output || typeof output !== "object" || Array.isArray(output)) return refuse("la sortie n'est pas un objet JSON");
  const { tickets, edges } = output as { tickets?: unknown; edges?: unknown };
  if (!Array.isArray(tickets) || !Array.isArray(edges)) return refuse("il manque le tableau tickets ou edges");
  const expected = new Set(input.tickets);
  const known = new Set(input.known);
  const predictions: SchedulePrediction[] = [];
  for (const raw of tickets) {
    const ticket = (raw ?? {}) as Record<string, unknown>;
    const issueUrl = ticket.issue_url;
    if (typeof issueUrl !== "string" || !expected.has(issueUrl)) return refuse("un ticket de la sortie n'est pas dans l'entrée");
    if (predictions.some((prediction) => prediction.issueUrl === issueUrl)) return refuse("un ticket apparaît deux fois");
    if (typeof ticket.confidence !== "string" || !CONFIDENCES.includes(ticket.confidence)) return refuse("une confiance est hors des valeurs prévues");
    if (typeof ticket.summary !== "string" || !ticket.summary.trim()) return refuse("un résumé est vide");
    predictions.push({ issueUrl, areas: strings(ticket.areas), files: strings(ticket.files), confidence: ticket.confidence as ScheduleConfidence, summary: ticket.summary.trim() });
  }
  if (predictions.length !== expected.size) return refuse("un ticket de l'entrée n'a pas de prédiction");
  const pairs = new Set<string>();
  const links: ScheduleOutputEdge[] = [];
  for (const raw of edges) {
    const edge = (raw ?? {}) as Record<string, unknown>;
    const { a, b, kind, order, reason } = edge;
    if (typeof a !== "string" || typeof b !== "string" || ![a, b].every((url) => expected.has(url) || known.has(url))) return refuse("une arête cite un ticket inconnu");
    if (a === b) return refuse("une arête relie un ticket à lui-même");
    if (!expected.has(a) && !expected.has(b)) return refuse("une arête relie deux tickets déjà connus");
    if (typeof kind !== "string" || !EDGE_KINDS.includes(kind)) return refuse("un type d'arête est hors des valeurs prévues");
    if (typeof reason !== "string" || !reason.trim()) return refuse("une raison est vide");
    const pair = [a, b].sort().join("\n");
    if (pairs.has(pair)) return refuse("deux arêtes relient la même paire de tickets");
    pairs.add(pair);
    if (kind === "depends_on") {
      const valid = Array.isArray(order) && order.length === 2 && ((order[0] === a && order[1] === b) || (order[0] === b && order[1] === a));
      if (!valid) return refuse("une dépendance n'a pas d'ordre valide");
      links.push({ a, b, kind, order: [order[0], order[1]], reason: reason.trim() });
    } else {
      if (order !== undefined) return refuse("un chevauchement porte un ordre");
      links.push({ a, b, kind: "overlap", reason: reason.trim() });
    }
  }
  return { ok: true, schedule: { tickets: predictions, edges: links } };
}

/**
 * Splits a batch into what is new and what the console already has. A ticket
 * is one repository and one ticket (see runLockKey): the same one is never
 * queued twice, whether it sits in the queue, in a run or behind an unmerged
 * merge request, and whatever found it, a paste or anything else.
 */
export function admitBatch(tickets: ResolvedTicket[], taken: Iterable<string>) {
  const seen = new Set(taken);
  const accepted: ResolvedTicket[] = [];
  const duplicates: ResolvedTicket[] = [];
  for (const ticket of tickets) {
    const key = runLockKey({ cwd: ticket.repository, repository: ticket.repository, issueUrl: ticket.issueUrl });
    if (seen.has(key)) duplicates.push(ticket);
    else { seen.add(key); accepted.push(ticket); }
  }
  return { accepted, duplicates };
}

/**
 * The tickets a watcher's file names, see contracts/ticket-proposals.md. The
 * file is a snapshot: everything that matches the watcher's filter right now.
 * `undefined` when it is not a snapshot at all, which is not the same as an
 * empty one: the caller keeps what it read last. An entry that is not a ticket
 * URL is skipped, a ticket named twice is kept once.
 */
export function readProposalSnapshot(content: unknown): TicketProposal[] | undefined {
  if (!isRecord(content) || !Array.isArray(content.tickets)) return undefined;
  const proposals = new Map<string, TicketProposal>();
  for (const entry of content.tickets.filter(isRecord)) {
    const issueUrl = typeof entry.url === "string" ? normalizeTicketUrl(entry.url) : undefined;
    if (!issueUrl || proposals.has(issueUrl)) continue;
    const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
    proposals.set(issueUrl, { issueUrl, ...(text(entry.title) ? { title: text(entry.title) } : {}), ...(text(entry.source) ? { source: text(entry.source) } : {}) });
  }
  return [...proposals.values()];
}

/**
 * What is still to decide: the tickets found that the console does not already
 * have and that were neither accepted nor dismissed. Compared by address alone,
 * a proposal has no checkout yet.
 */
export function openProposals(found: TicketProposal[], taken: Iterable<string>, handled: Iterable<string>) {
  const known = new Set([...taken, ...handled].map(ticketIdentity));
  return found.filter((proposal) => !known.has(ticketIdentity(proposal.issueUrl)));
}

/**
 * A decision is remembered only while the watcher still finds the ticket: once
 * it left the filter it cannot be proposed, and when it comes back, to do
 * again, it is a new proposal. This is also what keeps the list from growing.
 */
export function handledStillFound(handled: string[], found: TicketProposal[]) {
  const current = new Set(found.map((proposal) => ticketIdentity(proposal.issueUrl)));
  return handled.filter((issueUrl) => current.has(ticketIdentity(issueUrl)));
}

/** A run as the schedule reads it: what it works on, whether it still works, and what a stacked start would be cut from. */
export type ScheduleRun = { id: string; cwd: string; repository?: string; issueUrl: string; status: RunStatus; branch?: string; mergeRequestUrl?: string };
/** Everything a queue is scheduled against, beside the ticket locks and the slots. */
export type ScheduleContext = { runs?: ScheduleRun[]; tickets?: ScheduledTicket[]; edges?: ScheduleEdge[]; watches?: MergeWatch[] };

type Conflict = { cause: QueueCause; detail: string; order?: [string, string] };
type ScheduleIndex = { tickets: Map<string, ScheduledTicket>; edges: Map<string, ScheduleEdge> };

function repositoryOf(launch: Launch) {
  return sourceRepository(launch).replace(/\/+$/, "");
}

function pairKey(repository: string, left: string, right: string) {
  return [repository.replace(/\/+$/, ""), ...[ticketIdentity(left), ticketIdentity(right)].sort()].join("\n");
}

function scheduleIndex(context: ScheduleContext): ScheduleIndex {
  return {
    tickets: new Map((context.tickets ?? []).map((ticket) => [runLockKey({ cwd: ticket.repository, issueUrl: ticket.issueUrl }), ticket])),
    edges: new Map((context.edges ?? []).map((edge) => [pairKey(edge.repository, edge.a, edge.b), edge])),
  };
}

/**
 * Why two launches must not run together, or undefined when they may. Two
 * tickets of different repositories never conflict, whatever the edges say:
 * the rule is enforced here, not left to the scheduling agent. Within one
 * repository, an edge keeps its two tickets apart, and a ticket whose analysis
 * failed, or whose prediction is `low`, is kept apart from every other.
 * `detail` is written for `left`, the ticket that waits: it says whether the
 * failed analysis or the vague prediction is its own or the other ticket's.
 */
function conflictBetween(index: ScheduleIndex, left: Launch, right: Launch): Conflict | undefined {
  const repository = repositoryOf(left);
  if (repository !== repositoryOf(right) || runLockKey(left) === runLockKey(right)) return undefined;
  const edge = index.edges.get(pairKey(repository, left.issueUrl, right.issueUrl));
  if (edge) return { cause: edge.kind, detail: edge.reason, ...(edge.order ? { order: edge.order } : {}) };
  const own = index.tickets.get(runLockKey(left));
  const other = index.tickets.get(runLockKey(right));
  const because = (ticket: ScheduledTicket) => (ticket.failure ? ` (${ticket.failure})` : "");
  if (own?.analysis === "failed") return { cause: "analysis_failed", detail: `L'analyse du lot a échoué${because(own)} : les tickets de ce dépôt passent un par un.` };
  if (other?.analysis === "failed") return { cause: "analysis_failed", detail: `L'analyse de ${ticketReference(other.issueUrl)} a échoué${because(other)} : ce ticket passe après lui.` };
  if (own?.confidence === "low") return { cause: "low_confidence", detail: `Prédiction peu fiable pour ce ticket : il passe seul sur son dépôt.${own.summary ? ` ${own.summary}` : ""}` };
  if (other?.confidence === "low") return { cause: "low_confidence", detail: `Prédiction peu fiable pour ${ticketReference(other.issueUrl)} : ce ticket passe après lui.${other.summary ? ` ${ticketReference(other.issueUrl)} : ${other.summary}` : ""}` };
  return undefined;
}

/**
 * The order the queue is walked in: the order the launches were asked for,
 * except that the first ticket of a `depends_on` edge goes before the second.
 * A forced entry ignores the edges, so nothing is moved ahead of it. A cycle
 * of dependencies falls back on the order asked.
 */
function priorityOrder(queue: QueuedRun[], index: ScheduleIndex) {
  const remaining = [...queue];
  const ordered: QueuedRun[] = [];
  const mustFollow = (entry: QueuedRun, other: QueuedRun) => {
    if (entry.forced) return false;
    const order = conflictBetween(index, entry, other)?.order;
    return order !== undefined && ticketIdentity(order[0]) === ticketIdentity(other.issueUrl);
  };
  while (remaining.length > 0) {
    const position = remaining.findIndex((entry) => !remaining.some((other) => other !== entry && mustFollow(entry, other)));
    ordered.push(...remaining.splice(Math.max(position, 0), 1));
  }
  return ordered;
}

function assessQueue(queue: QueuedRun[], holders: Map<string, string>, context: ScheduleContext): QueuedRunView[] {
  const index = scheduleIndex(context);
  const running = (context.runs ?? []).filter((run) => runInProgress(run.status));
  const ahead: QueuedRun[] = [];
  const assess = (entry: QueuedRun): QueuedRunView => {
    const own = index.tickets.get(runLockKey(entry));
    const base = {
      ...entry,
      ...(own?.summary ? { summary: own.summary } : {}), ...(own?.confidence ? { confidence: own.confidence } : {}),
      ...(own?.analysis === "failed" ? { analysisFailure: own.failure ?? "analyse en échec" } : {}),
    };
    const holder = holders.get(runLockKey(entry));
    if (holder) return { ...base, reason: "ticket", blockedBy: holder };
    // Forced by the user: the edges no longer hold it, the ticket lock and the slots still do.
    if (entry.forced) return { ...base, reason: "slot" };
    if (entry.analysing) return { ...base, reason: "analysis" };
    for (const run of running) {
      const conflict = conflictBetween(index, entry, run);
      if (conflict) return { ...base, reason: "conflict", blockedBy: run.id, blocking: { issueUrl: run.issueUrl, runId: run.id, ...(run.branch ? { branch: run.branch } : {}), ...(run.mergeRequestUrl ? { mergeRequestUrl: run.mergeRequestUrl } : {}) }, cause: conflict.cause, detail: conflict.detail };
    }
    for (const watch of context.watches ?? []) {
      const conflict = conflictBetween(index, entry, { cwd: watch.repository, issueUrl: watch.issueUrl });
      if (conflict) return { ...base, reason: watch.state === "unknown" ? "merge_unknown" : "merge", blocking: { issueUrl: watch.issueUrl, mergeRequestUrl: watch.mergeRequestUrl, ...(watch.runId ? { runId: watch.runId } : {}), ...(watch.branch ? { branch: watch.branch } : {}) }, cause: conflict.cause, detail: conflict.detail };
    }
    for (const other of ahead) {
      const conflict = conflictBetween(index, entry, other);
      if (conflict) return { ...base, reason: conflict.cause === "depends_on" ? "dependency" : "order", blocking: { issueUrl: other.issueUrl, queuedId: other.id }, cause: conflict.cause, detail: conflict.detail };
    }
    return { ...base, reason: "slot" };
  };
  return priorityOrder(queue, index).map((entry) => {
    const view = assess(entry);
    ahead.push(entry);
    return view;
  });
}

/**
 * Why each queued launch is still waiting, and what it is waiting for, in the
 * order the launches were asked. A run on the same ticket always wins over the
 * rest: naming a free slot as the blocker when the real one is that run sends
 * the user to stop the wrong session. Then come the analysis still running,
 * a conflicting run in progress, the merge request of a finished one, and a
 * conflicting ticket ahead in the queue. `holders` maps a lock key (see
 * runLockKey) to the run holding it. An entry nothing of this holds waits on a
 * slot alone, and starts as soon as one is free.
 */
export function describeQueue(queue: QueuedRun[], holders: Map<string, string>, context: ScheduleContext = {}): QueuedRunView[] {
  const views = new Map(assessQueue(queue, holders, context).map((view) => [view.id, view]));
  return queue.map((entry) => views.get(entry.id)!);
}

/**
 * The entries that start now, `freeSlots` at most, in the order they start. A
 * held entry takes no slot and the entries behind it that conflict with nothing
 * pass it. Among conflicting entries the order asked is kept, a dependency
 * first, so the one behind waits for the merge request of the one ahead.
 */
export function startableEntries(queue: QueuedRun[], holders: Map<string, string>, context: ScheduleContext, freeSlots: number): QueuedRun[] {
  if (freeSlots <= 0) return [];
  const byId = new Map(queue.map((entry) => [entry.id, entry]));
  return assessQueue(queue, holders, context).filter((view) => view.reason === "slot").slice(0, freeSlots).map((view) => byId.get(view.id)!);
}

/** The merge requests something in the queue is waiting for: the only ones worth asking GitLab about. */
export function heldWatches(queue: QueuedRun[], context: ScheduleContext): MergeWatch[] {
  const index = scheduleIndex(context);
  const waiting = queue.filter((entry) => !entry.forced);
  return (context.watches ?? []).filter((watch) => waiting.some((entry) => conflictBetween(index, entry, { cwd: watch.repository, issueUrl: watch.issueUrl })));
}

/** The queued entries that would be held behind a ticket, a run that just ended for instance. */
export function conflictingEntries(queue: QueuedRun[], ticket: Launch, context: ScheduleContext): QueuedRun[] {
  const index = scheduleIndex(context);
  return queue.filter((entry) => !entry.forced && conflictBetween(index, entry, ticket));
}

export type MergeRequestStatus = "opened" | "merged" | "closed" | "unknown";

/** The `state` GitLab gives a merge request, as the watch reads it. `locked` is a merge in progress, still open. */
export function mergeRequestStatus(state: unknown): MergeRequestStatus {
  if (state === "merged" || state === "closed") return state;
  return state === "opened" || state === "locked" ? "opened" : "unknown";
}

/** What GitHub says of a pull request: `state` is only `open` or `closed`, and `merged` tells a merge from a plain closing. */
export function pullRequestStatus(pullRequest: { state?: unknown; merged?: unknown }): MergeRequestStatus {
  if (pullRequest.merged === true) return "merged";
  if (pullRequest.state === "closed") return pullRequest.merged === false ? "closed" : "unknown";
  return pullRequest.state === "open" ? "opened" : "unknown";
}

/** The answer of a forge about a merge request or a pull request, read the way that forge writes it. */
export function deliveryStatus(forge: Forge, response: { state?: unknown; merged?: unknown }): MergeRequestStatus {
  return forge === "github" ? pullRequestStatus(response) : mergeRequestStatus(response.state);
}

/**
 * What a watch becomes once GitLab answered. Merged, or closed without a
 * merge: the watch is over and whatever it held is released. An answer that
 * could not be had keeps holding, as `unknown`, so a failing `glab` never
 * lets a conflicting ticket start on its own.
 */
export function mergeWatchStep(watch: MergeWatch, status: MergeRequestStatus, at: string): { watch?: MergeWatch; released?: "merged" | "closed" } {
  if (status === "merged" || status === "closed") return { released: status };
  return { watch: { ...watch, state: status === "opened" ? "open" : "unknown", checkedAt: at } };
}

/** What the schedule keeps: the tickets still queued, running or awaited, and the edges between two of them. */
export function pruneSchedule(tickets: ScheduledTicket[], edges: ScheduleEdge[], live: Set<string>) {
  const key = (repository: string, issueUrl: string) => runLockKey({ cwd: repository, issueUrl });
  return {
    tickets: tickets.filter((ticket) => live.has(key(ticket.repository, ticket.issueUrl))),
    edges: edges.filter((edge) => live.has(key(edge.repository, edge.a)) && live.has(key(edge.repository, edge.b))),
  };
}

export type StoredQueue = { queue: QueuedRun[]; tickets: ScheduledTicket[]; edges: ScheduleEdge[]; watches: MergeWatch[] };

/** Why a batch whose analysis did not survive a restart runs one ticket at a time. */
export const INTERRUPTED_ANALYSIS = "console redémarrée pendant l'analyse";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** What `queue.json` holds: the queue and the schedule it is read against. Nothing simulated is written. */
export function storedQueue(state: StoredQueue) {
  return {
    version: 2,
    queue: state.queue.filter((entry) => !entry.demo),
    tickets: state.tickets.filter((ticket) => !isSimulatedTicket(ticket.issueUrl)),
    edges: state.edges.filter((edge) => !isSimulatedTicket(edge.a)),
    watches: state.watches.filter((watch) => !isSimulatedTicket(watch.issueUrl)),
  };
}

/**
 * `queue.json` as read at start. The file was a bare array of launches before
 * batches existed, and still loads. An entry whose analysis was running when
 * the console went down never got its answer: it comes back as a failed
 * analysis, so its repository runs one ticket at a time instead of silently in parallel.
 */
export function restoreQueueFile(stored: unknown): StoredQueue {
  const list = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord) : []);
  const file = isRecord(stored) ? stored : { queue: stored };
  const text = (value: unknown) => typeof value === "string" && value !== "";
  const queue = list(file.queue)
    .filter((entry) => text(entry.id) && text(entry.cwd) && text(entry.issueUrl) && entry.demo !== true)
    // A queue written before worktrees named the checkout as `cwd` alone.
    .map((entry) => ({ instruction: "", queuedAt: "", ...entry, repository: sourceRepository(entry as { cwd: string; repository?: string }) }) as QueuedRun);
  const interrupted = queue.filter((entry) => entry.analysing);
  const tickets = (list(file.tickets).filter((ticket) => text(ticket.issueUrl) && text(ticket.repository) && (ticket.analysis === "done" || ticket.analysis === "failed")) as ScheduledTicket[])
    .map((ticket) => ({ ...ticket, areas: strings(ticket.areas), files: strings(ticket.files) }))
    .filter((ticket) => !interrupted.some((entry) => runLockKey(entry) === runLockKey({ cwd: ticket.repository, issueUrl: ticket.issueUrl })));
  return {
    queue: queue.map(({ analysing: _analysing, ...entry }) => entry),
    tickets: [...tickets, ...interrupted.map((entry) => ({ issueUrl: entry.issueUrl, repository: entry.repository, analysis: "failed" as const, areas: [], files: [], failure: INTERRUPTED_ANALYSIS }))],
    edges: list(file.edges).filter((edge) => text(edge.repository) && text(edge.a) && text(edge.b) && text(edge.reason) && EDGE_KINDS.includes(edge.kind as string)) as ScheduleEdge[],
    watches: (list(file.watches).filter((watch) => text(watch.issueUrl) && text(watch.repository) && text(watch.mergeRequestUrl)) as MergeWatch[])
      .map((watch) => ({ ...watch, state: watch.state === "open" ? "open" as const : "unknown" as const, since: text(watch.since) ? watch.since : "" })),
  };
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

/**
 * Where the scheduling sessions read and write. Claude Code refuses a session
 * any write inside the directory of the plugin it loaded, and the default data
 * directory sits in that plugin: the files then go to a directory of the
 * system's temporary directory, private to the user. A data directory outside
 * the plugin keeps them.
 */
export function scheduleDirectory(storageRoot: string, pluginRoot: string, temporaryRoot: string, user: string) {
  const fromPlugin = path.relative(pluginRoot, storageRoot);
  const inside = fromPlugin === "" || (!fromPlugin.startsWith("..") && !path.isAbsolute(fromPlugin));
  return inside ? path.join(temporaryRoot, `implementation-harness-${user}`, "schedule") : path.join(storageRoot, "schedule");
}
