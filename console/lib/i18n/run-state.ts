import { defineTexts } from "./index";

const plural = (count: number, one: string, many: string) => (count > 1 ? many : one);

/**
 * The French wording of each confidence rule, mirroring `acceptanceText("fr")`
 * in server/acceptance-text.ts, which the page cannot import. English keeps
 * the `detail` the server wrote.
 */
function frenchReason(rule: string, count: number | undefined, detail: string) {
  const n = count ?? 1;
  switch (rule) {
    case "run_failed": return "Le run a échoué.";
    case "workflow_blocked": return "Le workflow s'est terminé bloqué.";
    case "draft_delivery": return "La merge request a été ouverte en brouillon.";
    case "criterion_failed": return `${n} ${plural(n, "critère d'acceptation en échec", "critères d'acceptation en échec")}.`;
    case "qa_rejected": return "La QA n'a pas approuvé le changement.";
    case "finding_p0_open": return `${n} ${plural(n, "constat bloquant", "constats bloquants")} de la revue de code ${plural(n, "laissé", "laissés")} sans correction.`;
    case "criterion_blocked": return `${n} ${plural(n, "critère d'acceptation bloqué", "critères d'acceptation bloqués")}.`;
    case "no_criteria_registry": return "Aucun registre de critères : rien ne relie les preuves à une exigence.";
    case "qa_unobserved": return `La QA a approuvé alors que ${n} ${plural(n, "critère n'a", "critères n'ont")} aucune observation QA sur le code actuel.`;
    case "incident_open": return `${n} ${plural(n, "incident encore ouvert", "incidents encore ouverts")}.`;
    case "finding_p1_open": return `${n} ${plural(n, "constat important", "constats importants")} de la revue de code ${plural(n, "laissé", "laissés")} sans correction.`;
    case "qa_missing": return "Aucun verdict QA : personne d'autre que l'auteur n'a observé les critères.";
    case "test_removed": return `${n} ${plural(n, "fichier de test supprimé ou avec un test désactivé", "fichiers de test supprimés ou avec un test désactivé")}.`;
    case "criterion_unverified": return `${n} ${plural(n, "critère d'acceptation non vérifié", "critères d'acceptation non vérifiés")}.`;
    case "evidence_stale": return `${n} ${plural(n, "preuve prise", "preuves prises")} sur un code qui a changé depuis.`;
    case "gate_failed": return "Un contrôle du stop gate échouait encore quand son agent a rendu la main.";
    case "gate_unchecked": return "Un contrôle du stop gate n'a pas pu conclure.";
    case "evidence_anomaly": return `${n} ${plural(n, "anomalie", "anomalies")} de traçabilité dans les fichiers de preuves.`;
    case "review_order": return `${n} ${plural(n, "reviewer a écrit ses attentes", "reviewers ont écrit leurs attentes")} après son rapport.`;
    case "rework_repeated": return `${n} rounds de rework avant la fin de la revue.`;
    case "reviewer_lost": return `${n} ${plural(n, "reviewer s'est arrêté", "reviewers se sont arrêtés")} sans résultat.`;
    case "diff_unknown": return "La taille du changement n'a pas pu être lue.";
    case "sensitive_path": return `${n} ${plural(n, "fichier sensible modifié", "fichiers sensibles modifiés")}.`;
    case "no_test_change": return "Du code a changé et aucun fichier de test.";
    default: return detail;
  }
}

/**
 * The size rules name their threshold, which the server keeps. The rule ids
 * of those three are read here with the figures their English detail carries.
 */
function frenchSizeReason(rule: string, detail: string) {
  const numbers = detail.match(/\d+/g) ?? [];
  if (rule === "diff_large" || rule === "diff_very_large") return `${numbers[0]} lignes modifiées, plus de ${numbers[1]}.`;
  if (rule === "diff_many_files") return `${numbers[0]} fichiers modifiés, plus de ${numbers[1]}.`;
  return undefined;
}

