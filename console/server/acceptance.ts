import { createHash } from "node:crypto";
import path from "node:path";
import type {
  AcceptanceCheckView, AcceptanceCounts, AcceptanceCriterionView, AcceptanceDiagnostic, AcceptanceQaView, AcceptanceReportVersion, AcceptanceStatus, AcceptanceView,
  EvidenceAttachmentView, EvidenceBasis, EvidenceFreshness, EvidenceMethod, EvidenceSource, EvidenceView,
} from "./types.js";
import { acceptanceText, type WorkflowLanguage } from "./acceptance-text.js";

export { acceptanceText, workflowLanguageOf, type WorkflowLanguage } from "./acceptance-text.js";

/**
 * Acceptance coverage: which criteria of the ticket were verified, on which
 * code, by whom, and with what. Pure: the files arrive as parsed JSON, the code
 * version as an identifier, the clock as a string. Everything the "Evidence"
 * tab and the merge request summary say comes out of deriveAcceptanceCoverage,
 * so the two can never tell different stories.
 *
 * The rules are deliberately conservative. A criterion is green only when every
 * check it requires has a positive result taken on the code as it stands, with
 * no failure left standing next to it. Missing, stale, unversioned or merely
 * implied evidence leaves it unverified; a build passing or a task marked done
 * on the board proves nothing about it.
 */

export const MAX_REPORT_BYTES = 1_000_000;
const MAX_ITEMS = 500;
const MAX_CRITERIA = 200;
const MAX_CHECKS = 50;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const VERDICTS = new Set(["pass", "fail", "not_run", "measured", "confirmed", "unverified"]);
const METHODS = new Set<EvidenceMethod>(["test", "browser", "static_analysis", "manual"]);
const BASES = new Set<EvidenceBasis>(["observed", "reported", "confirmation"]);
const ROUND_COPY = /-round\d+\.json$/;

export function isRoundCopy(file: string) {
  return ROUND_COPY.test(file);
}

