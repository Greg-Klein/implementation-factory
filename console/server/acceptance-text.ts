import type { AcceptanceCounts, AcceptanceStatus, EvidenceFreshness, EvidenceSource } from "./types.js";

/**
 * The language of what the workflow writes for people: reports, questions, the
 * merge request. The interface itself is always in English. `IMPL_LANGUAGE`
 * picks it: `fr` for French, English for anything else, unset included.
 */
export type WorkflowLanguage = "en" | "fr";

export function workflowLanguageOf(value: string | undefined): WorkflowLanguage {
  return value?.trim().toLowerCase() === "fr" ? "fr" : "en";
}

const plural = (count: number, one: string, many: string) => (count > 1 ? many : one);

/**
 * Every sentence the acceptance coverage says about a criterion, in both
 * languages. The same computation feeds the "Evidence" tab, always in English,
 * and `acceptance-summary.md`, which goes into the merge request and follows
 * the workflow language. What reads a file and finds it malformed stays in
 * English in both: those anomalies name fields and identifiers.
 */
const ENGLISH = {
  freshness: {
    stale: "Stale evidence: the code changed since the check.",
    unknown: "Unknown version: nothing ties the evidence to the delivered code.",
    inconclusive: "Inconclusive measurement: the code changed during the check.",
  } satisfies Record<Exclude<EvidenceFreshness, "current">, string>,
  enumeration: (ids: string[]) => (ids.length > 1 ? `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}` : ids[0] ?? ""),
  qaUnobserved: (status: string, ids: string, count: number) => `QA declares ${status} while ${ids} ${plural(count, "has", "have")} no QA observation on the current code.`,
  rewrittenFailure: (id: string) => `${id} was rewritten over a failure: the failure still counts until a new identifier replaces it with \`supersedes\`.`,
  reusedIdentifier: (id: string) => `Identifier ${id} is reused with different content: each version is kept as separate evidence.`,
  unknownCheck: (label: string, checkId: string) => `"${label}" cites an unknown check: ${checkId}.`,
  unknownCriterion: (label: string, criterionId: string) => `"${label}" cites an unknown criterion: ${criterionId}.`,
  unlinkedAttempt: (label: string) => `The attempt "${label}" cites no criterion: it is attached to nothing.`,
  replacesOtherCheck: (label: string, replacedId: string) => `"${label}" replaces ${replacedId}, which does not check the same thing: replacement ignored.`,
  replacesWithoutCurrentCode: (label: string, replacedId: string) => `"${label}" replaces ${replacedId} without having been taken on the current code: replacement ignored.`,
  confirmedNotFound: (label: string) => `The evidence confirmed by "${label}" cannot be found.`,
  confirmsNonPositive: (label: string) => `"${label}" confirms evidence that is not a positive result.`,
  confirmsOtherCheck: (label: string) => `"${label}" confirms evidence taken on another check.`,
  taskUnknownCriterion: (taskId: string, criterionId: string) => `Task ${taskId} cites an unknown criterion: ${criterionId}.`,
  planRevision: (planRevision: number, currentRevision: number) => `The plan was written against revision ${planRevision} of the criteria, the current revision is ${currentRevision}.`,
  olderCriterionVersion: (label: string) => `"${label}" was checked against an earlier version of the criterion.`,
  failure: (label: string, actual?: string) => `Failed: ${label}${actual ? ` (${actual})` : ""}.`,
  contradictory: "Contradictory results exist for this check.",
  olderFailure: (ids: string) => `An earlier failure was not explicitly replaced: ${ids}.`,
  blocked: (reason: string, action?: string) => `Blocked: ${reason}${action ? ` Action needed: ${action}` : ""}`,
  unnamedCheck: (label: string, criterionId: string, checkId: string) => `"${label}" cites ${criterionId} without naming this check: it only counts if \`checkIds\` cites ${checkId}.`,
  noEvidence: "No evidence covers this check.",
  withLabel: (reason: string, label: string) => `${reason} ("${label}")`,
  notRun: (label: string, actual?: string) => `Not run: ${label}${actual ? ` (${actual})` : ""}.`,
  noTask: "No task of the plan addresses this criterion.",
  idleAttempt: "A break attempt that finds nothing does not verify the criterion.",
  reconstructed: "Criterion rebuilt from a plan without identifiers: no evidence can be tied to it explicitly.",
  status: { verified: "Verified", failed: "Failed", blocked: "Blocked", unverified: "Unverified" } satisfies Record<AcceptanceStatus, string>,
  sentence: (counts: AcceptanceCounts) => {
    if (counts.total === 0) return "No acceptance criterion identified";
    const head = `${counts.verified} of ${counts.total} ${plural(counts.total, "criterion", "criteria")} verified`;
    const tail = [
      counts.failed ? `${counts.failed} failed` : "",
      counts.blocked ? `${counts.blocked} blocked` : "",
      counts.unverified ? `${counts.unverified} unverified` : "",
    ].filter(Boolean);
    return [head, ...tail].join(" · ");
  },
  source: { qa: "QA", design: "Design", developer: "Developer" } satisfies Record<EvidenceSource, string>,
  qualifier: { stale: "stale evidence", unknown: "unknown version", inconclusive: "inconclusive measurement", reported: "reported result" },
  localFiles: (files: string) => ` · local files ${files}`,
  summaryTitle: "# Acceptance criteria coverage",
  summaryOrigin: "Generated by the Implementation Harness console, from the same computation as the Evidence tab.",
  descriptionHeading: "## Summary for the merge request description",
  unavailable: "Per-criterion traceability unavailable for this run: no criteria registry was written. No criterion is presented as verified.",
  noCriteria: "No acceptance criterion identified for this run. Nothing is presented as verified.",
  unverifiedLine: (id: string, status: string, text: string, reason?: string) => `- **${id}** ${status}: ${text}${reason ? ` (${reason})` : ""}`,
  qaToConfirm: (warning: string) => `QA verdict to confirm: ${warning}`,
  detailHeading: "## Detail for the review comment",
  tableHeader: "| Criterion | State | Evidence |",
  evidenceSeparator: "; ",
  noProof: "No evidence",
  generalHeading: "### General checks",
  generalLine: (label: string, verdict: string) => `- ${label}: ${verdict}`,
  attachmentsHeading: "### Local attachments",
  attachmentsNote: "These files only exist on the machine of the run. Cite one on the forge only once it is uploaded, replacing the path with the returned link; a file that was not uploaded is mentioned as kept local.",
  anomaliesHeading: "### Traceability anomalies",
  anomalyLine: (file: string | undefined, message: string) => `- ${file ? `\`${file}\`: ` : ""}${message}`,
};

type Catalog = typeof ENGLISH;

const FRENCH: Catalog = {
  freshness: {
    stale: "Preuve ancienne : le code a changé depuis la vérification.",
    unknown: "Version inconnue : rien ne relie la preuve au code livré.",
    inconclusive: "Mesure non concluante : le code a changé pendant la vérification.",
  },
  enumeration: (ids) => (ids.length > 1 ? `${ids.slice(0, -1).join(", ")} et ${ids.at(-1)}` : ids[0] ?? ""),
  qaUnobserved: (status, ids, count) => `QA annonce ${status} alors que ${ids} ${plural(count, "n'a", "n'ont")} aucune observation QA sur le code actuel.`,
  rewrittenFailure: (id) => `${id} a été réécrit sur un échec : l'échec reste compté tant qu'un nouvel identifiant ne le remplace pas avec \`supersedes\`.`,
  reusedIdentifier: (id) => `L'identifiant ${id} est réutilisé avec un contenu différent : chaque version est gardée comme une preuve distincte.`,
  unknownCheck: (label, checkId) => `« ${label} » cite un contrôle inconnu : ${checkId}.`,
  unknownCriterion: (label, criterionId) => `« ${label} » cite un critère inconnu : ${criterionId}.`,
  unlinkedAttempt: (label) => `La tentative « ${label} » ne cite aucun critère : elle n'est rattachée à rien.`,
  replacesOtherCheck: (label, replacedId) => `« ${label} » remplace ${replacedId}, qui ne contrôle pas la même chose : remplacement ignoré.`,
  replacesWithoutCurrentCode: (label, replacedId) => `« ${label} » remplace ${replacedId} sans avoir été prise sur le code actuel : remplacement ignoré.`,
  confirmedNotFound: (label) => `La preuve confirmée par « ${label} » est introuvable.`,
  confirmsNonPositive: (label) => `« ${label} » confirme une preuve qui n'est pas un résultat positif.`,
  confirmsOtherCheck: (label) => `« ${label} » confirme une preuve prise sur un autre contrôle.`,
  taskUnknownCriterion: (taskId, criterionId) => `La tâche ${taskId} cite un critère inconnu : ${criterionId}.`,
  planRevision: (planRevision, currentRevision) => `Le plan a été écrit contre la révision ${planRevision} des critères, la révision courante est ${currentRevision}.`,
  olderCriterionVersion: (label) => `« ${label} » a été vérifiée contre une version antérieure du critère.`,
  failure: (label, actual) => `Échec : ${label}${actual ? ` (${actual})` : ""}.`,
  contradictory: "Des résultats contradictoires existent pour ce contrôle.",
  olderFailure: (ids) => `Un échec antérieur n'a pas été explicitement remplacé : ${ids}.`,
  blocked: (reason, action) => `Bloqué : ${reason}${action ? ` Action nécessaire : ${action}` : ""}`,
  unnamedCheck: (label, criterionId, checkId) => `« ${label} » cite ${criterionId} sans nommer ce contrôle : elle ne compte que si \`checkIds\` cite ${checkId}.`,
  noEvidence: "Aucune preuve ne couvre ce contrôle.",
  withLabel: (reason, label) => `${reason} (« ${label} »)`,
  notRun: (label, actual) => `Non exécuté : ${label}${actual ? ` (${actual})` : ""}.`,
  noTask: "Aucune tâche du plan ne traite ce critère.",
  idleAttempt: "Une tentative de mise en échec qui ne trouve rien ne vérifie pas le critère.",
  reconstructed: "Critère reconstruit depuis un plan sans identifiants : aucune preuve ne peut lui être rattachée explicitement.",
  status: { verified: "Vérifié", failed: "Échec", blocked: "Bloqué", unverified: "Non vérifié" },
  sentence: (counts) => {
    if (counts.total === 0) return "Aucun critère d'acceptation identifié";
    const head = `${counts.verified} ${plural(counts.verified, "critère vérifié", "critères vérifiés")} sur ${counts.total}`;
    const tail = [
      counts.failed ? `${counts.failed} ${plural(counts.failed, "échec", "échecs")}` : "",
      counts.blocked ? `${counts.blocked} ${plural(counts.blocked, "bloqué", "bloqués")}` : "",
      counts.unverified ? `${counts.unverified} non ${plural(counts.unverified, "vérifié", "vérifiés")}` : "",
    ].filter(Boolean);
    return [head, ...tail].join(" · ");
  },
  source: { qa: "QA", design: "Design", developer: "Développeur" },
  qualifier: { stale: "preuve ancienne", unknown: "version inconnue", inconclusive: "mesure non concluante", reported: "résultat rapporté" },
  localFiles: (files) => ` · pièces locales ${files}`,
  summaryTitle: "# Couverture des critères d'acceptation",
  summaryOrigin: "Généré par la console Implementation Harness, à partir du même calcul que l'onglet Evidence.",
  descriptionHeading: "## Bilan pour la description de la merge request",
  unavailable: "Traçabilité par critère indisponible pour ce run : aucun registre de critères n'a été écrit. Aucun critère n'est présenté comme vérifié.",
  noCriteria: "Aucun critère d'acceptation identifié pour ce run. Rien n'est présenté comme vérifié.",
  unverifiedLine: (id, status, text, reason) => `- **${id}** ${status} : ${text}${reason ? ` (${reason})` : ""}`,
  qaToConfirm: (warning) => `Verdict QA à confirmer : ${warning}`,
  detailHeading: "## Détail pour le commentaire de review",
  tableHeader: "| Critère | État | Preuves |",
  evidenceSeparator: " ; ",
  noProof: "Aucune preuve",
  generalHeading: "### Vérifications générales",
  generalLine: (label, verdict) => `- ${label} : ${verdict}`,
  attachmentsHeading: "### Pièces jointes locales",
  attachmentsNote: "Ces fichiers n'existent que sur la machine du run. Ne les citer sur la forge qu'une fois uploadés, en remplaçant le chemin par le lien renvoyé ; une pièce non uploadée est mentionnée comme restée locale.",
  anomaliesHeading: "### Anomalies de traçabilité",
  anomalyLine: (file, message) => `- ${file ? `\`${file}\` : ` : ""}${message}`,
};

export function acceptanceText(language: WorkflowLanguage = "en"): Catalog {
  return language === "fr" ? FRENCH : ENGLISH;
}