export const runState = defineTexts({
  pendingAnswerOne: { en: "Claude is waiting for an answer", fr: "Claude attend une réponse" },
  pendingAnswerMany: { en: (count: number) => `Claude is waiting for ${count} answers`, fr: (count: number) => `Claude attend ${count} réponses` },
  worktreeRemoved: { en: "Worktree removed", fr: "Worktree supprimé" },
  worktreeKept: { en: "Worktree kept", fr: "Worktree conservé" },

  phaseRead: { en: "Read the ticket", fr: "Lire le ticket" },
  phaseClarify: { en: "Clarify", fr: "Clarifier" },
  phaseBranch: { en: "Create the branch", fr: "Créer la branche" },
  phasePlan: { en: "Plan", fr: "Planifier" },
  phaseImplement: { en: "Implement", fr: "Implémenter" },
  phaseVerify: { en: "Verify", fr: "Vérifier" },
  phaseReview: { en: "Review", fr: "Relire" },
  phaseOpen: { en: (delivery: string) => `Open the ${delivery}`, fr: (delivery: string) => `Ouvrir la ${delivery}` },
  phasePublish: { en: "Publish the review", fr: "Publier la review" },
  phaseFinish: { en: "Finish", fr: "Terminer" },

  anotherTicket: { en: "another ticket", fr: "un autre ticket" },
  reasonTicket: { en: "ticket already running", fr: "ticket déjà en cours" },
  reasonAnalysis: { en: "analysis in progress", fr: "analyse en cours" },
  reasonConflict: { en: (other: string) => `conflict with ${other}, which is running`, fr: (other: string) => `conflit avec ${other}, en cours` },
  reasonMerge: { en: (request: string, other: string) => `waits for ${request} to be merged (${other})`, fr: (request: string, other: string) => `attend le merge de ${request} (${other})` },
  reasonMergeUnknown: { en: (request: string, other: string) => `state of ${request} unknown (${other})`, fr: (request: string, other: string) => `état de ${request} inconnu (${other})` },
  reasonDependency: { en: (other: string) => `depends on ${other}, still queued`, fr: (other: string) => `dépend de ${other}, toujours en file` },
  reasonOrder: { en: (other: string) => `goes after ${other}`, fr: (other: string) => `passe après ${other}` },
  reasonStacked: { en: (branch: string) => `stacked start on ${branch}, as soon as a slot is free`, fr: (branch: string) => `démarrage empilé sur ${branch}, dès qu'un slot est libre` },
  reasonForced: { en: "forced start, as soon as a slot is free", fr: "démarrage forcé, dès qu'un slot est libre" },
  reasonSlots: { en: "all slots are taken", fr: "tous les slots sont pris" },
  statusAnalysis: { en: "Analysis in progress", fr: "Analyse en cours" },
  statusWaiting: { en: (reason: string) => `Waiting, ${reason}`, fr: (reason: string) => `En attente, ${reason}` },
  markAnalysisFailed: { en: "Analysis failed", fr: "Analyse échouée" },
  markAnalysisFailedTitle: { en: (failure: string) => `Analysis failed: ${failure}. This ticket runs alone on its repository.`, fr: (failure: string) => `Analyse échouée : ${failure}. Ce ticket tourne seul sur son dépôt.` },
  markUnreliable: { en: "Unreliable prediction", fr: "Prédiction peu fiable" },
  markUnreliableTitle: { en: "The ticket does not say enough about what it touches. It runs alone on its repository.", fr: "Le ticket ne dit pas assez ce qu'il touche. Il tourne seul sur son dépôt." },

  statusStarting: { en: "Starting", fr: "Démarrage" },
  statusRunning: { en: "Running", fr: "En cours" },
  statusAttention: { en: "Your turn", fr: "À vous" },
  statusPaused: { en: "Paused", fr: "En pause" },
  statusCompleted: { en: "Completed", fr: "Terminé" },
  statusStopped: { en: "Stopped", fr: "Arrêté" },
  statusFailed: { en: "Error", fr: "Erreur" },
  statusAvailable: { en: "Available", fr: "Disponible" },
  badgeInterrupted: { en: "Interrupted", fr: "Interrompu" },
  badgeNoNextStep: { en: "No next step", fr: "Plus d'étape suivante" },

  noProgress: { en: "No progress observed", fr: "Aucune progression observée" },
  attentionNeeded: { en: "Claude Code asks for your attention", fr: "Claude Code demande votre attention" },

  confidenceMeaningNone: { en: "a person has to review everything", fr: "une personne doit tout relire" },
  confidenceMeaningFull: { en: "nothing observed stands against the automated review", fr: "rien d'observé ne s'oppose à la revue automatisée" },
  confidenceMeaningSome: { en: "see the Evidence tab for what lowered it", fr: "voir l'onglet Preuves pour ce qui l'a fait baisser" },
  confidenceTitle: { en: (score: number, maximum: number, meaning: string) => `Review confidence ${score} of ${maximum}: ${meaning}`, fr: (score: number, maximum: number, meaning: string) => `Confiance de la revue ${score} sur ${maximum} : ${meaning}` },
  confidenceHeld: { en: (cap: number) => `Held at ${cap}`, fr: (cap: number) => `Plafonnée à ${cap}` },
  confidenceMinus: { en: (value: number) => `Minus ${value}`, fr: (value: number) => `Moins ${String(value).replace(".", ",")}` },
  confidenceLine: { en: (effect: string, detail: string) => `${effect}: ${detail}`, fr: (effect: string, detail: string) => `${effect} : ${detail}` },
  confidenceReason: {
    en: (_rule: string, _count: number | undefined, detail: string) => detail,
    fr: (rule: string, count: number | undefined, detail: string) => frenchSizeReason(rule, detail) ?? frenchReason(rule, count, detail),
  },

  criteriaVerified: { en: (verified: number, total: number) => `${verified} of ${total} criteria verified`, fr: (verified: number, total: number) => `${verified} ${plural(verified, "critère vérifié", "critères vérifiés")} sur ${total}` },
  criteriaFailed: { en: (count: number) => `${count} failed`, fr: (count: number) => `${count} ${plural(count, "échoué", "échoués")}` },
  criteriaBlocked: { en: (count: number) => `${count} blocked`, fr: (count: number) => `${count} ${plural(count, "bloqué", "bloqués")}` },
  criteriaUnverified: { en: (count: number) => `${count} unverified`, fr: (count: number) => `${count} non ${plural(count, "vérifié", "vérifiés")}` },

  alertQuestionBody: { en: (where: string) => `${where} · the workflow is waiting for your decision to continue.`, fr: (where: string) => `${where} · le workflow attend votre décision pour continuer.` },
  alertTrustTitle: { en: "Claude Code asks to trust this folder", fr: "Claude Code demande de faire confiance à ce dossier" },
  alertTrustBody: { en: (where: string) => `${where} · the session does not start without your decision.`, fr: (where: string) => `${where} · la session ne démarre pas sans votre décision.` },
  alertCompletedTitle: { en: (where: string) => `Workflow completed · ${where}`, fr: (where: string) => `Workflow terminé · ${where}` },
  alertCompletedBody: { en: "The run reached its end.", fr: "Le run est arrivé au bout." },
  alertFailedTitle: { en: (where: string) => `The run failed · ${where}`, fr: (where: string) => `Le run a échoué · ${where}` },
  alertFailedBody: { en: "The session was interrupted.", fr: "La session a été interrompue." },
  alertStoppedTitle: { en: (where: string) => `Run stopped · ${where}`, fr: (where: string) => `Run arrêté · ${where}` },
  alertStoppedBody: { en: "You stopped the session before the end of the workflow.", fr: "Vous avez arrêté la session avant la fin du workflow." },
  alertIncidentTitle: { en: (title: string, where: string) => `${title} · ${where}`, fr: (title: string, where: string) => `${title} · ${where}` },
  alertIncidentBody: { en: "Open the run to see what was observed and what you can do.", fr: "Ouvrez le run pour voir ce qui a été observé et ce que vous pouvez faire." },
  alertAttentionTitle: { en: "Claude Code is waiting for your attention", fr: "Claude Code attend votre attention" },
  alertAttentionBody: { en: (where: string) => `${where} · the run is paused until you take over.`, fr: (where: string) => `${where} · le run est en pause jusqu'à ce que vous repreniez la main.` },
  alertStallTitle: { en: (where: string) => `No progress observed · ${where}`, fr: (where: string) => `Aucune progression observée · ${where}` },
  alertStallBody: { en: "A doubt, not a verdict: nothing was stopped or restarted.", fr: "Un doute, pas un verdict : rien n'a été arrêté ni relancé." },
  titleWaitingMany: { en: (count: number) => `${count} runs are waiting for an answer`, fr: (count: number) => `${count} runs attendent une réponse` },
  titleAttention: { en: (count: number) => `Needs attention${count > 1 ? ` (${count})` : ""}`, fr: (count: number) => `À traiter${count > 1 ? ` (${count})` : ""}` },
  titleActive: { en: (count: number) => `${count} run${count > 1 ? "s" : ""} in progress`, fr: (count: number) => `${count} ${count > 1 ? "runs" : "run"} en cours` },
  titleFailed: { en: "Failed", fr: "Échec" },
  titleCompleted: { en: "Completed", fr: "Terminé" },
  titleStopped: { en: "Stopped", fr: "Arrêté" },
});