type Diagnostics = AcceptanceDiagnostic[];

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown, limit = 2_000): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim().slice(0, limit) || undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function identifiers(value: unknown): string[] {
  const list = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  return [...new Set(list.flatMap((entry) => (typeof entry === "string" && IDENTIFIER.test(entry.trim()) ? [entry.trim()] : [])))];
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

// --- Criteria registry ------------------------------------------------------

export type CriterionCheck = { id: string; description: string; method?: EvidenceMethod };
export type Criterion = {
  id: string;
  text: string;
  source?: { kind: string; reference?: string; excerpt?: string };
  expected?: string;
  checks: CriterionCheck[];
  /** Only a deployed environment can show it: QA records it as blocked, and PASS_WITH_WARNINGS over it is consistent. */
  afterDeployment?: true;
  /** The registry revision in which this criterion last changed meaning; evidence read against an older one no longer counts. */
  revision: number;
};
export type CriteriaRegistry = { revision: number; criteria: Criterion[] };

/**
 * `acceptance-criteria.json`, read as untrusted input. A malformed entry is
 * reported and dropped, never allowed to take the rest of the registry with it.
 */
export function parseCriteriaRegistry(value: unknown, file = "acceptance-criteria.json"): { registry?: CriteriaRegistry; diagnostics: Diagnostics } {
  const diagnostics: Diagnostics = [];
  const root = record(value);
  if (!root || !Array.isArray(root.criteria)) {
    diagnostics.push({ level: "error", file, message: "Criteria registry unreadable: the `criteria` list is missing." });
    return { diagnostics };
  }
  if (root.schemaVersion !== 1) diagnostics.push({ level: "warning", file, message: `Unexpected schema version (${String(root.schemaVersion)}), read as version 1.` });
  const revision = positiveInteger(root.revision) ?? 1;
  const criteria: Criterion[] = [];
  const seenCriteria = new Set<string>();
  const seenChecks = new Set<string>();
  if (root.criteria.length > MAX_CRITERIA) diagnostics.push({ level: "warning", file, message: `More than ${MAX_CRITERIA} criteria: the following ones are ignored.` });
  for (const entry of root.criteria.slice(0, MAX_CRITERIA)) {
    const input = record(entry);
    const id = typeof input?.id === "string" ? input.id.trim() : "";
    const statement = text(input?.text);
    if (!input || !IDENTIFIER.test(id) || !statement) {
      diagnostics.push({ level: "error", file, message: `Criterion ignored: identifier or text missing (${id || "no identifier"}).` });
      continue;
    }
    if (seenCriteria.has(id)) {
      diagnostics.push({ level: "error", file, message: `Duplicate criterion identifier: ${id}. Only the first occurrence is kept.` });
      continue;
    }
    seenCriteria.add(id);
    const source = record(input.source);
    const verification = record(input.verification);
    const checks: CriterionCheck[] = [];
    // Checks written straight on the criterion are still the checks producers cite: dropping them
    // would report every evidence item citing one as unknown, blaming files that did nothing wrong.
    const misplaced = !Array.isArray(verification?.requiredChecks) && Array.isArray(input.checks);
    if (misplaced) diagnostics.push({ level: "warning", file, message: `Checks of ${id} read under \`checks\` instead of \`verification.requiredChecks\`.` });
    const requested = Array.isArray(verification?.requiredChecks) ? verification.requiredChecks : misplaced ? input.checks as unknown[] : [];
    for (const candidate of requested.slice(0, MAX_CHECKS)) {
      const check = record(candidate);
      const checkId = typeof check?.id === "string" ? check.id.trim() : "";
      if (!check || !IDENTIFIER.test(checkId)) { diagnostics.push({ level: "error", file, message: `Check without a valid identifier ignored in ${id}.` }); continue; }
      if (seenChecks.has(checkId) || seenCriteria.has(checkId) && checkId !== id) { diagnostics.push({ level: "error", file, message: `Duplicate check identifier: ${checkId}.` }); continue; }
      seenChecks.add(checkId);
      const method = METHODS.has(check.method as EvidenceMethod) ? check.method as EvidenceMethod : undefined;
      checks.push({ id: checkId, description: text(check.description) ?? checkId, ...(method ? { method } : {}) });
    }
    // A criterion that names no check is its own single check: the evidence
    // that cites it is what verifies it.
    if (checks.length === 0) checks.push({ id, description: statement });
    const kind = text(source?.kind, 40);
    criteria.push({
      id, text: statement,
      ...(kind ? { source: { kind, ...(text(source?.reference) ? { reference: text(source?.reference) } : {}), ...(text(source?.excerpt) ? { excerpt: text(source?.excerpt) } : {}) } } : {}),
      ...(text(verification?.expected) ? { expected: text(verification?.expected) } : {}),
      checks,
      ...(verification?.afterDeployment === true ? { afterDeployment: true as const } : {}),
      revision: Math.min(positiveInteger(input.revision) ?? 1, revision),
    });
  }
  return { registry: { revision, criteria }, diagnostics };
}

// --- Plan -------------------------------------------------------------------

export type PlanLinks = { criteriaRevision?: number; tasks: { id: string; title: string; criterionIds: string[]; dependencies: string[] }[]; legacyCriteria: string[] };

/** The parts of `planner-output.json` coverage needs. Additive over the historical format, which had no identifiers. */
export function parsePlanLinks(value: unknown): PlanLinks | undefined {
  const root = record(value);
  if (!root || !Array.isArray(root.tasks)) return undefined;
  const tasks = root.tasks.flatMap((entry) => {
    const task = record(entry);
    const id = typeof task?.id === "string" ? task.id.trim() : "";
    if (!task || !id) return [];
    return [{
      id,
      title: text(task.title, 180) ?? id,
      criterionIds: identifiers(task.criterion_ids ?? task.criterionIds),
      dependencies: identifiers(task.dependencies),
    }];
  });
  const legacyCriteria = Array.isArray(root.acceptance_criteria) ? root.acceptance_criteria.flatMap((entry) => (text(entry) ? [text(entry)!] : [])) : [];
  const criteriaRevision = positiveInteger(root.criteria_revision ?? root.criteriaRevision);
  return { ...(criteriaRevision ? { criteriaRevision } : {}), tasks, legacyCriteria };
}

// --- Evidence reports -------------------------------------------------------

/** One item of one archived version of one evidence report, normalised. */
export type EvidenceRecord = {
  /** Same observation seen twice (a per-task file and the merged one, a round copy) has the same identity and counts once. */
  identity: string;
  /** The identity without the code version, for a copy that lost the root `codeSnapshot` its item relied on. */
  unversionedIdentity?: string;
  view: EvidenceView;
  criteriaRevision?: number;
  snapshotAtStart?: string;
  snapshotAtEnd?: string;
};

export type ReportContext = { file: string; version: number; receivedAt: string; hash: string };

export function sourceOfReport(file: string, declared?: unknown): EvidenceSource | undefined {
  if (declared === "qa" || declared === "design" || declared === "developer") return declared;
  const name = path.basename(file);
  if (name.startsWith("qa-evidence")) return "qa";
  if (name.startsWith("design-evidence")) return "design";
  if (name.startsWith("dev-evidence")) return "developer";
  return undefined;
}

function snapshotReference(value: unknown) {
  if (typeof value === "string") return text(value, 80);
  return text(record(value)?.id, 80);
}

export function attachmentPaths(item: Record<string, unknown>) {
  const listed = Array.isArray(item.attachments) ? item.attachments : [];
  const paths = [item.screenshot, ...listed.map((entry) => (typeof entry === "string" ? entry : record(entry)?.path))];
  return [...new Set(paths.flatMap((entry) => (typeof entry === "string" && entry.trim() ? [entry.trim()] : [])))];
}

function blockerOf(value: unknown) {
  if (typeof value === "string" && value.trim()) return { reason: value.trim().slice(0, 500) };
  const blocker = record(value);
  const reason = text(blocker?.reason, 500);
  return reason ? { reason, ...(text(blocker?.action, 500) ? { action: text(blocker?.action, 500) } : {}) } : undefined;
}

export type ParsedReport = {
  source: EvidenceSource; status?: string; round?: number;
  /** The criteria a focused QA pass was asked to cover. Absent when the report covers them all. */
  mandate?: string[];
  records: EvidenceRecord[]; diagnostics: Diagnostics;
};

/**
 * One evidence report, version 1 (the historical shape: labels and verdicts
 * only) or version 2 (identifiers, links, provenance, code version).
 * `attachmentPath` maps what the producer named to the archived copy, when one exists.
 */
export function parseEvidenceReport(value: unknown, context: ReportContext, attachmentPath: (source: string) => string | undefined = () => undefined): ParsedReport | { diagnostics: Diagnostics } {
  const diagnostics: Diagnostics = [];
  const root = record(value);
  const source = sourceOfReport(context.file, root?.source);
  if (!root || !source || !Array.isArray(root.items)) {
    diagnostics.push({ level: "error", file: context.file, message: "Evidence report unreadable: `source` or `items` missing." });
    return { diagnostics };
  }
  const schemaVersion = root.schemaVersion === undefined ? 1 : root.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2) diagnostics.push({ level: "warning", file: context.file, message: `Unknown schema version (${String(schemaVersion)}), read as version 2.` });
  const round = positiveInteger(root.round);
  const producer = record(root.producer);
  const reportSnapshot = record(root.codeSnapshot);
  const reportStart = snapshotReference(reportSnapshot?.atStart) ?? snapshotReference(root.codeSnapshotId);
  const reportEnd = snapshotReference(reportSnapshot?.atEnd);
  const criteriaRevision = positiveInteger(root.criteriaRevision);
  if (root.items.length > MAX_ITEMS) diagnostics.push({ level: "warning", file: context.file, message: `More than ${MAX_ITEMS} items: the following ones are ignored.` });
  const seenIds = new Map<string, number>();
  const records: EvidenceRecord[] = [];
  let futureDates = 0;
  root.items.slice(0, MAX_ITEMS).forEach((entry, index) => {
    const item = record(entry);
    if (!item) { diagnostics.push({ level: "error", file: context.file, message: `Item ${index + 1} ignored: it is not an object.` }); return; }
    const label = text(item.label, 500) ?? text(item.id, 64);
    if (!label) { diagnostics.push({ level: "error", file: context.file, message: `Item ${index + 1} ignored: no label.` }); return; }
    let verdict = typeof item.verdict === "string" ? item.verdict.trim() : "";
    if (!VERDICTS.has(verdict)) {
      diagnostics.push({ level: "error", file: context.file, message: `Unknown verdict "${verdict || "empty"}" for "${label}", read as unverified.` });
      verdict = "unverified";
    }
    const id = typeof item.id === "string" && IDENTIFIER.test(item.id.trim()) ? item.id.trim() : undefined;
    if (id) {
      const count = (seenIds.get(id) ?? 0) + 1;
      seenIds.set(id, count);
      if (count > 1) diagnostics.push({ level: "error", file: context.file, message: `Duplicate evidence identifier in the same report: ${id}.` });
    } else if (schemaVersion === 2) {
      diagnostics.push({ level: "warning", file: context.file, message: `"${label}" has no identifier: it can be neither replaced nor confirmed.` });
    }
    const itemProducer = record(item.producer) ?? producer;
    const method = METHODS.has(item.method as EvidenceMethod) ? item.method as EvidenceMethod : undefined;
    const confirms = typeof item.confirms === "string" && IDENTIFIER.test(item.confirms.trim()) ? item.confirms.trim() : undefined;
    const declaredBasis = BASES.has(item.basis as EvidenceBasis) ? item.basis as EvidenceBasis : undefined;
    // A developer describing its own work is reporting, whatever it measured;
    // only a reviewer's measurement is an observation of someone else's code.
    // A failure is never a confirmation, whatever it cites: read as one, it was
    // worth the evidence it named and stopped counting against its criterion.
    const basis: EvidenceBasis = verdict === "confirmed" || (confirms && verdict !== "fail") ? "confirmation" : source === "developer" ? "reported" : declaredBasis ?? "observed";
    const blocker = blockerOf(item.blocker);
    // Any other value of `kind` is ignored: the item then behaves as it always did.
    const kind = item.kind === "attempt" ? "attempt" as const : undefined;
    // A result cannot be observed after the file reporting it arrived: such a date was made up.
    let observedAt = text(item.observedAt, 40);
    if (observedAt && /^\d{4}-\d{2}-\d{2}T/.test(observedAt) && Date.parse(observedAt) > Date.parse(context.receivedAt)) { observedAt = undefined; futureDates += 1; }
    // An item that names its own code version owns both ends: the root range spans the whole session, and the
    // merged file, which has no root, must restate the item with the same identity.
    const itemStart = snapshotReference(item.codeSnapshotId);
    const itemEnd = snapshotReference(item.codeSnapshotAtEnd);
    const ownVersion = Boolean(itemStart || itemEnd);
    const attachments: EvidenceAttachmentView[] = attachmentPaths(item).map((attachment) => {
      const archived = attachmentPath(attachment);
      return { source: attachment, ...(archived ? { path: archived } : {}), archived: Boolean(archived) };
    });
    const content = {
      source, id, label, verdict, kind,
      expected: text(item.expected), actual: text(item.actual), command: text(item.command), note: text(item.note),
      criterionIds: identifiers(item.criterionIds ?? item.criterion_ids), checkIds: identifiers(item.checkIds ?? item.check_ids), taskIds: identifiers(item.taskIds ?? item.task_ids),
      method: method ?? (typeof root.method === "string" && METHODS.has(root.method as EvidenceMethod) ? root.method as EvidenceMethod : undefined),
      basis, confirms, blocker,
      snapshotAtStart: ownVersion ? itemStart : reportStart,
      snapshotAtEnd: ownVersion ? itemEnd : reportEnd,
      supersedes: identifiers(item.supersedes),
      attachments: attachments.map((attachment) => attachment.source),
    };
    // Kept out of the identity: the merged file restates a per-task item under its own root revision.
    const itemRevision = positiveInteger(item.criteriaRevision) ?? criteriaRevision;
    const view: EvidenceView = {
      key: `${context.file}@${context.version}#${index}`,
      ...(id ? { id } : {}),
      label, verdict, ...(kind ? { kind } : {}), source, file: context.file, version: context.version, receivedAt: context.receivedAt,
      ...(positiveInteger(item.round) ?? round ? { round: positiveInteger(item.round) ?? round } : {}),
      ...(itemProducer ? { producer: { ...(text(itemProducer.role, 80) ? { role: text(itemProducer.role, 80) } : {}), ...(text(itemProducer.agentId, 120) ? { agentId: text(itemProducer.agentId, 120) } : {}) } } : {}),
      ...(observedAt ? { observedAt } : {}),
      ...(content.method ? { method: content.method } : {}),
      basis,
      ...(content.expected ? { expected: content.expected } : {}),
      ...(content.actual ? { actual: content.actual } : {}),
      ...(content.command ? { command: content.command } : {}),
      ...(content.note ? { note: content.note } : {}),
      criterionIds: content.criterionIds, checkIds: content.checkIds, taskIds: content.taskIds,
      ...(content.snapshotAtStart ? { snapshotId: content.snapshotAtStart } : {}),
      freshness: "unknown",
      supersedes: content.supersedes,
      ...(confirms ? { confirms } : {}),
      ...(blocker ? { blocker } : {}),
      attachments,
    };
    records.push({
      identity: `${source}:${id ?? "anonymous"}:${stableHash(content)}`,
      ...(id ? { unversionedIdentity: `${source}:${id}:${stableHash({ ...content, snapshotAtStart: undefined, snapshotAtEnd: undefined })}` } : {}),
      view,
      ...(itemRevision ? { criteriaRevision: itemRevision } : {}),
      ...(content.snapshotAtStart ? { snapshotAtStart: content.snapshotAtStart } : {}),
      ...(content.snapshotAtEnd ? { snapshotAtEnd: content.snapshotAtEnd } : {}),
    });
  });
  if (futureDates > 0) diagnostics.push({ level: "warning", file: context.file, message: `${futureDates} observation date${futureDates > 1 ? "s" : ""} later than the reception of the file, replaced by the reception time.` });
  const status = text(root.status, 40)?.toUpperCase();
  // Read tolerantly: a list or a single id. Anything else is taken as no mandate, which checks every criterion,
  // and so is a list that holds something but no identifier. Only a list left empty names no criterion.
  const declaredMandate = Array.isArray(root.mandate) || typeof root.mandate === "string" ? identifiers(root.mandate) : undefined;
  const emptyList = Array.isArray(root.mandate) && root.mandate.length === 0;
  const mandate = declaredMandate && (declaredMandate.length > 0 || emptyList) ? declaredMandate : undefined;
  if (declaredMandate && !mandate) diagnostics.push({ level: "warning", file: context.file, message: "The mandate names no criterion identifier: every criterion is held against the verdict." });
  return { source, ...(status ? { status } : {}), ...(round ? { round } : {}), ...(mandate ? { mandate } : {}), records, diagnostics };
}

