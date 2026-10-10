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

function phaseLabel(run: { phase: number; issueUrl: string }) {
  const names = phaseNames(run.issueUrl);
  const name = names[run.phase - 1];
  return name ? `${run.phase}/${names.length} ${name}` : "-";
}

/** What a row says of a run beyond its status: a decision waiting, an incident, a doubt. */
function runStatus(run: RunSummary) {
  const decisions = pendingDecisions(run);
  if (decisions) return `${statusLabel(run.status)} (${decisions} decision${decisions === 1 ? "" : "s"})`;
  const badge = healthBadge(run);
  if (badge) return `${statusLabel(run.status)} (${badge.label})`;
  if (run.sessionActive && (run.status === "completed" || run.status === "stopped" || run.status === "failed")) return `${statusLabel(run.status)}, session open`;
  return statusLabel(run.status);
}

function runRow(run: RunSummary, now: number) {
  return [
    shortId(run.id),
    runLabel(run),
    runStatus(run),
    phaseLabel(run),
    run.startedAt ? elapsedLabel(run.startedAt, run.endedAt ?? undefined, now) : "-",
    run.tokens ? formatTokens(run.tokens) : "-",
    [acceptanceChip(run.acceptance)?.label, run.mergeRequestUrl ? mergeRequestLabel(run.mergeRequestUrl) : undefined].filter(Boolean).join(" ") || "-",
  ];
}

const RUN_HEADER = ["ID", "RUN", "STATUS", "STEP", "TIME", "TOKENS", "DELIVERY"];

export function renderQueue(queued: QueuedRunView[]) {
  if (queued.length === 0) return "Nothing queued.";
  return table([["ID", "TICKET", "WAITS"], ...queued.map((entry) => [shortId(entry.id), runLabel(entry), queueStatus(entry)])]);
}

/** Everything the side list of the interface shows: runs, queue, runs read back from their archive, watcher tickets not queued. */
export function renderFactory(snapshot: FactorySnapshot, now: number) {
  const taken = snapshot.runs.filter((run) => run.takesSlot).length;
  const sections = [`Runs (${taken}/${snapshot.maxConcurrentRuns} slots taken)`];
  sections.push(snapshot.runs.length > 0 ? table([RUN_HEADER, ...snapshot.runs.map((run) => runRow(run, now))]) : "No run.");
  if (snapshot.queued.length > 0) sections.push("", "Queue", renderQueue(snapshot.queued));
  if (snapshot.archived.length > 0) sections.push("", "Kept worktrees and interrupted runs", table([RUN_HEADER, ...snapshot.archived.map((run) => runRow(run, now))]));
  if (snapshot.proposals.length > 0) sections.push("", "Tickets from the watcher, not queued", renderProposals(snapshot));
  return sections.join("\n");
}

export function renderProposals(snapshot: Pick<FactorySnapshot, "proposals">) {
  if (snapshot.proposals.length === 0) return "No ticket waits for a decision.";
  return table(snapshot.proposals.map((proposal) => [proposalLabel(proposal.issueUrl), proposal.title ?? "", proposal.refusal ?? "", proposal.issueUrl]));
}

/** A decision the workflow waits on, with the rank each choice is picked by. */
export function renderQuestion(pending: PendingQuestion) {
  return pending.questions.map((question, index) => {
    const lines = [`${pending.questions.length > 1 ? `${index + 1}. ` : ""}[${question.header}] ${question.question}${question.multiSelect ? " (several choices allowed)" : ""}`];
    question.options.forEach((option, rank) => lines.push(`     ${rank + 1}) ${option.label}${option.description ? `: ${option.description}` : ""}`));
    return lines.join("\n");
  }).join("\n");
}

export function renderSessionPrompt(prompt: SessionPrompt) {
  return `Claude Code asks whether it may trust the directory ${prompt.directory}.`;
}

const ACTION_WORDS: Partial<Record<IncidentAction, string>> = { request_continuation: "continue", stop: "stop", dismiss: "dismiss" };

/** The words `impl incident` takes for the actions an incident offers now. */
export function incidentWords(run: Pick<RunState, "id" | "status" | "sessionActive" | "archived" | "pendingQuestion" | "incidents">) {
  const incident = run.incidents?.findLast((entry) => entry.status === "open");
  return incident ? incidentActions(run, incident).flatMap((action) => ACTION_WORDS[action] ?? []) : [];
}

