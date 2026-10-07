import { createHash } from "node:crypto";
import path from "node:path";
import { defined } from "../lib/defined.js";
import { forgeOf, forgeWords, normalizeTicketUrl, parseDeliveryUrl, parseTicketUrl, parseTicketUrls, ticketIdentity, ticketReference, withoutQuery, type Forge, type ForgeAddress } from "../lib/ticket-urls.js";
import type { AgentState, MergeWatch, PlanDelegation, PlanTask, QueueCause, QueuedRun, QueuedRunView, ResolvedTicket, RunState, RunStatus, RunSummary, ScheduleConfidence, ScheduledTicket, ScheduleEdge, TicketProposal } from "./types.js";
import type { WorkflowLanguage } from "./acceptance-text.js";

/** How a pasted list of ticket URLs is read, shared with the launch form. See lib/ticket-urls.ts. */
export { forgeOf, forgeWords, normalizeTicketUrl, parseDeliveryUrl, parseTicketUrl, parseTicketUrls, ticketIdentity, ticketReference };
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
    return [{ label: candidate.label.trim(), ...defined({ description: typeof candidate.description === "string" ? candidate.description.trim() : undefined }) }];
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
 * The three files the "Evidence" tab reads, and only those: the `-roundN`
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
  if (trustRefused) return "Session closed, folder not trusted";
  if (stoppedBy === "queue") return "Slot freed for the queue";
  if (stoppedBy === "user") return "Session stopped by the user";
  if (!workflowComplete) return exitCode === 0 ? "Session ended before the workflow finished" : "Session interrupted";
  return exitCode === 0 ? "Session ended" : "Session interrupted";
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

/** What a forge says holds an issue back, and what the issue holds back, as ticket addresses. */
export type IssueLinks = { blockedBy: string[]; blocks: string[] };
export type IssueLinkEndpoint = ForgeEndpoint & { lists: "links" | "blocked_by" | "blocking" };

/**
 * The API paths that give the blocking links of an issue. GitLab answers both
 * directions in one list, each link with its `link_type`; GitHub has one list
 * per direction.
 */
export function issueLinkEndpoints(issueUrl: string): IssueLinkEndpoint[] {
  const issue = issueEndpoint(issueUrl);
  if (!issue) return [];
  if (issue.forge === "gitlab") return [{ ...issue, path: `${issue.path}/links`, lists: "links" }];
  return (["blocked_by", "blocking"] as const).map((lists) => ({ ...issue, path: `${issue.path}/dependencies/${lists}?per_page=100`, lists }));
}

/**
 * The blocking links out of one answer of `issueLinkEndpoints`. A GitLab
 * `relates_to` link is not a dependency and is left out. An entry without an
 * address is skipped.
 */
export function readIssueLinks(lists: IssueLinkEndpoint["lists"], response: unknown): IssueLinks {
  const links: IssueLinks = { blockedBy: [], blocks: [] };
  for (const entry of Array.isArray(response) ? response.filter(isRecord) : []) {
    const address = lists === "links" ? entry.web_url : entry.html_url;
    if (typeof address !== "string") continue;
    if (lists === "blocked_by" || entry.link_type === "is_blocked_by") links.blockedBy.push(address);
    else if (lists === "blocking" || entry.link_type === "blocks") links.blocks.push(address);
  }
  return links;
}

/** One ticket whatever its address is written like: GitLab serves the same issue under `/-/issues/` and `/-/work_items/`. */
function forgeTicket(issueUrl: string) {
  const ticket = parseTicketUrl(issueUrl);
  return ticket ? `${ticket.hostname}/${ticket.project}#${ticket.number}`.toLowerCase() : undefined;
}

/**
 * The dependencies the forge states between a ticket and the other tickets of
 * its repository the console has. A blocking link is a fact of the forge, not
 * a prediction: the blocking ticket is implemented first. Each edge carries
 * the addresses the console knows the tickets by, which is what the schedule
 * joins on. A link to a ticket the console does not have gives nothing.
 */
export function linkEdges(repository: string, issueUrl: string, links: IssueLinks, others: string[]): ScheduleEdge[] {
  const own = forgeTicket(issueUrl);
  const blockedBy = new Set(links.blockedBy.map(forgeTicket));
  const blocks = new Set(links.blocks.map(forgeTicket));
  const forge = forgeWords(forgeOf(issueUrl)).name;
  const edges: ScheduleEdge[] = [];
  for (const other of others) {
    const key = forgeTicket(other);
    if (!key || key === own || edges.some((edge) => forgeTicket(edge.b) === key)) continue;
    const order: [string, string] | undefined = blockedBy.has(key) ? [other, issueUrl] : blocks.has(key) ? [issueUrl, other] : undefined;
    if (order) edges.push({ repository, a: issueUrl, b: other, kind: "depends_on", order, reason: `${forge} marks ${ticketReference(order[1])} as blocked by ${ticketReference(order[0])}.` });
  }
  return edges;
}