// --- Coverage ---------------------------------------------------------------

export type CoverageInput = {
  registry?: CriteriaRegistry;
  plan?: PlanLinks;
  /** Every archived version of every report, oldest first. */
  reports: { version: AcceptanceReportVersion; records: EvidenceRecord[] }[];
  /** The code as it stands now, or undefined when it cannot be established. */
  currentSnapshot?: { id: string; capturedAt: string };
  /** The snapshots the shared utility actually took. Undefined when unknown: any identifier is then taken at its word. */
  knownSnapshots?: Set<string>;
  diagnostics?: Diagnostics;
  now: string;
  /** The language of the reasons and warnings. English, which the interface shows, unless the merge request summary is being written in another one. */
  language?: WorkflowLanguage;
};

function freshnessOf(entry: EvidenceRecord, input: CoverageInput): EvidenceFreshness {
  const { snapshotAtStart: start, snapshotAtEnd: end } = entry;
  if (start && end && start !== end) return "inconclusive";
  const id = start ?? end;
  if (!id) return "unknown";
  if (input.knownSnapshots && !input.knownSnapshots.has(id)) return "unknown";
  if (!input.currentSnapshot) return "unknown";
  return id === input.currentSnapshot.id ? "current" : "stale";
}

type Outcome = "positive" | "negative" | "blocked" | "none";

