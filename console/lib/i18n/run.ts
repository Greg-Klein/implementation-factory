import { defineTexts } from "./index";

export const run = defineTexts({
  sessionView: { en: "Session view", fr: "Vue de la session" },
  tabConversation: { en: "Conversation", fr: "Conversation" },
  tabTracking: { en: "Tracking", fr: "Suivi" },
  tabTerminal: { en: "Terminal", fr: "Terminal" },
  tabEvidence: { en: "Evidence", fr: "Preuves" },
  unreadDecision: { en: "pending decision", fr: "décision en attente" },
  unreadMessage: { en: "new message", fr: "nouveau message" },
  unreadEvidence: { en: "new evidence", fr: "nouvelles preuves" },
  unreadTitle: {
    en: (what: string) => `${what.charAt(0).toUpperCase()}${what.slice(1)} since your last visit to this tab`,
    fr: (what: string) => `${what.charAt(0).toUpperCase()}${what.slice(1)} depuis votre dernière visite sur cet onglet`,
  },
  closeSession: { en: "Close the session", fr: "Fermer la session" },
  closeSessionHint: {
    en: "The run is finished and takes no slot. Its session stays open on the ticket and closes on its own if a queued run waits for that ticket.",
    fr: "Le run est terminé et ne prend aucun slot. Sa session reste ouverte sur le ticket et se ferme d'elle-même si un run en file attend ce ticket.",
  },
  stop: { en: "Stop", fr: "Arrêter" },
  archive: { en: "Archive", fr: "Archive" },
  archiveHint: {
    en: "Run from a previous session, read back from its archive: it has no session any more and takes no instruction.",
    fr: "Run d'une session précédente, relu depuis son archive : il n'a plus de session et ne prend aucune instruction.",
  },
  removeWorktree: { en: "Remove the worktree", fr: "Supprimer le worktree" },
  removeWorktreeHint: {
    en: "Removes the working directory of this run. The branch and its commits stay in the repository. A confirmation is asked if some work is neither committed nor pushed.",
    fr: "Supprime le répertoire de travail de ce run. La branche et ses commits restent dans le dépôt. Une confirmation est demandée si du travail n'est ni commité ni poussé.",
  },
  close: { en: "Close", fr: "Fermer" },
  closeHint: {
    en: "Remove this run from the list. Its documents stay archived on disk.",
    fr: "Retire ce run de la liste. Ses documents restent archivés sur le disque.",
  },
  panelConversation: { en: "Conversation", fr: "Conversation" },
  panelTracking: { en: "Tracking", fr: "Suivi" },
  panelTerminal: { en: "Terminal", fr: "Terminal" },
  panelEvidence: { en: "Evidence", fr: "Preuves" },

  boundaryTitle: {
    en: (name: string) => `The ${name} tab could not be displayed.`,
    fr: (name: string) => `L'onglet ${name} n'a pas pu être affiché.`,
  },
  boundaryBody: { en: "The other tabs and the rest of the console still work.", fr: "Les autres onglets et le reste de la console fonctionnent toujours." },
  boundaryRetry: { en: "Try again", fr: "Réessayer" },

  progress: { en: "Progress", fr: "Progression" },
  progressLabel: { en: "Run progress", fr: "Progression du run" },
  deliverable: { en: "Deliverable", fr: "Rendu" },
  repository: { en: "Repository", fr: "Dépôt" },
  recipe: { en: "Runtime recipe", fr: "Recette d'exécution" },
  recipeHint: {
    en: "What the factory keeps to start the application of this repository",
    fr: "Ce que la factory garde pour démarrer l'application de ce dépôt",
  },
  stackedOn: { en: "Stacked on", fr: "Empilé sur" },
  baseBranch: { en: "Base branch", fr: "Branche de base" },
  worktree: { en: "Worktree", fr: "Worktree" },
  dependenciesLinked: { en: "Dependencies linked to the main checkout", fr: "Dépendances liées au checkout principal" },
  tokens: { en: "Tokens", fr: "Tokens" },
  tokensTitle: {
    en: (total: string) => `${total} tokens read and written, cache included`,
    fr: (total: string) => `${total} tokens lus et écrits, cache compris`,
  },
  tokensPilot: {
    en: (pilot: string, calls: number, agents: number) => `Pilot ${pilot} in ${calls} calls${agents > 0 ? `, ${agents} agent${agents > 1 ? "s" : ""}` : ""}`,
    fr: (pilot: string, calls: number, agents: number) => `Pilote ${pilot} en ${calls} appels${agents > 0 ? `, ${agents} ${agents > 1 ? "agents" : "agent"}` : ""}`,
  },

  worktreeConfirmLabel: { en: "Confirm the worktree removal", fr: "Confirmer la suppression du worktree" },
  worktreeRefusedLabel: { en: "Worktree removal refused", fr: "Suppression du worktree refusée" },
  worktreeUnsaved: { en: "This worktree holds unsaved work", fr: "Ce worktree contient du travail non sauvegardé" },
  worktreeNotRemoved: { en: "Worktree not removed", fr: "Worktree non supprimé" },
  removeAnyway: { en: "Remove anyway", fr: "Supprimer quand même" },
  cancel: { en: "Cancel", fr: "Annuler" },

  expectedNextAction: { en: "Expected next action:", fr: "Prochaine action attendue :" },
  continuationRequested: {
    en: (time: string) => `Continuation requested at ${time}. The incident will close once the run is seen resuming.`,
    fr: (time: string) => `Reprise demandée à ${time}. L'incident se fermera dès que le run sera vu en train de reprendre.`,
  },
  decisionUnknown: {
    en: "An action was recorded just before the server stopped: its outcome is unknown, it was not replayed.",
    fr: "Une action a été enregistrée juste avant l'arrêt du serveur : son résultat est inconnu, elle n'a pas été rejouée.",
  },
  answer: { en: "Answer", fr: "Répondre" },
  requestContinuation: { en: "Request continuation", fr: "Demander la reprise" },
  requestContinuationHint: {
    en: "Asks Claude Code to read the context, the plan and the Git state again, then resume with the next action. Nothing is restarted from the beginning.",
    fr: "Demande à Claude Code de relire le contexte, le plan et l'état de Git, puis de reprendre avec l'action suivante. Rien n'est relancé depuis le début.",
  },
  openTerminal: { en: "Open the terminal", fr: "Ouvrir le terminal" },
  markFalsePositive: { en: "Mark as false positive…", fr: "Marquer comme faux positif…" },
  falsePositiveWhy: { en: "Why is this a false positive?", fr: "Pourquoi est-ce un faux positif ?" },
  mark: { en: "Mark", fr: "Marquer" },
  diagnosis: {
    en: (count: number) => `Diagnosis · ${count} observation${count > 1 ? "s" : ""}`,
    fr: (count: number) => `Diagnostic · ${count} ${count > 1 ? "observations" : "observation"}`,
  },
  detectedAt: {
    en: (time: string, revision: number) => `Detected at ${time} · revision ${revision}`,
    fr: (time: string, revision: number) => `Détecté à ${time} · révision ${revision}`,
  },

  columnTodo: { en: "To Do", fr: "À faire" },
  columnInProgress: { en: "In Progress", fr: "En cours" },
  columnDone: { en: "Done", fr: "Terminé" },
  statusTodo: { en: "To do", fr: "À faire" },
  statusInProgress: { en: "In progress", fr: "En cours" },
  statusDone: { en: "Done", fr: "Terminé" },
  complexityHint: { en: "Complexity estimated by the plan", fr: "Complexité estimée par le plan" },
  noPlanDescription: { en: "The plan does not describe this task beyond its title.", fr: "Le plan ne décrit pas cette tâche au-delà de son titre." },
  developerDetail: { en: "Detail for the developer", fr: "Détail pour le développeur" },
  files: { en: "Files", fr: "Fichiers" },
  criteriaCovered: { en: "Criteria covered", fr: "Critères couverts" },
  dependsOn: { en: "Depends on", fr: "Dépend de" },
  noPlanTitle: { en: "No plan for this run yet.", fr: "Pas encore de plan pour ce run." },
  noPlanBody: {
    en: "Tasks appear here as soon as the implementation plan is written, then move on their own as the run goes.",
    fr: "Les tâches apparaissent ici dès que le plan d'implémentation est écrit, puis avancent d'elles-mêmes au fil du run.",
  },
  taskCount: {
    en: (count: number) => `${count} task${count > 1 ? "s" : ""}`,
    fr: (count: number) => `${count} ${count > 1 ? "tâches" : "tâche"}`,
  },
});
