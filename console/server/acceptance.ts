import { createHash } from "node:crypto";
import path from "node:path";
import type {
  AcceptanceCheckView, AcceptanceCounts, AcceptanceCriterionView, AcceptanceDiagnostic, AcceptanceReportVersion, AcceptanceStatus, AcceptanceView,
  EvidenceAttachmentView, EvidenceBasis, EvidenceFreshness, EvidenceMethod, EvidenceSource, EvidenceView,
} from "./types.js";

/**
 * Acceptance coverage: which criteria of the ticket were verified, on which
 * code, by whom, and with what. Pure: the files arrive as parsed JSON, the code
 * version as an identifier, the clock as a string. Everything the "Preuves"
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
    diagnostics.push({ level: "error", file, message: "Registre des critères illisible : la liste `criteria` est absente." });
    return { diagnostics };
  }
  if (root.schemaVersion !== 1) diagnostics.push({ level: "warning", file, message: `Version de schéma inattendue (${String(root.schemaVersion)}), lecture tentée comme la version 1.` });
  const revision = positiveInteger(root.revision) ?? 1;
  const criteria: Criterion[] = [];
  const seenCriteria = new Set<string>();
  const seenChecks = new Set<string>();
  if (root.criteria.length > MAX_CRITERIA) diagnostics.push({ level: "warning", file, message: `Plus de ${MAX_CRITERIA} critères : les suivants sont ignorés.` });
  for (const entry of root.criteria.slice(0, MAX_CRITERIA)) {
    const input = record(entry);
    const id = typeof input?.id === "string" ? input.id.trim() : "";
    const statement = text(input?.text);
    if (!input || !IDENTIFIER.test(id) || !statement) {
      diagnostics.push({ level: "error", file, message: `Critère ignoré : identifiant ou texte manquant (${id || "sans identifiant"}).` });
      continue;
    }
    if (seenCriteria.has(id)) {
      diagnostics.push({ level: "error", file, message: `Identifiant de critère en double : ${id}. Seule la première occurrence est retenue.` });
      continue;
    }
    seenCriteria.add(id);
    const source = record(input.source);
    const verification = record(input.verification);
    const checks: CriterionCheck[] = [];
    const requested = Array.isArray(verification?.requiredChecks) ? verification.requiredChecks : [];
    for (const candidate of requested.slice(0, MAX_CHECKS)) {
      const check = record(candidate);
      const checkId = typeof check?.id === "string" ? check.id.trim() : "";
      if (!check || !IDENTIFIER.test(checkId)) { diagnostics.push({ level: "error", file, message: `Contrôle sans identifiant valide ignoré dans ${id}.` }); continue; }
      if (seenChecks.has(checkId) || seenCriteria.has(checkId) && checkId !== id) { diagnostics.push({ level: "error", file, message: `Identifiant de contrôle en double : ${checkId}.` }); continue; }
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

function attachmentPaths(item: Record<string, unknown>) {
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

export type ParsedReport = { source: EvidenceSource; status?: string; round?: number; records: EvidenceRecord[]; diagnostics: Diagnostics };

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
    diagnostics.push({ level: "error", file: context.file, message: "Rapport de preuves illisible : `source` ou `items` manquant." });
    return { diagnostics };
  }
  const schemaVersion = root.schemaVersion === undefined ? 1 : root.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2) diagnostics.push({ level: "warning", file: context.file, message: `Version de schéma inconnue (${String(schemaVersion)}), lecture tentée comme la version 2.` });
  const round = positiveInteger(root.round);
  const producer = record(root.producer);
  const reportSnapshot = record(root.codeSnapshot);
  const reportStart = snapshotReference(reportSnapshot?.atStart) ?? snapshotReference(root.codeSnapshotId);
  const reportEnd = snapshotReference(reportSnapshot?.atEnd);
  const criteriaRevision = positiveInteger(root.criteriaRevision);
  if (root.items.length > MAX_ITEMS) diagnostics.push({ level: "warning", file: context.file, message: `Plus de ${MAX_ITEMS} éléments : les suivants sont ignorés.` });
  const seenIds = new Map<string, number>();
  const records: EvidenceRecord[] = [];
  root.items.slice(0, MAX_ITEMS).forEach((entry, index) => {
    const item = record(entry);
    if (!item) { diagnostics.push({ level: "error", file: context.file, message: `Élément ${index + 1} ignoré : ce n'est pas un objet.` }); return; }
    const label = text(item.label, 500) ?? text(item.id, 64);
    if (!label) { diagnostics.push({ level: "error", file: context.file, message: `Élément ${index + 1} ignoré : aucun libellé.` }); return; }
    let verdict = typeof item.verdict === "string" ? item.verdict.trim() : "";
    if (!VERDICTS.has(verdict)) {
      diagnostics.push({ level: "error", file: context.file, message: `Verdict inconnu « ${verdict || "vide"} » pour « ${label} », lu comme non vérifié.` });
      verdict = "unverified";
    }
    const id = typeof item.id === "string" && IDENTIFIER.test(item.id.trim()) ? item.id.trim() : undefined;
    if (id) {
      const count = (seenIds.get(id) ?? 0) + 1;
      seenIds.set(id, count);
      if (count > 1) diagnostics.push({ level: "error", file: context.file, message: `Identifiant de preuve en double dans le même rapport : ${id}.` });
    } else if (schemaVersion === 2) {
      diagnostics.push({ level: "warning", file: context.file, message: `« ${label} » n'a pas d'identifiant : il ne pourra être ni remplacé ni confirmé.` });
    }
    const itemProducer = record(item.producer) ?? producer;
    const method = METHODS.has(item.method as EvidenceMethod) ? item.method as EvidenceMethod : undefined;
    const confirms = typeof item.confirms === "string" && IDENTIFIER.test(item.confirms.trim()) ? item.confirms.trim() : undefined;
    const declaredBasis = BASES.has(item.basis as EvidenceBasis) ? item.basis as EvidenceBasis : undefined;
    // A developer describing its own work is reporting, whatever it measured;
    // only a reviewer's measurement is an observation of someone else's code.
    const basis: EvidenceBasis = verdict === "confirmed" || confirms ? "confirmation" : source === "developer" ? "reported" : declaredBasis ?? "observed";
    const blocker = blockerOf(item.blocker);
    const attachments: EvidenceAttachmentView[] = attachmentPaths(item).map((attachment) => {
      const archived = attachmentPath(attachment);
      return { source: attachment, ...(archived ? { path: archived } : {}), archived: Boolean(archived) };
    });
    const content = {
      source, id, label, verdict,
      expected: text(item.expected), actual: text(item.actual), command: text(item.command), note: text(item.note),
      criterionIds: identifiers(item.criterionIds ?? item.criterion_ids), checkIds: identifiers(item.checkIds ?? item.check_ids), taskIds: identifiers(item.taskIds ?? item.task_ids),
      method: method ?? (typeof root.method === "string" && METHODS.has(root.method as EvidenceMethod) ? root.method as EvidenceMethod : undefined),
      basis, confirms, blocker,
      snapshotAtStart: snapshotReference(item.codeSnapshotId) ?? reportStart,
      snapshotAtEnd: snapshotReference(item.codeSnapshotAtEnd) ?? reportEnd,
      supersedes: identifiers(item.supersedes),
      attachments: attachments.map((attachment) => attachment.source),
      criteriaRevision: positiveInteger(item.criteriaRevision) ?? criteriaRevision,
    };
    const view: EvidenceView = {
      key: `${context.file}@${context.version}#${index}`,
      ...(id ? { id } : {}),
      label, verdict, source, file: context.file, version: context.version, receivedAt: context.receivedAt,
      ...(positiveInteger(item.round) ?? round ? { round: positiveInteger(item.round) ?? round } : {}),
      ...(itemProducer ? { producer: { ...(text(itemProducer.role, 80) ? { role: text(itemProducer.role, 80) } : {}), ...(text(itemProducer.agentId, 120) ? { agentId: text(itemProducer.agentId, 120) } : {}) } } : {}),
      ...(text(item.observedAt, 40) ? { observedAt: text(item.observedAt, 40) } : {}),
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
      view,
      ...(content.criteriaRevision ? { criteriaRevision: content.criteriaRevision } : {}),
      ...(content.snapshotAtStart ? { snapshotAtStart: content.snapshotAtStart } : {}),
      ...(content.snapshotAtEnd ? { snapshotAtEnd: content.snapshotAtEnd } : {}),
    });
  });
  return { source, ...(text(root.status, 40) ? { status: text(root.status, 40) } : {}), ...(round ? { round } : {}), records, diagnostics };
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

const FRESHNESS_REASON: Record<Exclude<EvidenceFreshness, "current">, string> = {
  stale: "Preuve ancienne : le code a changé depuis la vérification.",
  unknown: "Version inconnue : rien ne relie la preuve au code livré.",
  inconclusive: "Mesure non concluante : le code a changé pendant la vérification.",
};

const STATUS_ORDER: AcceptanceStatus[] = ["failed", "blocked", "unverified", "verified"];

function worst(statuses: AcceptanceStatus[]): AcceptanceStatus {
  return STATUS_ORDER.find((status) => statuses.includes(status)) ?? "unverified";
}

export function emptyCounts(): AcceptanceCounts {
  return { total: 0, verified: 0, failed: 0, blocked: 0, unverified: 0, stale: 0 };
}

export function deriveAcceptanceCoverage(input: CoverageInput): AcceptanceView {
  const diagnostics: Diagnostics = [...input.diagnostics ?? []];
  const latestVersion = new Map<string, number>();
  for (const { version } of input.reports) latestVersion.set(version.file, Math.max(latestVersion.get(version.file) ?? 0, version.version));
  const reports = input.reports.map(({ version }) => ({ ...version, current: latestVersion.get(version.file) === version.version }));

  // One observation seen in several files or versions counts once, under the first place it appeared.
  const unique = new Map<string, EvidenceRecord>();
  for (const { records } of input.reports) for (const entry of records) if (!unique.has(entry.identity)) unique.set(entry.identity, entry);
  const records = [...unique.values()].map((entry) => ({ ...entry, view: { ...entry.view, freshness: freshnessOf(entry, input) } }));
  const byId = new Map<string, typeof records>();
  for (const entry of records) if (entry.view.id) byId.set(entry.view.id, [...byId.get(entry.view.id) ?? [], entry]);
  for (const [id, sharing] of byId) {
    if (sharing.length > 1) {
      diagnostics.push({ level: "warning", message: `L'identifiant ${id} est réutilisé avec un contenu différent : chaque version est gardée comme une preuve distincte.` });
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
  for (const entry of records) {
    const { view } = entry;
    const checks = new Set<string>();
    for (const checkId of view.checkIds) {
      if (checkOwner.has(checkId)) checks.add(checkId);
      else if (input.registry) diagnostics.push({ level: "error", file: view.file, message: `« ${view.label} » cite un contrôle inconnu : ${checkId}.` });
    }
    for (const criterionId of view.criterionIds) {
      const criterion = criteria.find((candidate) => candidate.id === criterionId);
      if (!criterion) {
        if (input.registry) diagnostics.push({ level: "error", file: view.file, message: `« ${view.label} » cite un critère inconnu : ${criterionId}.` });
        continue;
      }
      if (criterion.checks.some((check) => checks.has(check.id))) continue;
      if (criterion.checks.length === 1) checks.add(criterion.checks[0].id);
      else unassigned.set(criterion.id, [...unassigned.get(criterion.id) ?? [], view]);
    }
    linkedChecks.set(entry.identity, checks);
    if (view.criterionIds.length === 0 && view.checkIds.length === 0) general.add(entry.identity);
  }

  // A replacement is honoured only between two results on the same check, the
  // newer one taken on the code as it stands. Anything else stays on the record.
  const supersededBy = new Map<string, string>();
  for (const entry of records) {
    for (const replacedId of entry.view.supersedes) {
      for (const replaced of byId.get(replacedId) ?? []) {
        if (replaced.identity === entry.identity) continue;
        const shared = [...linkedChecks.get(replaced.identity) ?? []].some((check) => linkedChecks.get(entry.identity)?.has(check));
        if (!shared) { diagnostics.push({ level: "warning", file: entry.view.file, message: `« ${entry.view.label} » remplace ${replacedId}, qui ne contrôle pas la même chose : remplacement ignoré.` }); continue; }
        if (entry.view.freshness !== "current") { diagnostics.push({ level: "warning", file: entry.view.file, message: `« ${entry.view.label} » remplace ${replacedId} sans avoir été prise sur le code actuel : remplacement ignoré.` }); continue; }
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
    if (!entry.view.confirms || confirmed.length === 0) return { outcome: "none", freshness: entry.view.freshness, problem: `La preuve confirmée par « ${entry.view.label} » est introuvable.` };
    const original = confirmed.find((candidate) => outcomeOf(candidate.view) === "positive" && candidate.view.basis !== "confirmation");
    if (!original) return { outcome: "none", freshness: entry.view.freshness, problem: `« ${entry.view.label} » confirme une preuve qui n'est pas un résultat positif.` };
    return { outcome: outcome === "positive" ? "positive" : outcome, freshness: original.view.freshness };
  }

  const tasksByCriterion = new Map<string, { id: string; title: string }[]>();
  for (const task of input.plan?.tasks ?? []) {
    for (const criterionId of task.criterionIds) {
      if (input.registry && !criterionIds.has(criterionId)) { diagnostics.push({ level: "error", file: "planner-output.json", message: `La tâche ${task.id} cite un critère inconnu : ${criterionId}.` }); continue; }
      tasksByCriterion.set(criterionId, [...tasksByCriterion.get(criterionId) ?? [], { id: task.id, title: task.title }]);
    }
  }
  if (input.registry && input.plan?.criteriaRevision && input.plan.criteriaRevision < input.registry.revision) {
    diagnostics.push({ level: "warning", file: "planner-output.json", message: `Le plan a été écrit contre la révision ${input.plan.criteriaRevision} des critères, la révision courante est ${input.registry.revision}.` });
  }

  const staleCounted = new Set<string>();
  const criteriaViews: AcceptanceCriterionView[] = criteria.map((criterion) => {
    const checks: AcceptanceCheckView[] = criterion.checks.map((check) => {
      const linked = finalRecords.filter((entry) => linkedChecks.get(entry.identity)?.has(check.id));
      const reasons: string[] = [];
      const counted: { entry: EvidenceRecord; outcome: Outcome; freshness: EvidenceFreshness }[] = [];
      for (const entry of linked) {
        if (entry.view.supersededBy) continue;
        if ((entry.criteriaRevision ?? 1) < criterion.revision) { reasons.push(`« ${entry.view.label} » a été vérifiée contre une version antérieure du critère.`); continue; }
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
        reasons.unshift(...failing.map(({ entry }) => `Échec : ${entry.view.label}${entry.view.actual ? ` (${entry.view.actual})` : ""}.`));
        if (positives.length > 0) reasons.push("Des résultats contradictoires existent pour ce contrôle.");
      } else if (positives.length > 0 && olderFailures.length > 0) {
        status = "unverified";
        reasons.unshift(`Un échec antérieur n'a pas été explicitement remplacé : ${olderFailures.map(({ entry }) => entry.view.id ?? entry.view.label).join(", ")}.`);
      } else if (positives.length > 0) {
        status = "verified";
      } else if (blocked.length > 0) {
        status = "blocked";
        reasons.unshift(...blocked.map(({ entry }) => `Bloqué : ${entry.view.blocker!.reason}${entry.view.blocker!.action ? ` Action nécessaire : ${entry.view.blocker!.action}` : ""}`));
      } else {
        status = "unverified";
        if (counted.length === 0 && reasons.length === 0) reasons.push("Aucune preuve ne couvre ce contrôle.");
        for (const { outcome, freshness, entry } of counted) {
          if (outcome === "positive" && freshness !== "current") reasons.push(`${FRESHNESS_REASON[freshness]} (« ${entry.view.label} »)`);
          if (outcome === "negative" && freshness === "inconclusive") reasons.push(`${FRESHNESS_REASON.inconclusive} (« ${entry.view.label} »)`);
          if (outcome === "none") reasons.push(`Non exécuté : ${entry.view.label}${entry.view.actual ? ` (${entry.view.actual})` : ""}.`);
        }
      }
      const active = linked.filter((entry) => !entry.view.supersededBy).map((entry) => entry.view);
      const history = linked.filter((entry) => entry.view.supersededBy).map((entry) => entry.view);
      return { id: check.id, description: check.description, ...(check.method ? { method: check.method } : {}), status, reasons: [...new Set(reasons)], evidence: active, history };
    });
    const tasks = tasksByCriterion.get(criterion.id) ?? [];
    const reasons: string[] = [];
    if (tasks.length === 0 && input.plan) reasons.push("Aucune tâche du plan ne traite ce critère.");
    return {
      id: criterion.id, text: criterion.text, status: worst(checks.map((check) => check.status)),
      ...(criterion.source ? { source: criterion.source } : {}),
      ...(criterion.expected ? { expected: criterion.expected } : {}),
      tasks, checks, unassigned: unassigned.get(criterion.id) ?? [], reasons,
    };
  });

  // Without a registry the criteria can only be rebuilt from an older plan's
  // strings, and nothing can be tied to them: shown, never verified.
  const reconstructed: AcceptanceCriterionView[] = input.registry ? [] : (input.plan?.legacyCriteria ?? []).map((statement, index) => ({
    id: `AC${index + 1}`, text: statement, status: "unverified" as const, tasks: [], checks: [], unassigned: [], reconstructed: true,
    reasons: ["Critère reconstruit depuis un plan sans identifiants : aucune preuve ne peut lui être rattachée explicitement."],
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
    ...(input.currentSnapshot ? { currentSnapshot: input.currentSnapshot } : {}),
    criteria: shown,
    general: finalRecords.filter((entry) => general.has(entry.identity)).map((entry) => entry.view),
    diagnostics: dedupeDiagnostics(diagnostics),
    reports,
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

export const STATUS_LABEL: Record<AcceptanceStatus, string> = { verified: "Vérifié", failed: "Échec", blocked: "Bloqué", unverified: "Non vérifié" };

/** "5 critères vérifiés sur 8 · 1 échec · 1 bloqué · 1 non vérifié", the same sentence in the tab and in the merge request. */
export function coverageSentence(counts: AcceptanceCounts) {
  if (counts.total === 0) return "Aucun critère d'acceptation identifié";
  const head = `${counts.verified} ${counts.verified > 1 ? "critères vérifiés" : "critère vérifié"} sur ${counts.total}`;
  const tail = [
    counts.failed ? `${counts.failed} ${counts.failed > 1 ? "échecs" : "échec"}` : "",
    counts.blocked ? `${counts.blocked} ${counts.blocked > 1 ? "bloqués" : "bloqué"}` : "",
    counts.unverified ? `${counts.unverified} non ${counts.unverified > 1 ? "vérifiés" : "vérifié"}` : "",
  ].filter(Boolean);
  return [head, ...tail].join(" · ");
}