function outcomeOf(view: EvidenceView): Outcome {
  if (view.verdict === "fail") return "negative";
  if (view.verdict === "pass" || view.verdict === "measured" || view.verdict === "confirmed") return "positive";
  return view.blocker ? "blocked" : "none";
}

const STATUS_ORDER: AcceptanceStatus[] = ["failed", "blocked", "unverified", "verified"];

function worst(statuses: AcceptanceStatus[]): AcceptanceStatus {
  return STATUS_ORDER.find((status) => statuses.includes(status)) ?? "unverified";
}

/**
 * A break attempt that found no defect. Surviving one attack verifies nothing,
 * so it is never counted for a check or a criterion, only listed. A failing
 * attempt is a defect and goes the way of any failing item.
 */
function idleAttempt(view: EvidenceView) {
  return view.kind === "attempt" && view.verdict !== "fail";
}

const QA_APPROVALS = new Set(["PASS", "PASS_WITH_WARNINGS"]);
/** The verdicts of something QA executed itself, as opposed to a confirmation or a code reading. */
const QA_OBSERVATIONS = new Set(["measured", "pass", "fail"]);

/**
 * Holds the verdict QA declares against its own evidence. Approving (PASS or
 * PASS_WITH_WARNINGS) is inconsistent as long as one criterion has no fresh QA
 * observation: `observed` names the criteria that have one. A focused pass
 * answers for the criteria of its mandate only; the others have no QA item by
 * design and are never held against it. A criterion the registry marks
 * `afterDeployment` cannot be observed before the merge: PASS_WITH_WARNINGS
 * over it is the verdict the QA contract asks for, PASS is still flagged.
 */
export function qaVerdictConsistency(report: { status: string; file: string; round?: number; mandate?: string[] }, criteria: Pick<Criterion, "id" | "afterDeployment">[], observed: Set<string>, language: WorkflowLanguage = "en"): AcceptanceQaView {
  const t = acceptanceText(language);
  const criterionIds = criteria.map((criterion) => criterion.id);
  const named = report.mandate ? criterionIds.filter((id) => report.mandate?.includes(id)) : undefined;
  // A mandate that names only criteria the registry does not have limits nothing: read as a limit,
  // it held the verdict against no criterion at all and any approval came out consistent.
  const mandate = named && (named.length > 0 || report.mandate?.length === 0) ? named : undefined;
  const excused = new Set(report.status === "PASS_WITH_WARNINGS" ? criteria.filter((criterion) => criterion.afterDeployment).map((criterion) => criterion.id) : []);
  const unobserved = QA_APPROVALS.has(report.status) ? (mandate ?? criterionIds).filter((id) => !observed.has(id) && !excused.has(id)) : [];
  const warning = unobserved.length === 0 ? undefined
    : t.qaUnobserved(report.status, t.enumeration(unobserved), unobserved.length);
  return { status: report.status, file: report.file, ...(report.round ? { round: report.round } : {}), ...(mandate ? { mandate } : {}), consistent: unobserved.length === 0, unobserved, ...(warning ? { warning } : {}) };
}

export function emptyCounts(): AcceptanceCounts {
  return { total: 0, verified: 0, failed: 0, blocked: 0, unverified: 0, stale: 0 };
}