/** Edges put over others: where both name the same pair of tickets, the edge of `over` is the one kept. */
export function overlayEdges(edges: ScheduleEdge[], over: ScheduleEdge[]): ScheduleEdge[] {
  const kept = new Map<string, ScheduleEdge>();
  for (const edge of [...edges, ...over]) kept.set(pairKey(edge.repository, edge.a, edge.b), edge);
  return [...kept.values()];
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

/** The workflow ended and archived its evidence since the last change asked after the final report. */
export function deliveredCodeSettled(state: Pick<RunState, "status" | "archiveSyncedAt" | "reopenings">) {
  if (!state.archiveSyncedAt || runInProgress(state.status)) return false;
  const last = state.reopenings?.at(-1);
  return !last || (last.to !== undefined && state.archiveSyncedAt >= last.to);
}

export function phaseForAgent(agentName: string) {
  const name = agentName.slice(agentName.lastIndexOf(":") + 1);
  if (name === "ticket-planner") return 4;
  if (name === "developer") return 5;
  if (name.endsWith("-reviewer") || name === "review-orchestrator") return 6;
  return 0;
}

/**
 * The step the workflow says it is in, as a phase. `workflow-state.json` is the
 * only thing that knows it: a document tells which step wrote it, not which one
 * is running. The first of nine developer reports is not the end of the
 * implementation, and a merge request text drafted while QA still runs opens
 * nothing.
 */
export function declaredPhase(workflow: { step?: string } | undefined) {
  const step = Number(/^\d+/.exec(workflow?.step ?? "")?.[0]);
  return step >= 1 && step <= 10 ? step : undefined;
}

/**
 * The phase once a document, an agent or a command pointed at `inferred`.
 * What the console reads off them only stands in for a workflow that declares
 * no step; one that does is never overtaken by a guess.
 */
export function phaseAfterInference(current: number, inferred: number, workflow: { step?: string } | undefined) {
  return declaredPhase(workflow) === undefined ? Math.max(current, inferred) : current;
}

export function createsBranch(command: string | undefined) {
  return command !== undefined && /\bgit\b[^;&|]*?\b(?:checkout\s+-b|switch\s+(?:-c|--create))\b/.test(command);
}

const BRANCH_NAME = /\bgit\b[^;&|]*?\b(?:checkout\s+-b|switch\s+(?:-c|--create))\s+(?:--\s+)?("[^"]+"|'[^']+'|[^\s;&|]+)/;

/**
 * The branch the workflow works on, read from the command that creates it.
 * The pilot often names it once in a variable (`B=feat-12; ...; git switch -c $B`),
 * so a bare `$B` is resolved against the last assignment written before it. A name
 * still holding an expansion is no branch name, and recording it would hand `$B`
 * to a stacked start as its base.
 */
export function branchFromCommand(command: string | undefined) {
  const match = command?.match(BRANCH_NAME);
  const captured = match?.[1];
  if (!command || !match || !captured) return undefined;
  const name = captured.replace(/^["']|["']$/g, "");
  const variable = /^\$\{?(\w+)\}?$/.exec(name)?.[1];
  const resolved = variable ? lastAssignment(command.slice(0, match.index), variable) : name;
  return resolved && !/[$`]/.test(resolved) ? resolved : undefined;
}

function lastAssignment(command: string, variable: string) {
  const assignments = [...command.matchAll(new RegExp(`(?:^|[\\s;&|])${variable}=("[^"]*"|'[^']*'|[^\\s;&|]+)`, "g"))];
  return assignments.at(-1)?.[1]?.replace(/^["']|["']$/g, "");
}

/**
 * Both shapes that open a merge request: the subcommand, and the REST call the
 * workflow uses so the description exists at creation time. The trailing guard
 * keeps the collection endpoint apart from the ones nested under a merge
 * request, `merge_requests/<iid>/notes` being a comment, not an opening.
 */
const OPENS_MERGE_REQUEST =
  /\b(?:glab|gh)\b[^;&|]*?(?:\b(?:mr|pr)\s+create\b|--method\s+POST\b[^;&|]*\/(?:merge_requests|pulls)(?![\w/]))/;

/** The same opening on GitHub, named apart only for what the interface calls it. */
const OPENS_PULL_REQUEST = /\bgh\b[^;&|]*?(?:\bpr\s+create\b|--method\s+POST\b[^;&|]*\/pulls(?![\w/]))/;

/**
 * What a shell command is busy doing. Ordered, first match wins, so a rule
 * always comes before the family it belongs to: opening the merge request
 * comes before being merely a call to GitLab.
 */
const SHELL_ACTIONS: [RegExp, string][] = [
  [OPENS_PULL_REQUEST, "Opening the pull request"],
  [OPENS_MERGE_REQUEST, "Opening the merge request"],
  [/\bgh\b[^;&|]*\bpr\b/, "Reading the pull request"],
  [/\bglab\b[^;&|]*\bmr\b/, "Reading the merge request"],
  [/\bglab\b[^;&|]*\b(?:issue|work-item)\b/, "Reading the GitLab ticket"],
  [/\bgh\b[^;&|]*\bissue\b/, "Reading the GitHub ticket"],
  [/\bglab\b/, "Querying GitLab"],
  [/\bgh\b/, "Querying GitHub"],
  [/\bgit\b[^;&|]*\b(?:checkout\s+-b|switch\s+(?:-c|--create))\b/, "Creating the branch"],
  [/\bgit\b[^;&|]*\bcommit\b/, "Committing the changes"],
  [/\bgit\b[^;&|]*\bpush\b/, "Pushing the branch"],
  [/\bgit\b/, "Inspecting the repository"],
  [/\b(?:jest|vitest|pytest|playwright|test:unit|test:integration)\b|\b(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b/, "Running the tests"],
  [/\btsc\b|\btypecheck\b/, "Checking types"],
  [/\b(?:eslint|biome|ruff|lint)\b/, "Linting the code"],
  [/\b(?:build|make|cargo)\b/, "Building the project"],
  [/\b(?:npm|pnpm|yarn)\s+(?:ci|install|add)\b/, "Installing the dependencies"],
  [/\b(?:grep|rg|ack)\b/, "Searching the code"],
  [/\b(?:cat|head|tail|less|sed|awk)\b/, "Reading files"],
  [/\b(?:ls|find|tree)\b/, "Exploring the repository"],
];

function named(prefix: string, target: string | undefined, fallback: string) {
  return target ? `${prefix} ${path.basename(target)}` : fallback;
}

const TOOL_ACTIONS: Record<string, (target?: string) => string> = {
  Read: (target) => named("Reading", target, "Reading a file"),
  Edit: (target) => named("Editing", target, "Editing a file"),
  NotebookEdit: (target) => named("Editing", target, "Editing a notebook"),
  Write: (target) => named("Writing", target, "Writing a file"),
  Grep: (target) => target ? `Searching for "${target}"` : "Searching the code",
  Glob: () => "Listing files",
  Task: (target) => target ? `Delegating to ${target}` : "Delegating to an agent",
  Agent: (target) => target ? `Delegating to ${target}` : "Delegating to an agent",
  Skill: (target) => target ? `Skill ${target}` : "Loading a skill",
  TodoWrite: () => "Updating the plan",
  WebSearch: () => "Searching the web",
  WebFetch: (target) => {
    const host = target && URL.canParse(target) ? new URL(target).host : undefined;
    return host ? `Querying ${host}` : "Querying the web";
  },
};

function externalToolAction(tool: string) {
  if (tool.startsWith("mcp__playwright__")) return "Driving the browser";
  if (/figma/i.test(tool)) return "Querying Figma";
  return tool.startsWith("mcp__") ? "Calling an external tool" : undefined;
}

/**
 * What the interface says the agent is doing right now, read from the tool it
 * just called. A tool call is not a milestone and has no place in the activity
 * feed, but between two paragraphs of the dialogue it is the only thing that
 * says a silent session is working rather than stuck.
 */
export function actionLabel(tool: string, command?: string, target?: string) {
  if (tool === "Bash") return SHELL_ACTIONS.find(([pattern]) => pattern.test(command ?? ""))?.[1] ?? "Shell command";
  return TOOL_ACTIONS[tool]?.(target) ?? externalToolAction(tool);
}

export function createsMergeRequest(command: string | undefined) {
  return command !== undefined && OPENS_MERGE_REQUEST.test(command);
}

const MERGE_REQUEST_URL = /https?:\/\/[^\s"'<>()\\]*?\/(?:-\/merge_requests|merge_requests|pull)\/\d+/g;

/** Every text a tool response holds, whatever its shape. */
function responseTexts(value: unknown, depth = 0): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || depth > 4) return [];
  return Object.values(value).flatMap((entry) => responseTexts(entry, depth + 1));
}

/** The address the forge gives the object it just created: `web_url` on GitLab, `html_url` on GitHub. */
function createdAddress(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start || text.slice(0, start).trim()) return undefined;
  let answer: unknown;
  // Up to its last brace: whatever a CLI prints after the object does not make it unread.
  try { answer = JSON.parse(text.slice(start, end + 1)) as unknown; } catch { return undefined; }
  if (!isRecord(answer)) return undefined;
  const address = [answer.web_url, answer.html_url].find((candidate): candidate is string => typeof candidate === "string" && Boolean(parseDeliveryUrl(candidate)));
  return address?.match(MERGE_REQUEST_URL)?.[0];
}

/**
 * The created merge request only ever names itself in the output of the command
 * that opened it, and that output reaches the harness as a PostToolUse response
 * whose shape depends on the tool. That output also quotes what the description
 * says, and a description cites other merge requests (the parent of a stacked
 * run for one): an API answer is read as the object it is, and a printed output
 * by its last address, which is where a CLI names what it created. What the
 * command printed on its standard output is read first: the remote's own
 * messages, which may name another merge request, arrive on the error output.
 */
export function mergeRequestUrl(toolResponse: unknown) {
  const printed = isRecord(toolResponse) && typeof toolResponse.stdout === "string" ? [toolResponse.stdout] : [];
  for (const texts of [printed, responseTexts(toolResponse)]) {
    for (const text of texts) {
      const created = createdAddress(text);
      if (created) return created;
    }
    const last = texts.flatMap((text) => text.match(MERGE_REQUEST_URL) ?? []).at(-1);
    if (last) return last;
  }
  return undefined;
}

export function gitRemoteProjects(config: string): string[] {
  const projects = new Set<string>();
  for (const [, value = ""] of config.matchAll(/^\s*url\s*=\s*(.+)$/gm)) {
    const url = value.trim().replace(/\.git$/, "");
    const scp = url.match(/^[^/]+@[^:/]+:(.+)$/)?.[1];
    const project = scp ?? url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i)?.[1];
    if (project) projects.add(project.replace(/^\/+/, ""));
  }
  return [...projects];
}

/** The project the `origin` remote of a checkout points at, else the one of its first remote. */
export function originProject(config: string): string | undefined {
  let section = "";
  const origin: string[] = [];
  for (const line of config.split("\n")) {
    const header = line.match(/^\s*\[(.+)\]\s*$/)?.[1];
    if (header !== undefined) section = header.trim();
    else if (section === 'remote "origin"') origin.push(line);
  }
  return gitRemoteProjects(origin.join("\n"))[0] ?? gitRemoteProjects(config)[0];
}

/**
 * The projects that get a merge request for a ticket, when the workflow has
 * to be told: the ticket lives in none of them, or there are several. Then the
 * merge request names the ticket by its full reference, and with several
 * projects it closes nothing, since the ticket is done only when all are merged.
 * `undefined` for the usual case, one merge request in the ticket's own project.
 */
export function deliveryProjects(issueUrl: string, projects: (string | undefined)[]): string[] | undefined {
  const own = ticketProjectPath(issueUrl)?.toLowerCase();
  const known = [...new Set(projects.filter((project): project is string => Boolean(project)))];
  if (known.length === 0) return undefined;
  return known.length > 1 || known[0]?.toLowerCase() !== own ? known : undefined;
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

/** What the senior reviewer writes beside its report: its findings as data, one category each. */
export const SENIOR_FINDINGS_FILE = "senior-findings.json";

/** What a new run is handed: the kinds of defect the reviews of this repository keep finding. */
export const RECURRING_FINDINGS_FILE = "recurring-findings.md";

/**
 * The kinds a finding is filed under, mirrored in `contracts/review-findings.md`.
 * A fixed list is what lets the same habit be counted from one run to the next:
 * two reviewers never word a defect the same way twice. `other` is counted nowhere.
 */
export const FINDING_CATEGORIES: Record<string, string> = {
  "requirement-missed": "An acceptance criterion or the run instruction left unimplemented",
  "consumer-left-behind": "A caller or consumer of a changed contract left as it was",
  "edge-case": "A boundary value or an empty case mishandled",
  "error-handling": "An error swallowed, left unhandled or shown raw",
  "async-state": "A race, a missing cancellation, a stale or half-updated state",
  "ui-state": "A loading, empty or error state missing",
  "boundary-validation": "Outside data trusted without validation",
  authorization: "A permission or ownership check missing",
  "data-integrity": "A write that can lose or corrupt data",
  "type-escape": "A type silenced: any, unsafe cast, non-null assertion",
  "test-cannot-fail": "A test that cannot fail for the defect it covers",
  "test-gap": "A changed behaviour left without a test",
  "repository-convention": "A convention or an existing pattern of the repository not followed",
  duplication: "An existing helper or component written again",
  accessibility: "A control without semantics, label or keyboard access",
  performance: "Needless work on a changed path",
  "dead-code": "Dead code, leftover debug output or TODO",
  "stale-documentation": "Documentation the change made false",
  other: "Anything else",
};

export type ReviewFinding = { id: string; category: string; severity: "P0" | "P1" | "P2"; summary: string; file?: string; fixed: boolean };
export type KeptFinding = ReviewFinding & { runId: string; ticket: string; at: string };
export type RecurringFinding = { category: string; label: string; tickets: number; findings: number; examples: KeptFinding[] };

const FINDINGS_KEPT_DAYS = 180;
const FINDINGS_RECENT_DAYS = 90;
const FINDINGS_KEPT_MOST = 1000;
const DAY_MS = 86_400_000;

/** Where the console keeps the findings of one repository, beside its runtime recipe. */
export function reviewFindingsStore(storageRoot: string, repository: string) {
  return path.join(path.dirname(runtimeRecipeStore(storageRoot, repository)), "review-findings.json");
}

/**
 * The findings of a `senior-findings.json`, or undefined when the file is not
 * one. An entry that cannot be counted (no id, no summary) is dropped, and a
 * category outside the list is filed under `other` rather than refused: a
 * reviewer that invents a word still leaves its report readable. A bare array
 * is read as the list itself: a review that found nothing often writes `[]`.
 */
export function readReviewFindings(text: string): ReviewFinding[] | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return undefined; }
  const entries = Array.isArray(parsed) ? parsed : (parsed as { findings?: unknown } | null)?.findings;
  if (!Array.isArray(entries)) return undefined;
  const findings: ReviewFinding[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const { id, category, severity, summary, file, fixed } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim() || typeof summary !== "string" || !summary.trim()) continue;
    if (findings.some((finding) => finding.id === id.trim())) continue;
    findings.push({
      id: id.trim(),
      category: typeof category === "string" && category in FINDING_CATEGORIES ? category : "other",
      severity: severity === "P0" || severity === "P1" ? severity : "P2",
      summary: summary.trim().replace(/\s+/g, " ").slice(0, 300),
      ...(typeof file === "string" && file.trim() ? { file: file.trim().slice(0, 200) } : {}),
      fixed: fixed === true,
    });
  }
  return findings;
}

/**
 * What is kept once a run wrote its findings again. A later round rewrites the
 * file with that round's findings only, so an id already kept for the run is
 * replaced and the others stay. Old findings leave: a habit nobody has shown
 * for six months is not one any more.
 */
export function mergeReviewFindings(kept: KeptFinding[], incoming: ReviewFinding[], run: { runId: string; ticket: string }, now: number): KeptFinding[] {
  const at = new Date(now).toISOString();
  const rewritten = new Set(incoming.map((finding) => finding.id));
  const others = kept.filter((finding) => !(finding.runId === run.runId && rewritten.has(finding.id)));
  const merged = [...others, ...incoming.map((finding) => ({ ...finding, runId: run.runId, ticket: withoutQuery(run.ticket), at }))];
  return merged.filter((finding) => now - Date.parse(finding.at) < FINDINGS_KEPT_DAYS * DAY_MS).slice(-FINDINGS_KEPT_MOST);
}

/**
 * The kinds of defect found on at least two tickets in the last three months,
 * the most widespread first. One ticket repeating itself, through rework rounds
 * or a second run, is that ticket and not a habit of the repository.
 */
export function recurringFindings(kept: KeptFinding[], now: number): RecurringFinding[] {
  const recent = kept.filter((finding) => finding.category !== "other" && now - Date.parse(finding.at) < FINDINGS_RECENT_DAYS * DAY_MS);
  const groups = new Map<string, KeptFinding[]>();
  for (const finding of recent) groups.set(finding.category, [...(groups.get(finding.category) ?? []), finding]);
  return [...groups]
    .map(([category, findings]) => ({
      category, label: FINDING_CATEGORIES[category] ?? category, tickets: new Set(findings.map((finding) => finding.ticket)).size, findings: findings.length,
      examples: [...findings].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 3),
    }))
    .filter((group) => group.tickets >= 2)
    .sort((a, b) => b.tickets - a.tickets || b.findings - a.findings)
    .slice(0, 5);
}

/** The file a developer reads before it writes code. */
export function renderRecurringFindings(recurring: RecurringFinding[]) {
  const sections = recurring.map((group) => [
    `## ${group.label} (\`${group.category}\`): ${group.findings} findings on ${group.tickets} tickets`,
    "",
    ...group.examples.map((finding) => `- ${finding.severity}${finding.file ? ` \`${finding.file}\`` : ""}: ${finding.summary}`),
  ].join("\n"));
  return [
    "# Recurring review findings",
    "",
    `Kept by the console from the senior reviews of earlier runs on this repository. Each section is a kind of defect a reviewer found on at least two tickets in the last ${FINDINGS_RECENT_DAYS} days, with its latest examples. They are habits to check a change against before handing it over. They are not requirements, and nothing here widens the scope of a task.`,
    "",
    sections.join("\n\n"),
    "",
  ].join("\n");
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
  { plan: "qa-plan.md", report: "qa-report.md", planLabel: "The QA test plan", reportLabel: "the QA report" },
  { plan: "design-inventory.md", report: "designer-review.md", planLabel: "The design inventory", reportLabel: "the design review" },
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
    if (Number.isNaN(planAt)) notes.push(`${planLabel} (${plan}) did not arrive before ${reportLabel}: nothing shows it was written first.`);
    else if (planAt > reportAt) notes.push(`${planLabel} (${plan}) arrived after ${reportLabel}: nothing shows it was written first.`);
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

/**
 * The tasks a developer brief hands over, among the reports it names. A brief
 * also cites the reports of earlier tasks as reading material, and a report
 * that already exists is one of those: every task and every rework writes
 * under a suffix of its own. When every report named exists, the brief asks
 * for one of them again and nothing says which, so all are kept.
 */
export function delegatedTasks(taskIds: string[], artifacts: string[]) {
  const written = new Set(artifacts.map((artifact) => path.basename(artifact)));
  const pending = taskIds.filter((taskId) => !written.has(`developer-report-${taskId}.md`));
  return pending.length > 0 ? pending : taskIds;
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
  developer: "Developer",
  "ticket-planner": "Planner",
  "senior-reviewer": "Senior reviewer",
  "qa-reviewer": "QA reviewer",
  "designer-reviewer": "Design reviewer",
  "review-orchestrator": "Review orchestrator",
  Explore: "Explorer",
};

/** The role an agent type is shown under, or the bare type when it has none. */
export function agentRole(name: string) {
  const type = agentType(name);
  return ROLES[type] ?? type;
}

/** The first name and picture of the agent started in that position of the run, the name numbered once the pool has gone round. */
export function agentIdentity(index: number) {
  const picked = NICKNAMES[index % NICKNAMES.length];
  if (!picked) throw new RangeError(`No agent is started in position ${index}.`);
  const { name, avatar } = picked;
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
    return { ...task, status, assignee: { agentId, ...defined({ nickname: agent?.nickname, avatar: agent?.avatar, role: agent?.role }) } };
  });
}

export function emptyState(): RunState {
  return { id: null, status: "idle", phase: 0, cwd: "", issueUrl: "", instruction: "", startedAt: null, endedAt: null, agents: [], activities: [], messages: [], artifacts: [], sessionActive: false };
}

/**
 * Whether a run still holds its ticket. The workflow reaching its last phase
 * does not release it: the session stays open at its prompt, the user keeps
 * talking to it and it keeps writing to its worktree on that ticket's branch.
 * Only a session that is gone frees it, or sessionsToReleaseForQueue when a
 * launch on the same ticket is waiting.
 */
export function runHoldsRepository(state: Pick<RunState, "status" | "sessionActive">) {
  return runInProgress(state.status) || state.sessionActive;
}

/** Whether a run takes one of the concurrent slots: only while its workflow works. A finished run idling at its prompt costs nothing. */
export function runTakesSlot(state: Pick<RunState, "status">) {
  return runInProgress(state.status);
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

/** A run as the release decision reads it: what it holds, and whether it still works. */
type HeldRun = { id: string; cwd: string; repository?: string; issueUrl: string; status: RunStatus; sessionActive: boolean };
type Launch = { cwd: string; repository?: string; issueUrl: string };

/**
 * The finished runs whose session has to go for the queue to move. Their
 * workflow is over but their session sits at its prompt, holding its ticket:
 * harmless while nobody is waiting, which is why the session is kept, and
 * unacceptable the moment a queued launch needs that very ticket. A slot never
 * calls for it, since a finished run takes none.
 */
export function sessionsToReleaseForQueue(runs: HeldRun[], queue: Launch[]) {
  const awaited = new Set(queue.map(runLockKey));
  return runs.filter((run) => runHoldsRepository(run) && !runTakesSlot(run) && awaited.has(runLockKey(run))).map((run) => run.id);
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
 * not. `hooks` are the ignored entries at or under the repository's hooks path
 * (`core.hooksPath`, relative), such as the `.husky/_` helper a hook sources:
 * git does not create them in a worktree, and the first commit fails without
 * them. Nothing under the worktrees directory is ever taken.
 */
export function worktreeProvisioning(ignoredEntries: string[], linkNames: string[], copyPatterns: string[], hooksPath?: string) {
  const namePatterns = copyPatterns.filter((pattern) => !pattern.includes("/"));
  const hooksRoot = hooksPath === undefined ? undefined : relativeHooksPath(hooksPath);
  const directories: string[] = [];
  const files: string[] = [];
  const hooks: string[] = [];
  for (const entry of ignoredEntries) {
    if (!entry || entry === `${RUN_WORKTREES_DIRECTORY}/` || entry.startsWith(`${RUN_WORKTREES_DIRECTORY}/`) || `${RUN_WORKTREES_DIRECTORY}/`.startsWith(entry)) continue;
    const directory = entry.endsWith("/");
    const relative = directory ? entry.slice(0, -1) : entry;
    const name = relative.split("/").pop() ?? "";
    if (hooksRoot && (relative === hooksRoot || relative.startsWith(`${hooksRoot}/`))) hooks.push(relative);
    else if (directory) { if (linkNames.some((pattern) => nameMatches(pattern, name))) directories.push(relative); }
    else if (namePatterns.some((pattern) => nameMatches(pattern, name))) files.push(relative);
  }
  const paths = copyPatterns.filter((pattern) => pattern.includes("/")).map((pattern) => pattern.replace(/^\/+/, "")).filter((pattern) => !pattern.split("/").includes(".."));
  return { directories, files, paths, hooks };
}

/**
 * The packages an npm `package-lock.json` puts at the top of its `node_modules`,
 * with the version it pins. Optional packages are left out, since an install
 * may rightly skip them on this platform, and so are links. Undefined when the
 * content is not a lockfile with a `packages` map (npm 7 and later).
 */
export function lockedPackages(lockfile: unknown): { name: string; version: string }[] | undefined {
  if (!lockfile || typeof lockfile !== "object") return undefined;
  const packages = (lockfile as { packages?: unknown }).packages;
  if (!packages || typeof packages !== "object" || Array.isArray(packages)) return undefined;
  const locked: { name: string; version: string }[] = [];
  for (const [key, entry] of Object.entries(packages)) {
    if (!key.startsWith("node_modules/") || !entry || typeof entry !== "object") continue;
    const name = key.slice("node_modules/".length);
    if (!name || name.includes("/node_modules/")) continue;
    const { version, optional, devOptional, link } = entry as Record<string, unknown>;
    if (typeof version !== "string" || optional === true || devOptional === true || link === true) continue;
    locked.push({ name, version });
  }
  return locked;
}

/** The locked packages a dependency directory does not hold at their pinned version, `installed` undefined for a missing one. */
export function dependencyDrift(locked: { name: string; version: string }[], installed: (string | undefined)[]) {
  return locked.flatMap((entry, index) => installed[index] === entry.version ? [] : [{ ...entry, installed: installed[index] }]);
}

/** `core.hooksPath` as a path inside the repository, or undefined when it is absolute, empty or leaves the repository. */
export function relativeHooksPath(value: string) {
  const trimmed = value.trim().replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (!trimmed || trimmed === "." || path.isAbsolute(trimmed) || trimmed.startsWith("~") || trimmed.split("/").includes("..")) return undefined;
  return trimmed;
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
  run: Pick<RunState, "status" | "sessionActive" | "mergeRequestUrl" | "workflow" | "archiveSyncedAt"> & { issueUrl?: string },
  facts: WorktreeFacts,
): { allowed: boolean; automatic: boolean; reasons: string[]; risks: string[] } {
  const allowed = !runHoldsRepository(run);
  const risks = [...(facts.clean ? [] : ["uncommitted changes"]), ...(facts.pushed ? [] : ["unpushed changes"])];
  const reasons: string[] = [];
  if (!allowed) reasons.push("session still open");
  const draft = run.workflow?.result?.delivery === "draft_merge_request";
  const { delivery } = forgeWords(forgeOf(run.issueUrl));
  if (!run.mergeRequestUrl) reasons.push(`no ${delivery}`);
  else if (draft || run.workflow?.state === "blocked") reasons.push(`draft ${delivery} on a blocked run`);
  else if (run.status !== "completed") reasons.push("run not finished");
  if (run.mergeRequestUrl && !run.archiveSyncedAt) reasons.push("evidence archive not confirmed");
  reasons.push(...risks);
  return { allowed, automatic: facts.exists && reasons.length === 0, reasons, risks };
}

/** What the interface says of a worktree, in one line. */
export function worktreeKeptDetail(reasons: string[]) {
  return reasons.length > 0 ? `Worktree kept: ${reasons.join(", ")}` : "Worktree kept";
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
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    sessionActive: state.sessionActive,
    pendingQuestionCount: state.pendingQuestion?.questions.length ?? 0,
    ...defined({
      ticketTitle: state.ticketTitle, branch: state.branch, mergeRequestUrl: state.mergeRequestUrl, error: state.error, action: state.action,
      pendingQuestionId: state.pendingQuestion?.id, lastMessageId: lastMessage?.id, lastMessageAuthor: lastMessage?.author, evidenceUpdatedAt: state.evidenceUpdatedAt,
    }),
    ...(state.sessionPrompt ? { sessionPromptId: state.sessionPrompt.id } : {}),
    runningAgents: state.agents.filter((agent) => agent.status === "running").length,
    ...(state.acceptance?.available ? { acceptance: state.acceptance.counts } : {}),
    holdsRepository: runHoldsRepository(state),
    takesSlot: runTakesSlot(state),
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

/**
 * Whether a text can name a self-improvement worktree: letters, digits and
 * dashes. Anything else never reaches git, a path or a file name, by whichever
 * door it came in.
 */
export function isImprovementWorktreeName(name: unknown): name is string {
  return typeof name === "string" && /^[a-z0-9-]+$/i.test(name);
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
export function scheduleInput(repository: string, language: WorkflowLanguage, tickets: string[], known: KnownTicket[]) {
  return {
    repository,
    language,
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
 * `error` is a short phrase, shown to the user as the reason of the failure.
 */
export function validateSchedule(input: { tickets: string[]; known: string[] }, output: unknown): { ok: true; schedule: ScheduleOutput } | { ok: false; error: string } {
  const refuse = (error: string) => ({ ok: false as const, error });
  if (!output || typeof output !== "object" || Array.isArray(output)) return refuse("the output is not a JSON object");
  const { tickets, edges } = output as { tickets?: unknown; edges?: unknown };
  if (!Array.isArray(tickets) || !Array.isArray(edges)) return refuse("the tickets or edges array is missing");
  const expected = new Set(input.tickets);
  const known = new Set(input.known);
  const predictions: SchedulePrediction[] = [];
  for (const raw of tickets) {
    const ticket = (raw ?? {}) as Record<string, unknown>;
    const issueUrl = ticket.issue_url;
    if (typeof issueUrl !== "string" || !expected.has(issueUrl)) return refuse("a ticket of the output is not in the input");
    if (predictions.some((prediction) => prediction.issueUrl === issueUrl)) return refuse("a ticket appears twice");
    if (typeof ticket.confidence !== "string" || !CONFIDENCES.includes(ticket.confidence)) return refuse("a confidence is outside the expected values");
    if (typeof ticket.summary !== "string" || !ticket.summary.trim()) return refuse("a summary is empty");
    predictions.push({ issueUrl, areas: strings(ticket.areas), files: strings(ticket.files), confidence: ticket.confidence as ScheduleConfidence, summary: ticket.summary.trim() });
  }
  if (predictions.length !== expected.size) return refuse("a ticket of the input has no prediction");
  const pairs = new Set<string>();
  const links: ScheduleOutputEdge[] = [];
  for (const raw of edges) {
    const edge = (raw ?? {}) as Record<string, unknown>;
    const { a, b, kind, order, reason } = edge;
    if (typeof a !== "string" || typeof b !== "string" || ![a, b].every((url) => expected.has(url) || known.has(url))) return refuse("an edge names an unknown ticket");
    if (a === b) return refuse("an edge links a ticket to itself");
    if (!expected.has(a) && !expected.has(b)) return refuse("an edge links two tickets already known");
    if (typeof kind !== "string" || !EDGE_KINDS.includes(kind)) return refuse("an edge kind is outside the expected values");
    if (typeof reason !== "string" || !reason.trim()) return refuse("a reason is empty");
    const pair = [a, b].sort().join("\n");
    if (pairs.has(pair)) return refuse("two edges link the same pair of tickets");
    pairs.add(pair);
    if (kind === "depends_on") {
      const valid = Array.isArray(order) && order.length === 2 && ((order[0] === a && order[1] === b) || (order[0] === b && order[1] === a));
      if (!valid) return refuse("a dependency has no valid order");
      links.push({ a, b, kind, order: [order[0], order[1]], reason: reason.trim() });
    } else {
      if (order !== undefined) return refuse("an overlap carries an order");
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
/**
 * A branch name read from a file the console does not own, or `undefined`. It
 * reaches the session's environment and the workflow's git commands, so only
 * the plain shape of a git branch passes: no option, no range, no ref syntax.
 */
export function branchName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) || name.length > 200) return undefined;
  if (name.includes("..") || name.includes("//") || /[./]$/.test(name) || name.endsWith(".lock") || name.split("/").some((part) => part.startsWith("."))) return undefined;
  return name;
}

/** A project path read from a file the console does not own (`group/sub/project`, `owner/repo`), or `undefined`. */
export function projectPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const project = value.trim().replace(/^\/+|\/+$/g, "");
  return /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+$/.test(project) && !project.split("/").some((part) => part === "." || part === "..") ? project : undefined;
}

export function readProposalSnapshot(content: unknown): TicketProposal[] | undefined {
  if (!isRecord(content) || !Array.isArray(content.tickets)) return undefined;
  const proposals = new Map<string, TicketProposal>();
  for (const entry of content.tickets.filter(isRecord)) {
    const issueUrl = typeof entry.url === "string" ? normalizeTicketUrl(entry.url) : undefined;
    if (!issueUrl || proposals.has(ticketIdentity(issueUrl))) continue;
    const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
    const baseBranch = branchName(entry.baseBranch);
    const repositories = Array.isArray(entry.repositories) ? [...new Set(entry.repositories.map(projectPath).filter((project): project is string => Boolean(project)))] : [];
    proposals.set(ticketIdentity(issueUrl), {
      issueUrl, ...defined({ title: text(entry.title), source: text(entry.source) }), ...(baseBranch ? { baseBranch } : {}),
      ...(repositories.length > 0 ? { repositories } : {}),
    });
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
  if (own?.analysis === "failed") return { cause: "analysis_failed", detail: `The batch analysis failed${because(own)}: the tickets of this repository run one at a time.` };
  if (other?.analysis === "failed") return { cause: "analysis_failed", detail: `The analysis of ${ticketReference(other.issueUrl)} failed${because(other)}: this ticket runs after it.` };
  if (own?.confidence === "low") return { cause: "low_confidence", detail: `Unreliable prediction for this ticket: it runs alone on its repository.${own.summary ? ` ${own.summary}` : ""}` };
  if (other?.confidence === "low") return { cause: "low_confidence", detail: `Unreliable prediction for ${ticketReference(other.issueUrl)}: this ticket runs after it.${other.summary ? ` ${ticketReference(other.issueUrl)}: ${other.summary}` : ""}` };
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
      ...(own?.analysis === "failed" ? { analysisFailure: own.failure ?? "analysis failed" } : {}),
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

/** The branch a merge request (`target_branch`) or a pull request (`base.ref`) merges into, as its forge answered. */
export function deliveryTargetBranch(forge: Forge, response: unknown): string | undefined {
  const answer = response as { target_branch?: unknown; base?: { ref?: unknown } } | null | undefined;
  const branch = forge === "github" ? answer?.base?.ref : answer?.target_branch;
  return typeof branch === "string" && branch.trim() ? branch.trim() : undefined;
}

/**
 * The refs a run's diff may be measured from, best first. The branch its merge
 * request targets comes first: the pilot cuts the work from the base it chose,
 * which is not the commit the checkout stood at when the run was launched.
 */
export function diffBases(state: Pick<RunState, "baseBranch" | "ticketBaseBranch" | "baseCommit">, targetBranch?: string): string[] {
  const bases = [...(targetBranch ? [`origin/${targetBranch}`, targetBranch] : []), state.baseBranch, state.ticketBaseBranch, state.baseCommit];
  return bases.filter((base): base is string => Boolean(base));
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
export const INTERRUPTED_ANALYSIS = "console restarted during the analysis";

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