/** One run in full, as the run view of the interface reads it. `program`: the name the commands suggested here are typed under. */
export function renderRun(run: RunState, now: number, program: string) {
  const reference = shortId(run.id ?? "");
  const lines: [string, string | undefined][] = [
    ["Run", `${runLabel(run)} (${run.id})`],
    ["Ticket", run.ticketTitle ? `${run.ticketTitle}\n${run.issueUrl}` : run.issueUrl],
    ["Status", `${runStatusBadge(run).label}${run.sessionActive ? ", session open" : ""}${run.archived ? ", read from its archive" : ""}`],
    ["Step", phaseLabel(run)],
    ["Doing", run.action],
    ["Time", run.startedAt ? elapsedLabel(run.startedAt, run.endedAt ?? undefined, now) : undefined],
    ["Tokens", run.usage ? `${formatTokens(run.usage.total)} (pilot ${formatTokens(run.usage.pilot)}, agents ${formatTokens(run.usage.agents)})` : undefined],
    ["Repository", sourceRepository(run)],
    ["Worktree", worktreeLabel(run)],
    ["Branch", run.branch],
    ["Delivery", run.mergeRequestUrl],
    ["Criteria", run.acceptance?.available ? acceptanceChip(run.acceptance.counts)?.title : undefined],
    ["Confidence", run.confidence ? [`${confidenceChip(run.confidence.score)!.label}`, ...run.confidence.reasons.map(confidenceReasonLine)].join("\n") : undefined],
    ["Error", run.error],
  ];
  const width = Math.max(...lines.map(([label]) => label.length));
  const sections = [lines.filter(([, value]) => value).map(([label, value]) => `${label.padEnd(width)}  ${value!.split("\n").join(`\n${" ".repeat(width + 2)}`)}`).join("\n")];

  const agents = run.agents.filter((agent) => agent.status === "running");
  if (agents.length > 0) sections.push(`Agents at work\n${table(agents.map((agent) => [`  ${agent.nickname ?? agent.id}`, agent.role ?? agent.name, elapsedLabel(agent.startedAt, undefined, now)]))}`);
  if (run.planTasks?.length) sections.push(`Plan\n${table(run.planTasks.map((task) => [`  ${task.id}`, task.status.replace("_", " "), task.complexity ?? "", task.assignee?.nickname ?? "", task.title]))}`);

  const incident = run.incidents?.findLast((entry) => entry.status === "open");
  if (incident) {
    const words = incidentWords(run);
    sections.push(`Incident: ${incident.title}\n  ${incident.reason}${words.length > 0 ? `\n  Act on it: ${program} incident ${reference} ${words.join("|")}` : ""}`);
  } else if (run.health?.title && run.health.health !== "healthy") sections.push(`${run.health.title}${run.health.detail ? `\n  ${run.health.detail}` : ""}`);
  if (run.sessionPrompt) sections.push(`Decision required\n  ${renderSessionPrompt(run.sessionPrompt)}\n  Answer: ${program} trust ${reference} accept|refuse`);
  if (run.pendingQuestion) sections.push(`Decision required\n${renderQuestion(run.pendingQuestion).split("\n").map((line) => `  ${line}`).join("\n")}\n  Answer: ${program} answer ${reference}`);

  const documents = generatedDocuments(run.artifacts);
  if (documents.length > 0) sections.push(`Documents: ${documents.length} (${program} docs ${reference})`);
  return sections.join("\n\n");
}

export function activityLine(activity: Activity) {
  return `${clock(activity.at)}  ${activity.kind === "attention" ? "! " : ""}${activity.title}${activity.detail ? `: ${activity.detail}` : ""}`;
}

export function messageLine(message: ConversationMessage) {
  const author = message.author === "claude" ? "Claude" : "You";
  return `${clock(message.at)}  ${author}:\n${message.text.trim().split("\n").map((line) => `          ${line}`).join("\n")}`;
}

/** The "Evidence" tab: the coverage sentence, the QA verdict, each criterion with its status and why. */
export function renderEvidence(view: AcceptanceView, confidence?: number) {
  const note = confidenceChip(confidence);
  if (!view.available) return [...(note ? [`Review confidence: ${note.label}`] : []), "This run wrote no acceptance criteria."].join("\n");
  const lines = [...(note ? [`Review confidence: ${note.label}`] : []), view.sentence];
  if (view.qa) lines.push(`QA verdict: ${view.qa.status}${view.qa.warning ? `\n  ${view.qa.warning}` : ""}`);
  lines.push("");
  for (const criterion of view.criteria) {
    lines.push(`${criterion.id}  ${criterion.status.padEnd(10)}  ${criterion.text}`);
    for (const reason of criterion.reasons) lines.push(`      ${reason}`);
  }
  if (view.diagnostics.length > 0) lines.push("", "Anomalies", ...view.diagnostics.map((diagnostic) => `  ${diagnostic.level}: ${diagnostic.message}${diagnostic.file ? ` (${diagnostic.file})` : ""}`));
  return lines.join("\n");
}

/** One row per measured run, as the metrics table of the interface. */
export function renderMetrics(runs: RunMetrics[]) {
  if (runs.length === 0) return "No measured run.";
  return table([
    ["RUN", "STATUS", "ACTIVE", "WAITED", "TOKENS", "PILOT", "DIFF", "TIER", "CONF", "DELIVERY"],
    ...runs.map((metrics) => [
      runLabel({ cwd: metrics.ticket.repository, issueUrl: metrics.ticket.issueUrl }),
      statusLabel(metrics.outcome.status),
      formatDuration(metrics.time.activeMs),
      formatDuration(metrics.time.userWaitMs),
      metrics.tokens ? formatTokens(metrics.tokens.total.total) : "-",
      metrics.tokens ? formatShare(metrics.tokens.pilotShare) : "-",
      metrics.complexity.diff ? `${metrics.complexity.diff.files} files +${metrics.complexity.diff.insertions} -${metrics.complexity.diff.deletions}` : "-",
      metrics.complexity.reviewTier === undefined ? "-" : String(metrics.complexity.reviewTier),
      confidenceChip(metrics.outcome.confidenceAtDelivery ?? metrics.outcome.confidence)?.label ?? "-",
      metrics.outcome.mergeRequestUrl ? mergeRequestLabel(metrics.outcome.mergeRequestUrl) : metrics.outcome.delivery === "none" ? "none" : "-",
    ]),
  ]);
}

/** What happened after delivery to the runs of each note: the figures that say whether the note means anything. */
export function renderCalibration(calibration: ConfidenceCalibration) {
  if (calibration.length === 0) return "";
  return table([
    ["CONFIDENCE", "RUNS", "REOPENED", "FEEDBACK"],
    ...calibration.map((row) => [confidenceChip(row.score)!.label, String(row.runs), String(row.reopened), String(row.feedback)]),
  ]);
}