function cell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

const SOURCE_LABEL: Record<EvidenceSource, string> = { qa: "QA", design: "Design", developer: "Développeur" };

function evidenceLine(view: EvidenceView) {
  const qualifiers = [
    view.freshness === "stale" ? "preuve ancienne" : "",
    view.freshness === "unknown" ? "version inconnue" : "",
    view.freshness === "inconclusive" ? "mesure non concluante" : "",
    view.basis === "reported" ? "résultat rapporté" : "",
  ].filter(Boolean);
  const attachments = view.attachments.map((attachment) => `\`${attachment.source}\``).join(", ");
  return `${SOURCE_LABEL[view.source]} · ${view.label} (${view.verdict}${view.actual ? `, ${view.actual}` : ""})${qualifiers.length ? ` [${qualifiers.join(", ")}]` : ""}${attachments ? ` · pièces locales ${attachments}` : ""}`;
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
    /** Local files only: a link to them in the merge request is valid once uploaded, never before. */
    localAttachments: string[];
  };
};

/**
 * The summary the workflow reads before the merge request. Short part for the
 * description, detail for the review comment. Attachments are named by their
 * local path and marked as such: whoever publishes them uploads them first and
 * swaps in the returned link, a local path being unreachable from GitLab.
 */
export function renderAcceptanceSummary(view: AcceptanceView): AcceptanceSummary {
  const sentence = coverageSentence(view.counts);
  const lines: string[] = ["# Couverture des critères d'acceptation", "", "Généré par la console Implementation Harness, à partir du même calcul que l'onglet Preuves.", ""];
  const localAttachments = new Set<string>();
  const criteria = view.criteria.map((criterion) => {
    const evidence = [...criterion.checks.flatMap((check) => check.evidence), ...criterion.unassigned];
    const attachments = [...new Set(evidence.flatMap((entry) => entry.attachments.map((attachment) => attachment.source)))];
    for (const attachment of attachments) localAttachments.add(attachment);
    const reasons = [...criterion.reasons, ...criterion.checks.flatMap((check) => check.reasons)];
    return { id: criterion.id, text: criterion.text, status: criterion.status, reasons: [...new Set(reasons)], attachments };
  });

  lines.push("## Bilan pour la description de la merge request", "");
  if (!view.available) {
    lines.push("Traçabilité par critère indisponible pour ce run : aucun registre de critères n'a été écrit. Aucun critère n'est présenté comme vérifié.", "");
  } else if (view.counts.total === 0) {
    lines.push("Aucun critère d'acceptation identifié pour ce run. Rien n'est présenté comme vérifié.", "");
  } else {
    lines.push(sentence, "");
    for (const criterion of criteria.filter((entry) => entry.status !== "verified")) {
      lines.push(`- **${criterion.id}** ${STATUS_LABEL[criterion.status].toLowerCase()} : ${criterion.text}${criterion.reasons[0] ? ` (${criterion.reasons[0]})` : ""}`);
    }
    if (criteria.some((entry) => entry.status !== "verified")) lines.push("");
  }

  lines.push("## Détail pour le commentaire de review", "");
  if (view.criteria.length > 0) {
    lines.push("| Critère | État | Preuves |", "| --- | --- | --- |");
    for (const criterion of view.criteria) {
      const evidence = [...criterion.checks.flatMap((check) => check.evidence), ...criterion.unassigned].map(evidenceLine);
      const reasons = [...criterion.reasons, ...criterion.checks.flatMap((check) => check.reasons)];
      const proof = evidence.length ? evidence.join(" ; ") : reasons[0] ?? "Aucune preuve";
      lines.push(`| ${cell(`${criterion.id} · ${criterion.text}`)} | ${STATUS_LABEL[criterion.status]} | ${cell(proof)} |`);
    }
    lines.push("");
  }
  if (view.general.length > 0) {
    lines.push("### Vérifications générales", "");
    for (const entry of view.general) lines.push(`- ${entry.label} : ${entry.verdict}${entry.command ? ` (\`${entry.command}\`)` : ""}${entry.actual ? `, ${entry.actual}` : ""}`);
    lines.push("");
  }
  if (localAttachments.size > 0) {
    lines.push("### Pièces jointes locales", "", "Ces fichiers n'existent que sur la machine du run. Ne les citer dans GitLab qu'une fois uploadés, en remplaçant le chemin par le lien renvoyé ; une pièce non uploadée est mentionnée comme restée locale.", "");
    for (const attachment of localAttachments) lines.push(`- \`${attachment}\``);
    lines.push("");
  }
  if (view.diagnostics.some((diagnostic) => diagnostic.level === "error")) {
    lines.push("### Anomalies de traçabilité", "");
    for (const diagnostic of view.diagnostics.filter((entry) => entry.level === "error")) lines.push(`- ${diagnostic.file ? `\`${diagnostic.file}\` : ` : ""}${diagnostic.message}`);
    lines.push("");
  }
  return {
    markdown: `${lines.join("\n").trimEnd()}\n`,
    json: {
      schemaVersion: 1, generatedAt: view.updatedAt, available: view.available, sentence, counts: view.counts,
      ...(view.currentSnapshot ? { currentSnapshotId: view.currentSnapshot.id } : {}),
      criteria, localAttachments: [...localAttachments],
    },
  };
}

/** The figures the run state and the side list carry, without the evidence itself. */
export function acceptanceCountsKey(view: AcceptanceView) {
  return JSON.stringify([view.available, view.counts, view.diagnostics.length, view.criteria.map((criterion) => [criterion.id, criterion.status]), view.reports.length]);
}