/**
 * The merged file copies an item without the root `codeSnapshot` of the per-task file it came from.
 * That copy takes the code version of the one other file stating the same item with a version.
 */
function withCopiedCodeVersions(reports: CoverageInput["reports"]): CoverageInput["reports"] {
  const versioned = new Map<string, EvidenceRecord[]>();
  for (const { records } of reports) for (const entry of records) {
    if (!entry.unversionedIdentity || !(entry.snapshotAtStart || entry.snapshotAtEnd)) continue;
    versioned.set(entry.unversionedIdentity, [...versioned.get(entry.unversionedIdentity) ?? [], entry]);
  }
  return reports.map(({ version, records }) => ({ version, records: records.map((entry) => {
    if (!entry.unversionedIdentity || entry.snapshotAtStart || entry.snapshotAtEnd) return entry;
    const elsewhere = (versioned.get(entry.unversionedIdentity) ?? []).filter((candidate) => candidate.view.file !== entry.view.file);
    const [original] = elsewhere;
    if (!original || new Set(elsewhere.map((candidate) => candidate.identity)).size !== 1) return entry;
    return {
      ...entry,
      identity: original.identity,
      ...(original.snapshotAtStart ? { snapshotAtStart: original.snapshotAtStart } : {}),
      ...(original.snapshotAtEnd ? { snapshotAtEnd: original.snapshotAtEnd } : {}),
      view: { ...entry.view, ...(original.view.snapshotId ? { snapshotId: original.view.snapshotId } : {}) },
    };
  }) }));
}

