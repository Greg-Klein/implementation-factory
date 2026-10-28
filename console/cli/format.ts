import type { Language } from "../lib/i18n";
import { texts } from "../lib/i18n/texts";
import { formatDuration, formatShare, formatTokens } from "../lib/metrics";
import { acceptanceChip, confidenceChip, confidenceReasonLine, elapsedLabel, generatedDocuments, healthBadge, incidentActions, mergeRequestLabel, pendingDecisions, phaseNames, proposalLabel, queueStatus, runLabel, runStatusBadge, sourceRepository, statusLabel, worktreeLabel } from "../lib/run-state";
import type { AcceptanceView, Activity, ConfidenceCalibration, ConversationMessage, FactorySnapshot, IncidentAction, PendingQuestion, QueuedRunView, RunMetrics, RunState, RunSummary, SessionPrompt } from "../server/types.js";
import { shortId } from "./select";

/** Rows as aligned columns, two spaces apart. The last column is left as long as it is. */
export function table(rows: string[][]) {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, index) => { widths[index] = Math.max(widths[index] ?? 0, cell.length); });
  return rows.map((row) => row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0))).join("  ").trimEnd()).join("\n");
}

function clock(at: string) {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "--:--:--" : date.toTimeString().slice(0, 8);
}

function phaseLabel(run: { phase: number; issueUrl: string }, language: Language) {
  const names = phaseNames(run.issueUrl, language);
  const name = names[run.phase - 1];
  return name ? `${run.phase}/${names.length} ${name}` : "-";
}

/** What a row says of a run beyond its status: a decision waiting, an incident, a doubt. */
function runStatus(run: RunSummary, language: Language) {
  const text = texts(language).cli;
  const status = statusLabel(run.status, language);
  const decisions = pendingDecisions(run);
  if (decisions) return `${status} (${text.decisionCount(decisions)})`;
  const badge = healthBadge(run, language);
  if (badge) return `${status} (${badge.label})`;
  if (run.sessionActive && (run.status === "completed" || run.status === "stopped" || run.status === "failed")) return `${status}, ${text.sessionOpen}`;
  return status;
}

function runRow(run: RunSummary, now: number, language: Language) {
  return [
    shortId(run.id),
    runLabel(run),
    runStatus(run, language),
    phaseLabel(run, language),
    run.startedAt ? elapsedLabel(run.startedAt, run.endedAt ?? undefined, now) : "-",
    run.tokens ? formatTokens(run.tokens, language) : "-",
    [acceptanceChip(run.acceptance, language)?.label, run.mergeRequestUrl ? mergeRequestLabel(run.mergeRequestUrl) : undefined].filter(Boolean).join(" ") || "-",
  ];
}

const runHeader = (language: Language) => Array.from({ length: 7 }, (_, index) => texts(language).cli.runHeader(index));

export function renderQueue(queued: QueuedRunView[], language: Language) {
  const text = texts(language).cli;
  if (queued.length === 0) return text.queueEmpty;
  return table([[0, 1, 2].map((index) => text.queueHeader(index)), ...queued.map((entry) => [shortId(entry.id), runLabel(entry), queueStatus(entry, language)])]);
}

/** Everything the side list of the interface shows: runs, queue, runs read back from their archive, watcher tickets not queued. */
export function renderFactory(snapshot: FactorySnapshot, now: number) {
  const language = snapshot.language;
  const text = texts(language).cli;
  const taken = snapshot.runs.filter((run) => run.takesSlot).length;
  const sections = [text.slotsTaken(taken, snapshot.maxConcurrentRuns)];
  sections.push(snapshot.runs.length > 0 ? table([runHeader(language), ...snapshot.runs.map((run) => runRow(run, now, language))]) : text.noRunListed);
  if (snapshot.queued.length > 0) sections.push("", text.queueTitle, renderQueue(snapshot.queued, language));
  if (snapshot.archived.length > 0) sections.push("", text.archivedTitle, table([runHeader(language), ...snapshot.archived.map((run) => runRow(run, now, language))]));
  if (snapshot.proposals.length > 0) sections.push("", text.proposalsTitle, renderProposals(snapshot, language));
  return sections.join("\n");
}

export function renderProposals(snapshot: Pick<FactorySnapshot, "proposals">, language: Language) {
  if (snapshot.proposals.length === 0) return texts(language).cli.noProposals;
  return table(snapshot.proposals.map((proposal) => [proposalLabel(proposal.issueUrl), proposal.title ?? "", proposal.refusal ?? "", proposal.issueUrl]));
}

