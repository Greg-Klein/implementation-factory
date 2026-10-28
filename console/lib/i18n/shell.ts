import { defineTexts } from "./index";

const plural = (count: number, one: string, many: string) => (count > 1 ? many : one);

export const shell = defineTexts({
  batchQueued: { en: "Batch queued", fr: "Batch mis en file" },
  batchDetail: {
    en: (accepted: number, duplicates: number) => `${accepted} ticket${plural(accepted, "", "s")} added. The queue shows which start and which wait.${duplicates > 0 ? ` ${duplicates} already queued, running or waiting for merge ${duplicates > 1 ? "were skipped" : "was skipped"}.` : ""}`,
    fr: (accepted: number, duplicates: number) => `${accepted} ticket${plural(accepted, "", "s")} ${plural(accepted, "ajouté", "ajoutés")}. La file montre lesquels démarrent et lesquels attendent.${duplicates > 0 ? ` ${duplicates} déjà en file, en cours ou en attente de merge ${duplicates > 1 ? "ont été ignorés" : "a été ignoré"}.` : ""}`,
  },
  notConnected: {
    en: "Not connected to the console. Nothing was sent. Try again in a moment.",
    fr: "Non connecté à la console. Rien n'a été envoyé. Réessayez dans un instant.",
  },
  tagline: { en: "Software factory on Claude Code", fr: "Software factory sur Claude Code" },
  byline: { en: "by Gregory Klein", fr: "par Gregory Klein" },
  darkTheme: { en: "Dark theme", fr: "Thème sombre" },
  darkThemeTitle: {
    en: (dark: boolean) => (dark ? "Dark theme, click to switch to light" : "Light theme, click to switch to dark"),
    fr: (dark: boolean) => (dark ? "Thème sombre, cliquer pour passer au clair" : "Thème clair, cliquer pour passer au sombre"),
  },
  alertSound: { en: "Alert sound", fr: "Son d'alerte" },
  alertSoundTitle: {
    en: (on: boolean) => (on ? "Alert sound on, click to mute" : "Alert sound off, click to turn on"),
    fr: (on: boolean) => (on ? "Son d'alerte activé, cliquer pour le couper" : "Son d'alerte coupé, cliquer pour l'activer"),
  },
  connectionTitle: {
    en: "Live connection between this page and the local server of the factory",
    fr: "Connexion en direct entre cette page et le serveur local de la factory",
  },
  localServer: { en: "Local server", fr: "Serveur local" },
  connected: { en: "connected", fr: "connecté" },
  reconnecting: { en: "reconnecting…", fr: "reconnexion…" },
  hideError: { en: "Hide the error", fr: "Masquer l'erreur" },
  hideMessage: { en: "Hide this message", fr: "Masquer ce message" },

  errorTitle: { en: "The console could not display this page.", fr: "La console n'a pas pu afficher cette page." },
  errorBody: {
    en: "Your runs keep going on the local server. Show the page again to get back to them.",
    fr: "Vos runs continuent sur le serveur local. Réaffichez la page pour les retrouver.",
  },
  errorRetry: { en: "Show the page again", fr: "Réafficher la page" },

  fetchDiffError: { en: "Could not fetch the diff.", fr: "Impossible de récupérer le diff." },
  fetchReportError: { en: "Could not fetch the report.", fr: "Impossible de récupérer le rapport." },
  diffDialog: { en: "Diff of the proposed improvements", fr: "Diff des améliorations proposées" },
  reportDialog: { en: "Self-improvement report", fr: "Rapport d'auto-amélioration" },
  improvements: { en: "Improvements", fr: "Améliorations" },
  report: { en: "Report", fr: "Rapport" },
  loadingDiff: { en: "Loading the diff…", fr: "Chargement du diff…" },
  loadingReport: { en: "Loading the report…", fr: "Chargement du rapport…" },
  analyzing: { en: "Self-improvement being analyzed", fr: "Auto-amélioration en cours d'analyse" },
  finishedNoCommit: { en: "Self-improvement finished without a commit", fr: "Auto-amélioration terminée sans commit" },
  nothingToMerge: { en: "nothing to merge", fr: "rien à merger" },
  viewReport: { en: "View the report", fr: "Voir le rapport" },
  cleanUp: { en: "Clean up", fr: "Nettoyer" },
  checkingBeforeMerge: { en: "Improvements being checked before an automatic merge", fr: "Améliorations en cours de vérification avant un merge automatique" },
  committedWaiting: { en: "Improvements committed, waiting for the session's report", fr: "Améliorations commitées, en attente du rapport de la session" },
  commits: {
    en: (count: number) => `${count} commit${plural(count, "", "s")}`,
    fr: (count: number) => `${count} commit${plural(count, "", "s")}`,
  },
  mergedAutomatically: { en: "Improvements merged automatically", fr: "Améliorations mergées automatiquement" },
  revert: { en: "Revert", fr: "Annuler" },
  close: { en: "Close", fr: "Fermer" },
  improvementsReady: { en: "Improvements ready", fr: "Améliorations prêtes" },
  realConflict: {
    en: "The automatic rebase on the factory was not enough: this branch has a real conflict. To be reworked by hand.",
    fr: "Le rebase automatique sur la factory n'a pas suffi : cette branche a un vrai conflit. À reprendre à la main.",
  },
  viewChanges: { en: "View changes", fr: "Voir les changements" },
  merge: { en: "Merge", fr: "Merger" },
  dismiss: { en: "Dismiss", fr: "Écarter" },
});