export function deriveAcceptanceCoverage(input: CoverageInput): AcceptanceView {
  const t = acceptanceText(input.language);
  const diagnostics: Diagnostics = [...input.diagnostics ?? []];
  const evidence = withCopiedCodeVersions(input.reports);
  const latestVersion = new Map<string, number>();
  for (const { version } of evidence) latestVersion.set(version.file, Math.max(latestVersion.get(version.file) ?? 0, version.version));
  const reports = evidence.map(({ version }) => ({ ...version, current: latestVersion.get(version.file) === version.version }));

  // One observation seen in several files or versions counts once, under the first place it appeared,
  // against the oldest criteria revision any copy declares: a later copy cannot vouch for a newer text.
  const unique = new Map<string, EvidenceRecord>();
  for (const { records } of evidence) for (const entry of records) {
    const seen = unique.get(entry.identity);
    if (!seen) unique.set(entry.identity, entry);
    else if ((entry.criteriaRevision ?? 1) < (seen.criteriaRevision ?? 1)) unique.set(entry.identity, { ...seen, criteriaRevision: entry.criteriaRevision ?? 1 });
  }
  // A producer correcting its own file restates an item under the same id: the latest version of that file
  // is the item. A failure is the exception, only a new id naming it in `supersedes` replaces it.
  const latestById = new Map<string, EvidenceRecord>();
  for (const { version, records: listed } of evidence) {
    if (latestVersion.get(version.file) !== version.version || isRoundCopy(version.file)) continue;
    for (const entry of listed) if (entry.view.id) latestById.set(`${version.file}#${entry.view.id}`, entry);
  }
  const rewritten = new Set<string>();
  for (const { version, records: listed } of evidence) {
    if (latestVersion.get(version.file) === version.version) continue;
    for (const entry of listed) {
      const latest = entry.view.id ? latestById.get(`${version.file}#${entry.view.id}`) : undefined;
      if (!latest || latest.identity === entry.identity) continue;
      if (outcomeOf(entry.view) === "negative" && outcomeOf(latest.view) !== "negative") {
        diagnostics.push({ level: "warning", file: version.file, message: t.rewrittenFailure(entry.view.id!) });
        continue;
      }
      rewritten.add(entry.identity);
    }
  }
  const records = [...unique.values()].filter((entry) => !rewritten.has(entry.identity)).map((entry) => ({ ...entry, view: { ...entry.view, freshness: freshnessOf(entry, input) } }));
  // What the latest version of some report still says, as opposed to what only an older version said.
  // A `-roundN` copy is the orchestrator's archive of a finished round: history by construction.
  const stillReported = new Set(evidence
    .filter(({ version }) => latestVersion.get(version.file) === version.version && !isRoundCopy(version.file))
    .flatMap(({ records: current }) => current.map((entry) => entry.identity)));
  const byId = new Map<string, typeof records>();
  for (const entry of records) if (entry.view.id) byId.set(entry.view.id, [...byId.get(entry.view.id) ?? [], entry]);
  for (const [id, sharing] of byId) {
    if (sharing.length > 1) {
      diagnostics.push({ level: "warning", message: t.reusedIdentifier(id) });
    }
  }

  const criteria: Criterion[] = input.registry?.criteria ?? [];
  const checkOwner = new Map<string, Criterion>();
  for (const criterion of criteria) for (const check of criterion.checks) checkOwner.set(check.id, criterion);
  const criterionIds = new Set(criteria.map((criterion) => criterion.id));

  // Which checks each record speaks to, and for which criteria it only names the criterion.
  const linkedChecks = new Map<string, Set<string>>();
  const unassigned = new Map<string, EvidenceView[]>();
  const general = new Set<string>();
  // The criteria each break attempt targets, by the criteria and checks it cites.
  const attemptTargets = new Map<string, Set<string>>();
  for (const entry of records) {
    const { view } = entry;
    const checks = new Set<string>();
    const targets = new Set<string>();
    for (const checkId of view.checkIds) {
      if (checkOwner.has(checkId)) { checks.add(checkId); targets.add(checkOwner.get(checkId)!.id); }
      else if (input.registry) diagnostics.push({ level: "error", file: view.file, message: t.unknownCheck(view.label, checkId) });
    }
    for (const criterionId of view.criterionIds) {
      const criterion = criteria.find((candidate) => candidate.id === criterionId);
      if (!criterion) {
        if (input.registry) diagnostics.push({ level: "error", file: view.file, message: t.unknownCriterion(view.label, criterionId) });
        continue;
      }
      targets.add(criterion.id);
      if (criterion.checks.some((check) => checks.has(check.id))) continue;
      const [only] = criterion.checks;
      if (only && criterion.checks.length === 1) checks.add(only.id);
      else if (!idleAttempt(view)) unassigned.set(criterion.id, [...unassigned.get(criterion.id) ?? [], view]);
    }
    linkedChecks.set(entry.identity, checks);
    const unlinked = view.criterionIds.length === 0 && view.checkIds.length === 0;
    if (view.kind === "attempt") {
      if (unlinked && input.registry) diagnostics.push({ level: "warning", file: view.file, message: t.unlinkedAttempt(view.label) });
      attemptTargets.set(entry.identity, targets);
    }
    if (unlinked) general.add(entry.identity);
  }

  // A replacement is honoured only between two results on the same check, or
  // between two general gates (which cite no check by contract), the newer one
  // taken on the code as it stands. Anything else stays on the record.
  const supersededBy = new Map<string, string>();
  for (const entry of records) {
    for (const replacedId of entry.view.supersedes) {
      for (const replaced of byId.get(replacedId) ?? []) {
        if (replaced.identity === entry.identity) continue;
        const shared = (general.has(replaced.identity) && general.has(entry.identity))
          || [...linkedChecks.get(replaced.identity) ?? []].some((check) => linkedChecks.get(entry.identity)?.has(check))
          // Two attempts on the same criterion: the later one replaces the earlier, whichever check each named.
          || [...attemptTargets.get(replaced.identity) ?? []].some((target) => attemptTargets.get(entry.identity)?.has(target));
        if (!shared) { diagnostics.push({ level: "warning", file: entry.view.file, message: t.replacesOtherCheck(entry.view.label, replacedId) }); continue; }
        if (entry.view.freshness !== "current") { diagnostics.push({ level: "warning", file: entry.view.file, message: t.replacesWithoutCurrentCode(entry.view.label, replacedId) }); continue; }
        supersededBy.set(replaced.identity, entry.view.id ?? entry.view.label);
      }
    }
  }
  const finalRecords = records.map((entry) => {
    const by = supersededBy.get(entry.identity);
    return by ? { ...entry, view: { ...entry.view, supersededBy: by } } : entry;
  });
  const finalByIdentity = new Map(finalRecords.map((entry) => [entry.identity, entry]));

  /** A confirmation is worth what it confirms, on the version that was actually measured. */
  function effective(entry: EvidenceRecord): { outcome: Outcome; freshness: EvidenceFreshness; problem?: string } {
    const outcome = outcomeOf(entry.view);
    if (entry.view.basis !== "confirmation") return { outcome, freshness: entry.view.freshness };
    const confirmed = entry.view.confirms ? (byId.get(entry.view.confirms) ?? []).map((candidate) => finalByIdentity.get(candidate.identity)!) : [];
    if (!entry.view.confirms || confirmed.length === 0) return { outcome: "none", freshness: entry.view.freshness, problem: t.confirmedNotFound(entry.view.label) };
    const positive = confirmed.filter((candidate) => outcomeOf(candidate.view) === "positive" && candidate.view.basis !== "confirmation");
    if (positive.length === 0) return { outcome: "none", freshness: entry.view.freshness, problem: t.confirmsNonPositive(entry.view.label) };
    // Like a replacement, a confirmation holds only on a check the evidence it
    // inspected speaks to: a result on one criterion says nothing about another.
    const original = positive.find((candidate) => (general.has(candidate.identity) && general.has(entry.identity))
      || [...linkedChecks.get(candidate.identity) ?? []].some((check) => linkedChecks.get(entry.identity)?.has(check)));
    if (!original) return { outcome: "none", freshness: entry.view.freshness, problem: t.confirmsOtherCheck(entry.view.label) };
    return { outcome: outcome === "positive" ? "positive" : outcome, freshness: original.view.freshness };
  }

  const tasksByCriterion = new Map<string, { id: string; title: string }[]>();
  for (const task of input.plan?.tasks ?? []) {
    for (const criterionId of task.criterionIds) {
      if (input.registry && !criterionIds.has(criterionId)) { diagnostics.push({ level: "error", file: "planner-output.json", message: t.taskUnknownCriterion(task.id, criterionId) }); continue; }
      tasksByCriterion.set(criterionId, [...tasksByCriterion.get(criterionId) ?? [], { id: task.id, title: task.title }]);
    }
  }
  if (input.registry && input.plan?.criteriaRevision && input.plan.criteriaRevision < input.registry.revision) {
    diagnostics.push({ level: "warning", file: "planner-output.json", message: t.planRevision(input.plan.criteriaRevision, input.registry.revision) });
  }

  const staleCounted = new Set<string>();
  const criteriaViews: AcceptanceCriterionView[] = criteria.map((criterion) => {
    const checks: AcceptanceCheckView[] = criterion.checks.map((check) => {
      const linked = finalRecords.filter((entry) => linkedChecks.get(entry.identity)?.has(check.id) && !idleAttempt(entry.view));
      const reasons: string[] = [];
      const counted: { entry: EvidenceRecord; outcome: Outcome; freshness: EvidenceFreshness }[] = [];
      for (const entry of linked) {
        if (entry.view.supersededBy) continue;
        if ((entry.criteriaRevision ?? 1) < criterion.revision) { reasons.push(t.olderCriterionVersion(entry.view.label)); continue; }
        const result = effective(entry);
        if (result.problem) reasons.push(result.problem);
        if (result.freshness === "stale") staleCounted.add(entry.identity);
        counted.push({ entry, outcome: result.outcome, freshness: result.freshness });
      }
      const failing = counted.filter(({ outcome, freshness }) => outcome === "negative" && (freshness === "current" || freshness === "unknown"));
      const olderFailures = counted.filter(({ outcome, freshness }) => outcome === "negative" && freshness === "stale");
      const positives = counted.filter(({ outcome, freshness }) => outcome === "positive" && freshness === "current");
      const blocked = counted.filter(({ outcome }) => outcome === "blocked");
      let status: AcceptanceStatus;
      if (failing.length > 0) {
        status = "failed";
        reasons.unshift(...failing.map(({ entry }) => t.failure(entry.view.label, entry.view.actual)));
        if (positives.length > 0) reasons.push(t.contradictory);
      } else if (positives.length > 0 && olderFailures.length > 0) {
        status = "unverified";
        reasons.unshift(t.olderFailure(olderFailures.map(({ entry }) => entry.view.id ?? entry.view.label).join(", ")));
      } else if (positives.length > 0) {
        status = "verified";
      } else if (blocked.length > 0 && !counted.some(({ outcome }) => outcome === "positive")) {
        status = "blocked";
        reasons.unshift(...blocked.map(({ entry }) => t.blocked(entry.view.blocker!.reason, entry.view.blocker!.action)));
      } else {
        status = "unverified";
        for (const view of unassigned.get(criterion.id) ?? []) {
          reasons.push(t.unnamedCheck(view.label, criterion.id, check.id));
        }
        if (counted.length === 0 && reasons.length === 0) reasons.push(t.noEvidence);
        for (const { outcome, freshness, entry } of counted) {
          if (outcome === "positive" && freshness !== "current") reasons.push(t.withLabel(t.freshness[freshness], entry.view.label));
          if (outcome === "negative" && freshness === "inconclusive") reasons.push(t.withLabel(t.freshness.inconclusive, entry.view.label));
          if (outcome === "none") reasons.push(t.notRun(entry.view.label, entry.view.actual));
        }
      }
      const active = linked.filter((entry) => !entry.view.supersededBy).map((entry) => entry.view);
      const history = linked.filter((entry) => entry.view.supersededBy).map((entry) => entry.view);
      return { id: check.id, description: check.description, ...(check.method ? { method: check.method } : {}), status, reasons: [...new Set(reasons)], evidence: active, history };
    });
    const tasks = tasksByCriterion.get(criterion.id) ?? [];
    const reasons: string[] = [];
    if (tasks.length === 0 && input.plan) reasons.push(t.noTask);
    const attempts = finalRecords.filter((entry) => idleAttempt(entry.view) && attemptTargets.get(entry.identity)?.has(criterion.id)).map((entry) => entry.view);
    const status = worst(checks.map((check) => check.status));
    if (attempts.length > 0 && status !== "verified") reasons.push(t.idleAttempt);
    return {
      id: criterion.id, text: criterion.text, status,
      ...(criterion.source ? { source: criterion.source } : {}),
      ...(criterion.expected ? { expected: criterion.expected } : {}),
      tasks, checks, unassigned: unassigned.get(criterion.id) ?? [], attempts, reasons,
    };
  });

  // What QA claims, against what it observed itself on the code as it stands. At tier 0 the pilot writes the
  // QA file (`producer.role: "pilot"`, same source): what it executed itself counts the same way.
  const qaReport = input.registry ? reports.findLast((entry) => entry.source === "qa" && entry.current && !isRoundCopy(entry.file) && entry.status) : undefined;
  const observedByQa = new Set<string>();
  for (const entry of finalRecords) {
    const { view } = entry;
    if (view.source !== "qa" || view.kind === "attempt" || view.basis === "confirmation" || view.supersededBy) continue;
    if (!QA_OBSERVATIONS.has(view.verdict) || view.freshness !== "current") continue;
    for (const id of view.criterionIds) if (criterionIds.has(id)) observedByQa.add(id);
    for (const checkId of linkedChecks.get(entry.identity) ?? []) observedByQa.add(checkOwner.get(checkId)!.id);
  }
  const qa = qaReport?.status ? qaVerdictConsistency({ status: qaReport.status, file: qaReport.file, round: qaReport.round, mandate: qaReport.mandate }, criteria, observedByQa, input.language) : undefined;

  // Without a registry the criteria can only be rebuilt from an older plan's
  // strings, and nothing can be tied to them: shown, never verified.
  const reconstructed: AcceptanceCriterionView[] = input.registry ? [] : (input.plan?.legacyCriteria ?? []).map((statement, index) => ({
    id: `AC${index + 1}`, text: statement, status: "unverified" as const, tasks: [], checks: [], unassigned: [], attempts: [], reconstructed: true,
    reasons: [t.reconstructed],
  }));
  const shown = input.registry ? criteriaViews : reconstructed;
  const counts = emptyCounts();
  counts.total = shown.length;
  for (const criterion of shown) counts[criterion.status] += 1;
  counts.stale = staleCounted.size;

  return {
    available: Boolean(input.registry),
    ...(input.registry ? { registryRevision: input.registry.revision } : {}),
    updatedAt: input.now,
    counts,
    sentence: coverageSentence(counts, input.language),
    ...(input.currentSnapshot ? { currentSnapshot: input.currentSnapshot } : {}),
    criteria: shown,
    general: finalRecords.filter((entry) => general.has(entry.identity) && stillReported.has(entry.identity) && !entry.view.supersededBy).map((entry) => entry.view),
    generalHistory: finalRecords.filter((entry) => general.has(entry.identity) && (!stillReported.has(entry.identity) || entry.view.supersededBy)).map((entry) => entry.view),
    diagnostics: dedupeDiagnostics(diagnostics),
    reports,
    ...(qa ? { qa } : {}),
  };
}