/** A decision the workflow waits on, with the rank each choice is picked by. */
export function renderQuestion(pending: PendingQuestion, language: Language) {
  return pending.questions.map((question, index) => {
    const lines = [`${pending.questions.length > 1 ? `${index + 1}. ` : ""}[${question.header}] ${question.question}${question.multiSelect ? texts(language).cli.severalAllowed : ""}`];
    question.options.forEach((option, rank) => lines.push(`     ${rank + 1}) ${option.label}${option.description ? `: ${option.description}` : ""}`));
    return lines.join("\n");
  }).join("\n");
}

export function renderSessionPrompt(prompt: SessionPrompt, language: Language) {
  return texts(language).cli.trustPrompt(prompt.directory);
}

const ACTION_WORDS: Partial<Record<IncidentAction, string>> = { request_continuation: "continue", stop: "stop", dismiss: "dismiss" };

/** The words `impl incident` takes for the actions an incident offers now. */
export function incidentWords(run: Pick<RunState, "id" | "status" | "sessionActive" | "archived" | "pendingQuestion" | "incidents">) {
  const incident = run.incidents?.findLast((entry) => entry.status === "open");
  return incident ? incidentActions(run, incident).flatMap((action) => ACTION_WORDS[action] ?? []) : [];
}

/** One run in full, as the run view of the interface reads it. `program`: the name the commands suggested here are typed under. */
export function renderRun(run: RunState, now: number, program: string, language: Language) {
  const text = texts(language).cli;
  const reference = shortId(run.id ?? "");
  const lines: [string, string | undefined][] = [
    [text.labelRun, `${runLabel(run)} (${run.id})`],
    [text.labelTicket, run.ticketTitle ? `${run.ticketTitle}\n${run.issueUrl}` : run.issueUrl],
    [text.labelStatus, `${runStatusBadge(run, language).label}${run.sessionActive ? `, ${text.sessionOpen}` : ""}${run.archived ? `, ${text.readFromArchive}` : ""}`],
    [text.labelStep, phaseLabel(run, language)],
    [text.labelDoing, run.action],
    [text.labelTime, run.startedAt ? elapsedLabel(run.startedAt, run.endedAt ?? undefined, now) : undefined],
    [text.labelTokens, run.usage ? text.tokensSplit(formatTokens(run.usage.total, language), formatTokens(run.usage.pilot, language), formatTokens(run.usage.agents, language)) : undefined],
    [text.labelRepository, sourceRepository(run)],
    [text.labelWorktree, worktreeLabel(run, language)],
    [text.labelBranch, run.branch],
    [text.labelDelivery, run.mergeRequestUrl],
    [text.labelCriteria, run.acceptance?.available ? acceptanceChip(run.acceptance.counts, language)?.title : undefined],
    [text.labelConfidence, run.confidence ? [`${confidenceChip(run.confidence.score, language)!.label}`, ...run.confidence.reasons.map((reason) => confidenceReasonLine(reason, language))].join("\n") : undefined],
    [text.labelError, run.error],
  ];
  const width = Math.max(...lines.map(([label]) => label.length));
  const sections = [lines.filter(([, value]) => value).map(([label, value]) => `${label.padEnd(width)}  ${value!.split("\n").join(`\n${" ".repeat(width + 2)}`)}`).join("\n")];

  const agents = run.agents.filter((agent) => agent.status === "running");
  if (agents.length > 0) sections.push(`${text.agentsAtWork}\n${table(agents.map((agent) => [`  ${agent.nickname ?? agent.id}`, agent.role ?? agent.name, elapsedLabel(agent.startedAt, undefined, now)]))}`);
  if (run.planTasks?.length) sections.push(`${text.planTitle}\n${table(run.planTasks.map((task) => [`  ${task.id}`, task.status.replace("_", " "), task.complexity ?? "", task.assignee?.nickname ?? "", task.title]))}`);

  const incident = run.incidents?.findLast((entry) => entry.status === "open");
  if (incident) {
    const words = incidentWords(run);
    sections.push(`${text.incidentTitle(incident.title)}\n  ${incident.reason}${words.length > 0 ? `\n  ${text.actOnIt(`${program} incident ${reference} ${words.join("|")}`)}` : ""}`);
  } else if (run.health?.title && run.health.health !== "healthy") sections.push(`${run.health.title}${run.health.detail ? `\n  ${run.health.detail}` : ""}`);
  if (run.sessionPrompt) sections.push(`${text.decisionRequired}\n  ${renderSessionPrompt(run.sessionPrompt, language)}\n  ${text.answerWith(`${program} trust ${reference} accept|refuse`)}`);
  if (run.pendingQuestion) sections.push(`${text.decisionRequired}\n${renderQuestion(run.pendingQuestion, language).split("\n").map((line) => `  ${line}`).join("\n")}\n  ${text.answerWith(`${program} answer ${reference}`)}`);

  const documents = generatedDocuments(run.artifacts);
  if (documents.length > 0) sections.push(text.documentsLine(documents.length, `${program} docs ${reference}`));
  return sections.join("\n\n");
}

