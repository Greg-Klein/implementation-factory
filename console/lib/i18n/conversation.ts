import { defineTexts } from "./index";

export const conversation = defineTexts({
  writingHint: {
    en: "Claude Code only writes its message once the current action ends: the terminal is ahead of this panel.",
    fr: "Claude Code n'écrit son message qu'une fois l'action en cours terminée : le terminal est en avance sur ce panneau.",
  },
  thinking: { en: "Claude is thinking…", fr: "Claude réfléchit…" },
  log: { en: "Conversation", fr: "Conversation" },
  emptyClosed: {
    en: "No exchange was read back for this run. Its session is closed: its documents and evidence can still be read.",
    fr: "Aucun échange n'a été relu pour ce run. Sa session est fermée : ses documents et ses preuves restent consultables.",
  },
  emptyStalled: {
    en: "The run is progressing but no message could be read from the transcript. The session may be waiting for a confirmation that is not visible here, such as folder trust.",
    fr: "Le run avance mais aucun message n'a pu être lu dans la transcription. La session attend peut-être une confirmation invisible ici, comme la confiance accordée au dossier.",
  },
  checkTerminal: { en: "Check the Terminal tab", fr: "Voir l'onglet Terminal" },
  emptyLive: {
    en: "Exchanges with Claude appear here. Tool calls and agents stay in the Terminal tab.",
    fr: "Les échanges avec Claude apparaissent ici. Les appels d'outils et les agents restent dans l'onglet Terminal.",
  },
  authorClaude: { en: "Claude", fr: "Claude" },
  authorUser: { en: "You", fr: "Vous" },
  waiting: { en: "waiting", fr: "en attente" },
  waitingHint: { en: "Claude will take this instruction at the end of its turn", fr: "Claude prendra cette instruction à la fin de son tour" },
  jumpToLast: { en: "Go to the last message", fr: "Aller au dernier message" },
  instructionLabel: { en: "Instruction for Claude", fr: "Instruction pour Claude" },
  instructionPlaceholder: { en: "Send an instruction to Claude…", fr: "Envoyer une instruction à Claude…" },
  noSession: { en: "No active session.", fr: "Aucune session active." },
  sendInstruction: { en: "Send the instruction", fr: "Envoyer l'instruction" },
  sendHint: { en: "Enter to send, Shift+Enter for a line break.", fr: "Entrée pour envoyer, Maj+Entrée pour un saut de ligne." },

  decisionRequired: { en: "Decision required", fr: "Décision requise" },
  questionWaiting: {
    en: "Claude is waiting for your answer. The terminal stays available.",
    fr: "Claude attend votre réponse. Le terminal reste disponible.",
  },
  yourAnswer: { en: "Your answer", fr: "Votre réponse" },
  answerPlaceholder: { en: "Write your answer…", fr: "Écrivez votre réponse…" },
  sendToClaude: { en: "Send to Claude", fr: "Envoyer à Claude" },

  promptBlocked: {
    en: "The session does not start without your answer. The terminal stays available.",
    fr: "La session ne démarre pas sans votre réponse. Le terminal reste disponible.",
  },
  folderTrust: { en: "Folder trust", fr: "Confiance dans le dossier" },
  folderTrustAsk: { en: "Claude Code asks to trust this folder", fr: "Claude Code demande à faire confiance à ce dossier" },
  folderTrustBody: {
    en: "If it is approved, Claude Code will be able to read, edit and run files in it. Declining closes the session and stops the run.",
    fr: "Si vous acceptez, Claude Code pourra lire, modifier et exécuter des fichiers dedans. Refuser ferme la session et arrête le run.",
  },
  decline: { en: "Decline", fr: "Refuser" },
  trustAndContinue: { en: "Trust and continue", fr: "Faire confiance et continuer" },

  terminalLabel: { en: "Claude Code terminal", fr: "Terminal Claude Code" },

  feedbackTitle: { en: "Improve the factory", fr: "Améliorer la factory" },
  demoBadge: { en: "demo", fr: "démo" },
  feedbackPlaceholder: { en: "What was slow, missing or broken…", fr: "Ce qui était lent, manquant ou cassé…" },
  feedbackSubmit: { en: "Add to the self-improvement loop", fr: "Ajouter à la boucle d'auto-amélioration" },
  feedbackSimulated: { en: "Simulated feedback. Nothing was saved.", fr: "Retour simulé. Rien n'a été sauvegardé." },
  feedbackSavedBefore: { en: "Feedback saved. Run ", fr: "Retour sauvegardé. Lancez " },
  feedbackSavedAfter: { en: " to produce the improvement.", fr: " pour produire l'amélioration." },
  agents: { en: "Agents", fr: "Agents" },
  agentsActive: { en: (count: number) => `${count} active`, fr: (count: number) => `${count} ${count > 1 ? "actifs" : "actif"}` },
  noActiveAgent: { en: "No active agent", fr: "Aucun agent actif" },
  documentsHint: { en: "Context, plans, test and review reports, MR description", fr: "Contexte, plans, rapports de test et de revue, description de la MR" },
  generatedDocuments: { en: "Generated documents", fr: "Documents générés" },
  documentCount: {
    en: (count: number) => `${count} file${count > 1 ? "s" : ""}`,
    fr: (count: number) => `${count} ${count > 1 ? "fichiers" : "fichier"}`,
  },
  documentList: { en: "Document list", fr: "Liste des documents" },
  workflowContinues: { en: "The workflow continues in the background", fr: "Le workflow continue en arrière-plan" },
  readOnly: { en: "Read-only preview", fr: "Aperçu en lecture seule" },
  close: { en: "Close", fr: "Fermer" },
  answer: { en: "Answer", fr: "Répondre" },
  loadingDocument: { en: "Loading the document…", fr: "Chargement du document…" },
  loadFailed: { en: "Could not load this document.", fr: "Impossible de charger ce document." },
});