function dedupeDiagnostics(diagnostics: Diagnostics) {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.level}|${diagnostic.file ?? ""}|${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- Summary ----------------------------------------------------------------

/** "5 of 8 criteria verified · 1 failed · 1 blocked · 1 unverified", the same sentence in the tab and, in the workflow language, in the merge request. */
export function coverageSentence(counts: AcceptanceCounts, language: WorkflowLanguage = "en") {
  return acceptanceText(language).sentence(counts);
}

function cell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function evidenceLine(view: EvidenceView, language: WorkflowLanguage) {
  const t = acceptanceText(language);
  const qualifiers = [
    view.freshness === "stale" ? t.qualifier.stale : "",
    view.freshness === "unknown" ? t.qualifier.unknown : "",
    view.freshness === "inconclusive" ? t.qualifier.inconclusive : "",
    view.basis === "reported" ? t.qualifier.reported : "",
  ].filter(Boolean);
  const attachments = view.attachments.map((attachment) => `\`${attachment.source}\``).join(", ");
  return `${t.source[view.source]} · ${view.label} (${view.verdict}${view.actual ? `, ${view.actual}` : ""})${qualifiers.length ? ` [${qualifiers.join(", ")}]` : ""}${attachments ? t.localFiles(attachments) : ""}`;
}

export type AcceptanceSummary = {
  markdown: string;
  json: {
    schemaVersion: 1;
    generatedAt: string;
    available: boolean;
    sentence: string;
    counts: AcceptanceCounts;
    currentSnapshotId?: string;
    criteria: { id: string; text: string; status: AcceptanceStatus; reasons: string[]; attachments: string[] }[];
    /** Set when the verdict QA declares is not backed by its own observations. */
    qaWarning?: string;
    /** Local files only: a link to them in the merge request is valid once uploaded, never before. */
    localAttachments: string[];
  };
};

/**
 * The summary the workflow reads before the merge request. Short part for the
 * description, detail for the review comment. Attachments are named by their
 * local path and marked as such: whoever publishes them uploads them first and
 * swaps in the returned link, a local path being unreachable from the forge.
 * `language` is the workflow language, and `view` must have been derived in
 * that same language: its reasons are quoted as they are.
 */
/**
 * The reasons of the checks that decide the criterion's status come first: the summary shows only the first
 * reason, and a criterion's own reasons (no task, an idle attempt) are notes that never hold it.
 */
function summaryReasons(criterion: AcceptanceCriterionView): string[] {
  const deciding = criterion.checks.filter((check) => check.status === criterion.status);
  const others = criterion.checks.filter((check) => check.status !== criterion.status);
  return [...new Set([...deciding.flatMap((check) => check.reasons), ...others.flatMap((check) => check.reasons), ...criterion.reasons])];
}

export function renderAcceptanceSummary(view: AcceptanceView, language: WorkflowLanguage = "en"): AcceptanceSummary {
  const t = acceptanceText(language);
  const sentence = t.sentence(view.counts);
  const lines: string[] = [t.summaryTitle, "", t.summaryOrigin, ""];
  const localAttachments = new Set<string>();
  const criteria = view.criteria.map((criterion) => {
    const evidence = [...criterion.checks.flatMap((check) => check.evidence), ...criterion.unassigned];
    const attachments = [...new Set(evidence.flatMap((entry) => entry.attachments.map((attachment) => attachment.source)))];
    for (const attachment of attachments) localAttachments.add(attachment);
    return { id: criterion.id, text: criterion.text, status: criterion.status, reasons: summaryReasons(criterion), attachments };
  });

  lines.push(t.descriptionHeading, "");
  if (!view.available) {
    lines.push(t.unavailable, "");
  } else if (view.counts.total === 0) {
    lines.push(t.noCriteria, "");
  } else {
    lines.push(sentence, "");
    for (const criterion of criteria.filter((entry) => entry.status !== "verified")) {
      lines.push(t.unverifiedLine(criterion.id, t.status[criterion.status].toLowerCase(), criterion.text, criterion.reasons[0]));
    }
    if (criteria.some((entry) => entry.status !== "verified")) lines.push("");
  }
  if (view.qa?.warning) lines.push(t.qaToConfirm(view.qa.warning), "");

  lines.push(t.detailHeading, "");
  if (view.criteria.length > 0) {
    lines.push(t.tableHeader, "| --- | --- | --- |");
    for (const criterion of view.criteria) {
      const evidence = [...criterion.checks.flatMap((check) => check.evidence), ...criterion.unassigned].map((entry) => evidenceLine(entry, language));
      const proof = evidence.length ? evidence.join(t.evidenceSeparator) : summaryReasons(criterion)[0] ?? t.noProof;
      lines.push(`| ${cell(`${criterion.id} · ${criterion.text}`)} | ${t.status[criterion.status]} | ${cell(proof)} |`);
    }
    lines.push("");
  }
  if (view.general.length > 0) {
    lines.push(t.generalHeading, "");
    for (const entry of view.general) lines.push(`${t.generalLine(entry.label, entry.verdict)}${entry.command ? ` (\`${entry.command}\`)` : ""}${entry.actual ? `, ${entry.actual}` : ""}`);
    lines.push("");
  }
  if (localAttachments.size > 0) {
    lines.push(t.attachmentsHeading, "", t.attachmentsNote, "");
    for (const attachment of localAttachments) lines.push(`- \`${attachment}\``);
    lines.push("");
  }
  if (view.diagnostics.some((diagnostic) => diagnostic.level === "error")) {
    lines.push(t.anomaliesHeading, "");
    for (const diagnostic of view.diagnostics.filter((entry) => entry.level === "error")) lines.push(t.anomalyLine(diagnostic.file, diagnostic.message));
    lines.push("");
  }
  return {
    markdown: `${lines.join("\n").trimEnd()}\n`,
    json: {
      schemaVersion: 1, generatedAt: view.updatedAt, available: view.available, sentence, counts: view.counts,
      ...(view.currentSnapshot ? { currentSnapshotId: view.currentSnapshot.id } : {}),
      criteria, localAttachments: [...localAttachments],
      ...(view.qa?.warning ? { qaWarning: view.qa.warning } : {}),
    },
  };
}

/** The figures the run state and the side list carry, without the evidence itself. */
export function acceptanceCountsKey(view: AcceptanceView) {
  return JSON.stringify([view.available, view.counts, view.diagnostics.length, view.criteria.map((criterion) => [criterion.id, criterion.status]), view.reports.length, view.qa ? [view.qa.status, view.qa.unobserved] : null]);
}