export function activityLine(activity: Activity, language: Language) {
  return `${clock(activity.at)}  ${activity.kind === "attention" ? "! " : ""}${activity.title}${activity.detail ? `${texts(language).cli.colon}${activity.detail}` : ""}`;
}

export function messageLine(message: ConversationMessage, language: Language) {
  const text = texts(language).cli;
  const author = message.author === "claude" ? text.authorClaude : text.authorYou;
  return `${clock(message.at)}  ${text.authorLine(author)}\n${message.text.trim().split("\n").map((line) => `          ${line}`).join("\n")}`;
}

/** The "Evidence" tab: the coverage sentence, the QA verdict, each criterion with its status and why. */
export function renderEvidence(view: AcceptanceView, confidence: number | undefined, language: Language) {
  const text = texts(language).cli;
  const note = confidenceChip(confidence, language);
  if (!view.available) return [...(note ? [text.reviewConfidence(note.label)] : []), text.noCriteria].join("\n");
  const lines = [...(note ? [text.reviewConfidence(note.label)] : []), view.sentence];
  if (view.qa) lines.push(`${text.qaVerdict(view.qa.status)}${view.qa.warning ? `\n  ${view.qa.warning}` : ""}`);
  lines.push("");
  for (const criterion of view.criteria) {
    lines.push(`${criterion.id}  ${criterion.status.padEnd(10)}  ${criterion.text}`);
    for (const reason of criterion.reasons) lines.push(`      ${reason}`);
  }
  if (view.diagnostics.length > 0) lines.push("", text.anomalies, ...view.diagnostics.map((diagnostic) => text.diagnosticLine(diagnostic.level, diagnostic.message, diagnostic.file ? ` (${diagnostic.file})` : "")));
  return lines.join("\n");
}

/** One row per measured run, as the metrics table of the interface. */
export function renderMetrics(runs: RunMetrics[], language: Language) {
  const text = texts(language).cli;
  if (runs.length === 0) return text.noMeasuredRun;
  return table([
    Array.from({ length: 10 }, (_, index) => text.metricsHeader(index)),
    ...runs.map((metrics) => [
      runLabel({ cwd: metrics.ticket.repository, issueUrl: metrics.ticket.issueUrl }),
      statusLabel(metrics.outcome.status, language),
      formatDuration(metrics.time.activeMs),
      formatDuration(metrics.time.userWaitMs),
      metrics.tokens ? formatTokens(metrics.tokens.total.total, language) : "-",
      metrics.tokens ? formatShare(metrics.tokens.pilotShare) : "-",
      metrics.complexity.diff ? text.diffFiles(metrics.complexity.diff.files, metrics.complexity.diff.insertions, metrics.complexity.diff.deletions) : "-",
      metrics.complexity.reviewTier === undefined ? "-" : String(metrics.complexity.reviewTier),
      confidenceChip(metrics.outcome.confidenceAtDelivery ?? metrics.outcome.confidence, language)?.label ?? "-",
      metrics.outcome.mergeRequestUrl ? mergeRequestLabel(metrics.outcome.mergeRequestUrl) : metrics.outcome.delivery === "none" ? text.deliveryNone : "-",
    ]),
  ]);
}

/** What happened after delivery to the runs of each note: the figures that say whether the note means anything. */
export function renderCalibration(calibration: ConfidenceCalibration, language: Language) {
  if (calibration.length === 0) return "";
  return table([
    [0, 1, 2, 3].map((index) => texts(language).cli.calibrationHeader(index)),
    ...calibration.map((row) => [confidenceChip(row.score, language)!.label, String(row.runs), String(row.reopened), String(row.feedback)]),
  ]);
}
