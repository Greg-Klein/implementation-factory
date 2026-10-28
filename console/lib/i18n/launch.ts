import { defineTexts } from "./index";

const plural = (count: number, one: string, many: string) => (count > 1 ? many : one);

export const launch = defineTexts({
  projectDirectory: { en: "Project directory", fr: "Répertoire du projet" },
  optional: { en: "optional", fr: "facultatif" },
  detecting: { en: "Detecting…", fr: "Détection…" },
  project: { en: (project: string) => `Project · ${project}`, fr: (project: string) => `Projet · ${project}` },
  directoryPlaceholder: { en: "Detected from the ticket, or start typing…", fr: "Détecté depuis le ticket, ou commencez à saisir…" },
  runtimeRecipe: { en: "Runtime recipe", fr: "Recette d'exécution" },
  runtimeRecipeTitle: {
    en: "What the factory keeps to start the application of this repository",
    fr: "Ce que la factory garde pour démarrer l'application de ce dépôt",
  },
  notFound: { en: "Not found", fr: "Introuvable" },
  noRepositoryMatches: { en: "No declared repository matches.", fr: "Aucun dépôt déclaré ne correspond." },

  noTicketRecognized: { en: "No ticket recognized", fr: "Aucun ticket reconnu" },
  ticketsRecognized: {
    en: (count: number) => `${count} ticket${plural(count, "", "s")} recognized`,
    fr: (count: number) => `${count} ticket${plural(count, "", "s")} ${plural(count, "reconnu", "reconnus")}`,
  },
  duplicatesSkipped: {
    en: (count: number) => `${count} duplicate${plural(count, "", "s")} skipped`,
    fr: (count: number) => `${count} doublon${plural(count, "", "s")} ${plural(count, "ignoré", "ignorés")}`,
  },
  line: { en: (line: number) => `Line ${line}:`, fr: (line: number) => `Ligne ${line} :` },
  notATicketUrl: { en: "is not a GitLab or GitHub ticket URL.", fr: "n'est pas une URL de ticket GitLab ou GitHub." },

  eyebrow: { en: "New run", fr: "Nouveau run" },
  headline: { en: "From ticket to merge request,", fr: "Du ticket à la merge request," },
  headlineTail: { en: "without losing the thread.", fr: "sans perdre le fil." },
  intro: {
    en: "Start your usual Claude Code workflow. Agents, generated documents and reviews show up here while the terminal stays fully interactive.",
    fr: "Lancez votre workflow Claude Code habituel. Les agents, les documents générés et les reviews apparaissent ici pendant que le terminal reste entièrement interactif.",
  },
  agents: { en: "6 specialized agents", fr: "6 agents spécialisés" },
  localHistory: { en: "Local history", fr: "Historique local" },
  configureTitle: { en: "Configure the run", fr: "Configurer le run" },
  configureHint: { en: "The command will run in the chosen project.", fr: "La commande s'exécutera dans le projet choisi." },
  ticket: { en: "Ticket", fr: "Ticket" },
  ticketHint: { en: "GitLab or GitHub · one per line to start several", fr: "GitLab ou GitHub · un par ligne pour en lancer plusieurs" },
  ticketPlaceholder: {
    en: "https://gitlab.com/…/-/issues/217 or https://github.com/…/issues/217",
    fr: "https://gitlab.com/…/-/issues/217 ou https://github.com/…/issues/217",
  },
  batchRepositories: {
    en: "The repository of each ticket is detected from its URL. Tickets of the same repository are compared before they start: those that touch the same code run one after the other.",
    fr: "Le dépôt de chaque ticket est détecté depuis son URL. Les tickets d'un même dépôt sont comparés avant de démarrer : ceux qui touchent le même code tournent l'un après l'autre.",
  },
  mergeRequestRepositories: { en: "Merge request repositories", fr: "Dépôts des merge requests" },
  noCheckoutOf: {
    en: (project: string) => `No checkout of ${project}. Choose where the change goes: each repository gets its own run and merge request.`,
    fr: (project: string) => `Aucun checkout de ${project}. Choisissez où va le changement : chaque dépôt a son propre run et sa propre merge request.`,
  },
  withoutCheckoutGroup: { en: "Tickets without a checkout", fr: "Tickets sans checkout" },
  noCheckoutFound: {
    en: (count: number) => `No checkout was found for ${plural(count, "this ticket", "these tickets")}. Choose where the merge requests go, then start again.`,
    fr: (count: number) => `Aucun checkout trouvé pour ${plural(count, "ce ticket", "ces tickets")}. Choisissez où vont les merge requests, puis relancez.`,
  },
  ticketOf: { en: (project: string) => `Ticket of ${project}`, fr: (project: string) => `Ticket de ${project}` },
  specialInstruction: { en: "Special instruction", fr: "Instruction particulière" },
  instructionBatch: { en: "optional, applied to every ticket of the batch", fr: "facultative, appliquée à chaque ticket du batch" },
  instructionPlaceholder: { en: "Desktop only, do not touch tracking…", fr: "Desktop uniquement, ne pas toucher au tracking…" },
  startTickets: { en: (count: number) => `Start ${count} tickets`, fr: (count: number) => `Lancer ${count} tickets` },
  startInRepositories: { en: (count: number) => `Start in ${count} repositories`, fr: (count: number) => `Lancer dans ${count} dépôts` },
  startImplementation: { en: "Start implementation", fr: "Lancer l'implémentation" },

  chosenRepositories: { en: "Chosen repositories", fr: "Dépôts choisis" },
  removeTarget: { en: (name: string) => `Remove ${name}`, fr: (name: string) => `Retirer ${name}` },
  addAnother: { en: "Add another repository…", fr: "Ajouter un autre dépôt…" },
  searchRepository: { en: "Search a repository or type its path…", fr: "Chercher un dépôt ou saisir son chemin…" },

  recipeDialog: { en: "Runtime recipe", fr: "Recette d'exécution" },
  close: { en: "Close", fr: "Fermer" },
  readingRecipe: { en: "Reading the recipe…", fr: "Lecture de la recette…" },
  noRecipe: {
    en: "No recipe for this repository. The next run that starts its application will write one.",
    fr: "Pas de recette pour ce dépôt. Le prochain run qui démarre son application en écrira une.",
  },
  recipeReadError: { en: "Could not read the recipe.", fr: "Impossible de lire la recette." },
  findingsReadError: { en: "Could not read the review findings.", fr: "Impossible de lire les findings de review." },
  reviewFindings: { en: "Review findings", fr: "Findings de review" },
  readingFindings: { en: "Reading the findings…", fr: "Lecture des findings…" },
  noneKept: {
    en: "None kept for this repository. The senior review of its next run will leave its findings here.",
    fr: "Aucun conservé pour ce dépôt. La review senior de son prochain run y laissera ses findings.",
  },
  findingsKept: {
    en: (findings: number, tickets: number) => `${findings} ${findings > 1 ? "findings" : "finding"} kept from ${tickets} ${tickets > 1 ? "tickets" : "ticket"}. A kind of defect found on two tickets or more in the last 90 days is handed to the developers of the next run.`,
    fr: (findings: number, tickets: number) => `${findings} ${findings > 1 ? "findings conservés" : "finding conservé"} sur ${tickets} ${tickets > 1 ? "tickets" : "ticket"}. Un type de défaut trouvé sur deux tickets ou plus ces 90 derniers jours est transmis aux développeurs du prochain run.`,
  },
  forgetFindings: { en: "Forget the findings", fr: "Oublier les findings" },
  forgetFindingsTitle: {
    en: "The next run of this repository will be told of no recurring defect. A run already going keeps the list it was handed.",
    fr: "Le prochain run de ce dépôt ne recevra aucun défaut récurrent. Un run déjà en cours garde la liste qu'il a reçue.",
  },
  nothingRecurs: { en: "Nothing recurs yet: no kind of defect was found on two tickets.", fr: "Rien ne revient pour l'instant : aucun type de défaut n'a été trouvé sur deux tickets." },
  groupCounts: {
    en: (category: string, findings: number, tickets: number) => `${category} · ${findings} findings on ${tickets} tickets`,
    fr: (category: string, findings: number, tickets: number) => `${category} · ${findings} findings sur ${tickets} tickets`,
  },
  writtenBy: {
    en: (date: string) => `Written by a run on ${date}. It is handed to every run of this repository, which checks and corrects it.`,
    fr: (date: string) => `Écrite par un run le ${date}. Elle est transmise à chaque run de ce dépôt, qui la vérifie et la corrige.`,
  },
  recipeSays: { en: "It says how to start the application, log in and reach a screen.", fr: "Elle explique comment démarrer l'application, se connecter et atteindre un écran." },
  forgetRecipe: { en: "Forget the recipe", fr: "Oublier la recette" },
  forgetRecipeTitle: {
    en: "The next run of this repository will start without a recipe and write a new one. A run already going keeps its own.",
    fr: "Le prochain run de ce dépôt démarrera sans recette et en écrira une nouvelle. Un run déjà en cours garde la sienne.",
  },
  sourceFixes: { en: "Source fixes", fr: "Corrections à la source" },
  readingFixes: { en: "Reading source fixes…", fr: "Lecture des corrections…" },
  noFixes: {
    en: "None proposed. When a kind of defect comes back across enough runs, a fix for the repository is proposed here and written only if you accept it.",
    fr: "Aucune proposée. Quand un type de défaut revient sur assez de runs, une correction pour le dépôt est proposée ici et n'est écrite que si vous l'acceptez.",
  },
  fixesIntro: {
    en: "A kind of defect that came back across runs. Accepting writes the block below into the repository for you to review and commit. Nothing is written until you do.",
    fr: "Un type de défaut revenu sur plusieurs runs. Accepter écrit le bloc ci-dessous dans le dépôt, à vous de le relire et de le committer. Rien n'est écrit tant que vous n'acceptez pas.",
  },
  fixCounts: {
    en: (category: string, runs: number, targetFile: string, tool: string | undefined) => `${category} · ${runs} runs · ${targetFile}${tool ? ` · ${tool}` : ""}`,
    fr: (category: string, runs: number, targetFile: string, tool: string | undefined) => `${category} · ${runs} runs · ${targetFile}${tool ? ` · ${tool}` : ""}`,
  },
  acceptFix: { en: "Accept the fix", fr: "Accepter la correction" },
  dismissFix: { en: "Dismiss the fix", fr: "Écarter la correction" },
  fixSettled: {
    en: "On the branch. Developers are no longer told about this kind of defect.",
    fr: "Sur la branche. Les développeurs ne sont plus informés de ce type de défaut.",
  },
  fixAdded: {
    en: (targetFile: string) => `Added to ${targetFile}. Developers keep hearing about it until that change is on the branch new runs start from.`,
    fr: (targetFile: string) => `Ajoutée à ${targetFile}. Les développeurs en entendent encore parler tant que ce changement n'est pas sur la branche d'où partent les nouveaux runs.`,
  },
  fixDismissed: { en: "Dismissed. It will not be proposed again.", fr: "Écartée. Elle ne sera plus proposée." },
});
