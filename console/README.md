# Implementation Harness

Interface locale pour piloter la commande `/implementation-harness:implement` avec l’exécutable Claude Code installé sur la machine. Le harnais n’utilise pas directement l’API Anthropic et ne demande aucune clé API. Le [README principal](../README.md#installation-en-une-commande) présente l’installation et l’usage quotidien avec `impl`.

## Prérequis

- Claude Code installé et connecté (`claude --version`)
- Node.js 22.12 ou plus récent
- `glab` installé et authentifié pour accéder aux tickets et merge requests GitLab
- les MCP utilisés par le workflow : Playwright pour les mesures du développeur, la revue design et la QA, Figma quand un ticket fournit des frames

`node-pty` est un module natif. Sur une nouvelle machine, son installation peut nécessiter les outils de compilation du système, par exemple Xcode Command Line Tools sur macOS.

## Lancer la console

Depuis ce dossier :

```bash
npm install
npm run dev
```

Puis ouvrir <http://127.0.0.1:3210>.

Renseigner le chemin local du projet et l’URL du ticket. Plusieurs URL, une par ligne, lancent un lot (voir [Lot de tickets et ordonnancement](#lot-de-tickets-et-ordonnancement)). Le harnais crée un worktree git du projet pour ce run (`<projet>/.claude/worktrees/<id du run>`, voir le [README principal](../README.md#un-worktree-par-run)) et y démarre Claude Code avec le plugin voisin :

```bash
claude --plugin-dir /chemin/vers/implementation-harness "/implementation-harness:implement <ticket>"
```

La commande et les agents restent dans le dossier `implementation-harness`; rien n’est installé dans `~/.claude`.

## Ce que montrent les panneaux

Le panneau de discussion est lu dans le transcript de la session, et Claude Code n’y écrit un message qu’une fois revenue l’action qui l’a suivi. Un paragraphe peut donc y arriver avec une minute de retard sur le terminal, qui est la seule vue en direct. Tant que la session produit de la sortie, le panneau affiche « Claude écrit… » pour dire que le dernier message visible n’est pas le dernier état du run.

Dans un dossier que Claude Code n’a jamais ouvert, la session commence par sa demande de confiance, avant tout hook et tout transcript. La console la reconnaît dans la sortie du terminal et l’affiche dans la conversation comme une décision : « Claude Code demande de faire confiance à ce dossier », le chemin, puis « Faire confiance et continuer » ou « Refuser ». Elle ne répond jamais à ta place, n’écrit dans aucun fichier de configuration de Claude Code et ne passe aucun drapeau qui saute la question : elle tape dans le terminal la réponse que tu as choisie. La carte disparaît dès que la demande n’est plus à l’écran, que tu aies répondu ici ou dans l’onglet Terminal. Un refus ferme la session, et le run finit « Arrêté » avec sa raison, sans incident. La détection est écrite pour le texte de Claude Code 2.1.288 (`server/engine/trust-prompt.ts`) : si une version le reformule, rien ne s’affiche et la réponse se donne dans l’onglet Terminal, comme avant.

Le flux d’activité ne garde que les jalons du workflow : agents, documents, branche, merge request, décisions attendues. Le détail des commandes reste dans le terminal.

Le harnais ne réclame l’attention que quand il est arrêté : une décision attendue, une demande de permission, un incident (plus aucune action en cours, résultat manquant, session interrompue), la fin ou l’échec du run. Un simple silence n’est qu’un doute, signalé une fois.

## Qui peut faire avancer ce run ?

La santé d’un run est une projection à part de son statut (`server/run-health.ts`, logique pure, horloge injectée). Elle ne lit que des signaux structurés : fin de tour du pilote (`Stop`), début et fin des sous-agents, appels d’outils appariés par `tool_use_id` et rattachés à leur agent (`agent_id`), type des notifications (`permission_prompt`, `elicitation_dialog`), appels en arrière-plan (`run_in_background`, `Monitor`), documents archivés, et `workflow-state.json`, que le pilote écrit à chaque transition pour dire ce qu’il attend (contrat dans `commands/implement.md`, section « Workflow state »). La sortie du terminal, un spinner compris, n’est jamais une progression.

| Situation observée | Santé | Ce que montre la console |
|---|---|---|
| Question, confiance du dossier, permission ou saisie attendue | attente | le panneau de question ou de confiance, ou « Ouvrir le terminal » |
| Agent, commande ou tâche de fond au travail | sain ou attente | rien ; au-delà du seuil de silence, un doute |
| Silence prolongé (`IMPL_STALL_MINUTES`, 10 par défaut) | doute | « Aucune progression observée », sans rien arrêter ni relancer |
| Le pilote a rendu la main, rien ne tourne, rien n’est attendu, workflow inachevé | incident après 60 s | « Plus aucune action en cours » |
| Un agent a fini sans le fichier que son contrat exige, et personne n’a pris la suite | incident après 30 s | « Rapport QA attendu », « Plan de test QA attendu », « Inventaire design attendu », « Rapport de T3 attendu »… |
| Aucune tâche restante exécutable (dépendance absente ou circulaire) | incident | « Plan bloqué par ses dépendances » |
| Session sortie avant un résultat, quel que soit son code | interruption | « Session interrompue » |

Les fichiers exigés sont `planner-output.json` pour `ticket-planner`, `qa-report.md`, `qa-evidence.json` et `qa-plan.md` pour `qa-reviewer`, `designer-review.md`, `design-evidence.json` et `design-inventory.md` pour `designer-reviewer`, `review-summary.md` pour `review-orchestrator`.

Une attente déclarée dans `workflow-state.json` ne masque jamais un blocage longtemps : `await_agent` sans agent actif reste une absence de prochaine action, les autres attentes deviennent un doute au seuil de silence. Une fin déclarée n’est prise que si elle tient face au livrable (merge request vue, ou blocages écrits). Sans ce fichier (prompts anciens), le détecteur s’en tient aux hooks et le dit dans son diagnostic. Après une mise en veille de la machine, toutes les grâces repartent du réveil.

Un incident est unique par cause stable (empreinte), notifié une fois, enregistré dans `run.json` et clos seulement sur l’événement qui lève sa cause : le pilote agit de nouveau, le fichier arrive, ou l’utilisateur le classe. Les actions proposées sont seulement celles qui peuvent s’exécuter :

- **Demander la continuation** : session active, pilote au repos, aucun agent, outil, question ni permission en cours. La console soumet à la session existante une instruction qui lui demande de relire le contexte, le plan, les rapports et l’état Git, de garder fichiers et commits, et de ne pas repartir de l’étape 1. L’incident reste ouvert, « continuation demandée », jusqu’à ce que la reprise soit observée.
- **Ouvrir le terminal**, **Arrêter**, **Classer comme faux positif** (avec un motif), et le diagnostic repliable.

Chaque action part avec la révision de l’incident affichée et un identifiant de requête. Le serveur revérifie tout juste avant l’effet, refuse une action décidée sur un état qui a bougé, et n’exécute qu’une fois une requête envoyée par deux fenêtres. La décision est écrite avant l’effet ; après un arrêt entre les deux, elle reste « issue inconnue » et n’est jamais rejouée.

Au redémarrage, un run trouvé en cours reçoit un incident d’interruption, une seule fois, et sa question sans session est gardée comme contexte. Les runs restés avec un incident ouvert apparaissent sous « Interrompus », en lecture seule, par des routes séparées (`/api/archive/…`). Ils n’ont ni session, ni place, ni ticket tenu. Les classer les retire de la liste ; leur archive reste sur disque. Un run sans incident ouvert dont le worktree est encore sur le disque apparaît à part, sous « Worktrees conservés » (voir [Worktree d’un run](#worktree-dun-run)). `/?demo=incident` joue un run dont le pilote rend la main sans suite, pour voir le détecteur et la continuation sans dépôt. `/?demo=batch` joue un lot de trois tickets inventés, dont deux en conflit.

Limites : aucune reprise d’une session Claude Code perdue (le contrat moteur ne le permet pas encore), aucun superviseur LLM, aucun agent recréé automatiquement.

## Preuves par critère d’acceptation

L’onglet Preuves montre ce qui a été vérifié, critère par critère. Il part du registre des critères que le pilote écrit après la clarification (`.claude/tasks/acceptance-criteria.json`), des liens entre tâches et critères du plan (`criterion_ids` dans `planner-output.json`) et des fichiers de preuves (`dev-evidence*.json`, `qa-evidence*.json`, `design-evidence*.json`). Le registre est décrit dans `commands/implement.md` (« Write the acceptance criteria registry »), les fichiers de preuves dans `contracts/` (`evidence.md`, `qa.md`, `design.md`, `pilot-evidence.md`).

Chaque critère prend un état calculé par le serveur (`server/acceptance.ts`), dans cet ordre de priorité :

| État | Quand |
|---|---|
| Échec | un contrôle requis a un résultat négatif sur le code actuel, ou de version inconnue |
| Bloqué | aucun échec, mais un contrôle requis est empêché par un obstacle nommé (`blocker`) |
| Non vérifié | un contrôle n’a pas de preuve, sa preuve est ancienne, de version inconnue, non concluante, confirme une preuve absente, ou un échec antérieur n’a pas été explicitement remplacé |
| Vérifié | chaque contrôle requis a un résultat positif pris sur le code actuel, sans échec restant à côté |

Règles qui en découlent :

- Une tâche « Terminé » dans Suivi veut dire qu’un rapport existe, jamais qu’un critère est vérifié. Un lint ou un typecheck vert reste une vérification générale, rattachée à aucun critère.
- Un succès ne remplace un échec que s’il le nomme dans `supersedes`, contrôle la même chose et a été pris sur le code actuel. Sinon l’échec reste affiché et le critère non vérifié.
- La version du code est l’identifiant que calcule `hooks/code-snapshot.mjs` : l’arbre git du répertoire de travail, fichiers non suivis compris, fichiers ignorés et documents du workflow exclus, calculé dans un index jetable. Commiter l’état mesuré garde le même identifiant, toute modification le change. Le workflow l’appelle via `IMPL_CODE_SNAPSHOT` et chaque appel est journalisé dans `snapshots.jsonl` ; un identifiant absent de ce journal est affiché « Version inconnue ». Le serveur recalcule l’identifiant courant à chaque nouveau document et au plus toutes les 15 secondes quand l’onglet le demande.
- Un résultat que le développeur rapporte sur son propre travail porte la mention « Résultat rapporté » ; une confirmation vaut ce qu’elle confirme, sur la version où cette preuve a été prise.
- Une tentative de mise en échec est un item de preuve QA marqué `"kind": "attempt"`. Quand elle trouve un défaut (`fail`), elle compte contre le critère qu’elle cite. Quand elle ne trouve rien, elle est listée sous ce critère avec la mention « Aucun défaut trouvé », sans couleur verte et sans compter comme vérification. Une tentative seulement lue dans le code est affichée « Lue, non exécutée ». Une tentative qui ne cite aucun critère produit un avertissement dans le diagnostic.
- Le verdict que QA déclare dans `qa-evidence.json` (`status`) apparaît dans la synthèse de l’onglet : « Validé », « Validé avec réserves », « Non concluant » ou « Échec », avec le tour et le mandat s’il y en a un. Le serveur compare ce verdict aux preuves (`qaVerdictConsistency`). Un `PASS` ou `PASS_WITH_WARNINGS` écrit alors qu’un critère n’a aucune observation exécutée par QA sur le code actuel affiche un avertissement qui nomme ces critères. Une confirmation, une tentative et une preuve remplacée ne comptent pas comme observation. Une passe ciblée (`mandate` à la racine du fichier) ne répond que des critères de son mandat.
- Le serveur note la première arrivée de chaque document du run (`artifactArrivals` dans `run.json`). Quand `qa-plan.md` ou `design-inventory.md` n’est pas arrivé avant le rapport correspondant, l’onglet affiche une remarque : rien ne montre que le plan a été écrit en premier. Cette remarque ne change aucun verdict. Ces deux fichiers ne font pas avancer le rail d’étapes, parce qu’un reviewer les écrit avant de commencer.
- Un run sans registre (ancien run resté sur l’ancien contrat) affiche « Traçabilité par critère indisponible pour ce run » et garde ses rapports lisibles. Des critères reconstruits depuis un ancien plan sont signalés comme tels et restent non vérifiés.

`server/evidence-archive.ts` archive chaque version utile de ces fichiers sous un chemin immuable, avec son empreinte et sa date de réception, et copie dans cette version les captures qu’elle cite : une capture remplacée au tour 2 sous le même nom reste distincte de celle du tour 1. Une même preuve vue deux fois (fichier par tâche puis fichier fusionné, copie `-roundN`) compte une fois grâce à son identifiant. Un fichier surpris à moitié écrit devient un diagnostic et la dernière version valide reste en vigueur. Avant de supprimer `.claude/tasks/`, le workflow écrit `archive-sync-request.json` et attend `archive-sync-ack.json` : le serveur a alors tout réarchivé.

Le même calcul produit `acceptance-summary.md` et `acceptance-summary.json`, que le serveur dépose dans `.claude/tasks/` pour la merge request : une phrase de bilan et les critères non vérifiés pour la description, le tableau détaillé pour le commentaire de review. Quand le verdict QA contredit les preuves, la synthèse contient une ligne « Verdict QA à confirmer » et le JSON un champ `qaWarning`. Les captures y sont nommées par leur chemin local et marquées comme telles, parce que le workflow ne les lie dans GitLab qu’après upload.

Limites de cette version : aucune commande n’est encore corrélée à son résultat par les événements du moteur, tout résultat reste donc déclaré par l’agent qui l’écrit ; le serveur ne peut pas vérifier le contenu d’une preuve, seulement sa cohérence et sa version.

## Worktree d’un run

Chaque run de ticket travaille dans son propre worktree git, `<projet>/.claude/worktrees/<id du run>`, que le serveur crée avant d’ouvrir la session. Le [README principal](../README.md#un-worktree-par-run) décrit ce que le worktree reçoit du checkout principal. Le mode démo n’en crée pas.

Plusieurs tickets d’un même dépôt tournent en parallèle. Le verrou porte sur le couple dépôt et ticket : un second lancement sur un ticket déjà en cours part en file d’attente avec la raison « ticket déjà en cours », et démarre quand le run qui tient ce ticket a rendu sa session. `IMPL_MAX_CONCURRENT_RUNS` borne toujours le nombre total de sessions. Deux tickets d’un lot que l’analyse juge en conflit ne tournent pas ensemble (voir [Lot de tickets et ordonnancement](#lot-de-tickets-et-ordonnancement)).

Deux réglages décident de ce que le worktree reprend du checkout principal :

| Variable | Effet | Défaut |
|---|---|---|
| `IMPL_WORKTREE_DEPENDENCY_DIRS` | noms des dossiers de dépendances ignorés par Git, repris à toute profondeur : copiés en copy-on-write, liés par un lien symbolique si la copie échoue | `node_modules` |
| `IMPL_WORKTREE_COPY_FILES` | fichiers copiés : un motif de nom comme `.env*` pour des fichiers ignorés par Git, ou un chemin depuis la racine du dépôt | `.env*,.claude/settings.local.json` |

La session reçoit `IMPL_RUN_WORKTREE`, `IMPL_SOURCE_REPOSITORY`, `IMPL_SOURCE_BRANCH` (absente quand le checkout principal est sur un HEAD détaché) et `IMPL_WORKTREE_DEPENDENCIES` : `symlink` dès qu’un dossier de dépendances est lié, `clone` quand tous sont copiés, absente quand aucun n’a été repris.

Une fois la session fermée, le serveur décide du sort du worktree (`worktreeRemoval` dans `server/domain.ts`, logique pure). Il le supprime seul quand le run est terminé, que la merge request existe et n’est pas en draft, que le workflow n’est pas bloqué, que l’archive des preuves a été confirmée, que l’arbre est propre et que HEAD est sur une branche du remote. Sinon l’état du run passe à « Worktree conservé » avec la raison. La branche n’est jamais supprimée.

Un worktree conservé se supprime depuis la vue du run, avec le bouton **Supprimer le worktree**, dès que la session est fermée. La page envoie `worktree.remove` et reçoit `worktree.result` : `removed`, `refused` avec le motif, ou `confirm` avec ce qui serait perdu (changements non commités, changements non poussés). La suppression n’a alors lieu qu’après confirmation. Le serveur ne supprime qu’un chemin placé directement sous `.claude/worktrees/`.

Un run fermé ou relu après un redémarrage reste listé sous « Worktrees conservés » tant que son worktree est sur le disque. Au démarrage, avant de lister les archives, le serveur applique les mêmes règles aux worktrees des runs précédents. Un worktree dont la session a été coupée par l’arrêt de la console est marqué conservé à l’arrêt, et son sort est décidé au démarrage suivant.

## Lot de tickets et ordonnancement

Le [README principal](../README.md#lancer-plusieurs-tickets-dun-coup) décrit l’usage : coller un lot, lire la file, forcer un départ. Cette section décrit ce que fait le serveur.

### Entrée du lot

Dès que le champ du ticket contient deux URL, le formulaire envoie `batch.submit` (`issueUrls`, `instruction`). `lib/ticket-urls.ts` lit le collage de la même façon dans le formulaire et sur le serveur. `server/ticket-source.ts` résout chaque URL vers son checkout principal. C’est le seul module qui sait que le lot a été collé, et l’endroit où brancher plus tard une récupération par labels ou assignee. Une URL invalide ou un ticket sans checkout refuse le lot entier.

Le registre reçoit une liste de tickets résolus (`enqueueBatch`). Il écarte ceux qu’il a déjà, sur la clé dépôt et ticket, les autres entrent en file sous un même `batchId`, et la page reçoit `batch.result` (`accepted`, `duplicates`).

### Analyse

Pour chaque dépôt qui a au moins deux nouveaux tickets, ou un nouveau ticket à côté de prédictions déjà connues, `server/schedule-analysis.ts` écrit `input.json` dans le dossier d’analyse (`scheduleRoot`, voir plus bas) et demande au moteur une session sans terminal (`startSchedule`) :

```bash
claude -p --plugin-dir <plugin> --model sonnet --permission-mode dontAsk \
  --allowedTools "<liste fermée, en lecture>" -- "/implementation-harness:schedule <entrée> <sortie>"
```

La liste complète des arguments est dans `scheduleArguments` (`server/engine/claude-code.ts`). La session tourne dans le checkout principal, sans les variables des hooks, donc elle ne remonte rien à la console. Son code de sortie n’est pas lu. Le serveur juge le résultat sur `output.json`, validé en bloc contre `contracts/schedule.md` (`validateSchedule` dans `server/domain.ts`). Les analyses d’un même dépôt passent l’une après l’autre, hors de `IMPL_MAX_CONCURRENT_RUNS`.

| Issue de l’analyse | Effet |
|---|---|
| Fichier valide | les prédictions et les arêtes sont gardées, le dossier d’analyse est supprimé |
| Fichier absent, illisible ou refusé | tickets marqués « Analyse en échec », en conflit avec tous les tickets de leur dépôt |
| Délai dépassé (`IMPL_SCHEDULE_TIMEOUT_MINUTES`, 5 par défaut) | session tuée, même repli |
| Console arrêtée pendant l’analyse | même repli au démarrage suivant |
| Confiance `low` sur un ticket | « Prédiction peu fiable », ce ticket passe seul sur son dépôt |

Les tickets en échec d’analyse encore en file, en cours ou en attente de merge repartent dans l’analyse suivante de leur dépôt, comme tickets à prédire et non comme `known`. Leur prédiction est remplacée si elle réussit, et ils restent en échec sinon. Aucune analyse n’est ouverte pour eux seuls.

Chaque analyse a son dossier `<id>/` sous `scheduleRoot` (`server/config.ts`). Quand le dossier de données est dans le plugin, `scheduleRoot` est `implementation-harness-<utilisateur>/schedule/` sous le dossier temporaire du système, réservé à l’utilisateur : Claude Code refuse à une session toute écriture dans le dossier du plugin qu’elle a chargé. Un dossier de données hors du plugin (`IMPL_DATA_DIR`) les garde sous `schedule/`. Après un échec, le dossier d’analyse reste avec `session.log`, la fin de la sortie de la session. `scheduleRoot` est vidé à chaque démarrage. Ces fichiers contiennent du contenu de tickets.

### Raisons d’attente

`describeQueue` (`server/domain.ts`, logique pure) donne à chaque entrée de la file sa raison, dans cet ordre :

| `reason` | Ligne affichée | Quand |
|---|---|---|
| `ticket` | « En attente, ticket déjà en cours » | un run tient le même ticket |
| `slot` | « Départ forcé, dès qu’une place est libre » ou « Départ empilé sur … » | l’entrée a été forcée |
| `analysis` | « Analyse en cours » | la session d’analyse n’a pas répondu |
| `conflict` | « En attente, conflit avec #217 en cours » | un run en cours est en conflit |
| `merge` | « Attend que la MR !12 soit mergée (#217) » | la merge request d’un run fini est ouverte |
| `merge_unknown` | « État de la MR !12 inconnu (#217) » | GitLab n’a pas pu être interrogé |
| `dependency` | « Dépend de #217, encore en file » | une arête `depends_on` vers une entrée devant elle |
| `order` | « Passe après #217 » | un autre conflit avec une entrée devant elle |
| `slot` | « En attente, toutes les places sont prises » | rien d’autre ne la retient |

`cause` dit pourquoi deux tickets sont séparés : `overlap`, `depends_on`, `analysis_failed` ou `low_confidence`. `detail` porte la phrase de l’agent, ou celle du serveur pour les deux dernières causes, qui dit si l’analyse en échec ou la prédiction peu fiable est celle du ticket qui attend ou celle de l’autre. Seules les entrées `slot` démarrent (`startableEntries`), dans la limite des places libres. Une entrée retenue n’occupe pas de place et celles qui la suivent passent devant.

### Veille des merge requests

Quand un run ordonnancé se termine avec une merge request, le registre garde une veille (`MergeWatch`) et les tickets en conflit attendent le merge. `server/merge-watch.ts` interroge GitLab avec `fetchMergeRequestStatus` (`server/ticket.ts`) :

```bash
glab api --hostname <hôte> projects/<projet>/merge_requests/<iid>
```

C’est un appel du serveur Node. **Il n’ouvre aucune session Claude et ne consomme aucun token.** Il part toutes les `IMPL_MERGE_POLL_MS` millisecondes (60 000 par défaut, variable d’environnement hors `impl config`), une fois par merge request et par intervalle, et seulement pour les veilles qui retiennent une entrée de la file. Sans ticket en attente, il n’y a ni minuteur ni appel.

| Réponse | Effet |
|---|---|
| `merged` | la veille est levée, les tickets retenus repartent, bandeau « Merge request mergée » |
| `closed` | même libération, bandeau « Merge request fermée sans être mergée » |
| `opened`, `locked` | le ticket continue d’attendre |
| échec de `glab` (réseau, jeton, binaire absent) | état inconnu, le ticket reste retenu et la ligne passe en orange |

Un run qui se termine sans merge request libère tout de suite les tickets qui l’attendaient. Une veille que plus rien n’attend est oubliée au bout d’une semaine.

### Actions sur la file

| Message | Effet |
|---|---|
| `queue.force`, `mode: "base"` | l’entrée ignore l’ordonnancement et part de la branche de base dès qu’une place est libre |
| `queue.force`, `mode: "stacked"` | l’entrée part de la branche du ticket qu’elle attend ; la session reçoit `IMPL_BASE_BRANCH` et sa merge request cible cette branche. Refusé tant que cette branche n’est pas connue |
| `queue.move` | place l’entrée avant une autre, ou en fin de file (`before: null`). Une dépendance passe toujours avant le ticket qui en a besoin |
| `queue.cancel` | retire l’entrée |

Une entrée forcée reste soumise au verrou par ticket et au nombre de places.

### Persistance

`data/queue.json` contient `{ version: 2, queue, tickets, edges, watches }`. Il est écrit en entier puis renommé. L’ancien format, un simple tableau de lancements, se charge toujours. Au démarrage, les entrées qui n’attendaient qu’une place repartent, celles qui attendent une merge request continuent de l’attendre. Rien du mode démo n’y est écrit.

### Limites

Aucun essai sur une vraie instance GitLab n’a encore eu lieu. Les tests unitaires injectent les réponses, et la suite d’intégration remplace `claude` et `glab` par les simulateurs de `tests/fake-claude/`. La commande `/implementation-harness:schedule` a été lancée en vrai sur un lot vide et sur une URL inventée (voir `docs/engineering-workflow.md`), sans ticket réel. L’appel `glab api` de la veille et le départ empilé n’ont tourné que contre ces simulateurs.

## Architecture du serveur

| Module | Rôle |
|---|---|
| `server/index.ts` | serveur HTTP et WebSocket, cycle de vie du run |
| `server/registry.ts` | runs tenus, file d’attente, verrou par ticket et nombre de sessions, état de l’ordonnancement |
| `server/ticket-source.ts` | d’où vient un lot : aujourd’hui des URL collées, résolues vers leur checkout |
| `server/schedule-analysis.ts` | une session d’analyse par dépôt, jugée sur son fichier de sortie |
| `server/merge-watch.ts` | minuteur qui lit l’état des merge requests attendues, sans session Claude |
| `server/ticket.ts` | appels `glab api` : titre d’un ticket, état d’une merge request |
| `server/run-worktrees.ts` | worktree d’un run, de sa création à sa suppression, et réconciliation au démarrage |
| `server/worktree.ts` | appels git : worktrees des runs et worktrees d’auto-amélioration |
| `server/engine/` | **la seule partie qui sait quel agent est piloté** (voir son README) |
| `server/hooks.ts` | applique les événements du moteur à l’état du run |
| `server/session-prompt.ts` | la demande de confiance du dossier : affichée, répondue, partie d’elle-même, refusée |
| `server/transcript.ts` | suit le fichier de dialogue de la session |
| `server/artifacts.ts` | archive les documents produits avant leur nettoyage |
| `server/acceptance.ts` | couverture des critères d’acceptation, cohérence du verdict QA, logique pure, et synthèse de merge request |
| `server/evidence-archive.ts` | versions immuables des registres, plans, preuves et captures d’un run |
| `server/acceptance-runtime.ts` | ingestion, identification du code, recalcul et synthèse remise au workflow |
| `server/run-health.ts` | qui peut faire avancer un run : signaux, matrice de détection, logique pure |
| `server/run-incidents.ts` | vie d’un incident, validation des actions, lecture des archives, logique pure |
| `server/run-monitor.ts` | ordonnanceur unique de la santé des runs vivants |
| `server/run-archive.ts` | runs d’un processus précédent restés avec un incident ou un worktree sur le disque, en lecture seule, hors suppression du worktree |
| `server/workflow-state.ts` | lecture de `workflow-state.json` et vérification d’une fin déclarée |
| `server/self-improvement.ts` | retours, auto-audit et boucle d’amélioration |
| `server/domain.ts` | logique pure, sans agent ni système de fichiers |

`server/domain.ts` et `server/engine/` sont les deux endroits testables sans rien lancer, et la plus grande part de la logique s’y trouve.

## Copier sur une autre machine

Copier ou cloner le dossier `implementation-harness` complet, puis exécuter les commandes d’installation ci-dessus dans `implementation-harness/console`. Le chemin du dépôt traité est choisi dans l’interface, il peut donc être différent sur chaque machine.

## Données locales

Chaque exécution est conservée dans `console/data/runs/<run-id>/` :

- `run.json` contient l’état, les agents et le journal d’activité;
- `terminal.log` contient la sortie brute du terminal;
- `artifacts/` reçoit une copie des documents produits dans `.claude/tasks/` avant leur nettoyage. Seuls les documents lisibles y sont copiés : les captures et les assets téléchargés restent dans le worktree du run, sous `.claude/tasks/assets/`, sauf celles qu’un fichier de preuves cite;
- `evidence/` garde chaque version du registre, du plan et des fichiers de preuves (`<fichier>/v<n>.json`), les captures de chaque version (`<fichier>/v<n>/assets/…`) et leur index (`index.json`);
- `acceptance/` contient la dernière synthèse de couverture, en Markdown et en JSON;
- `snapshots.jsonl` journalise chaque identifiant de code pris par la session.

`run.json` est écrit en entier puis renommé, une écriture après l’autre. Une lecture ne voit donc jamais un fichier à moitié écrit, et le dernier état publié est celui qui reste.

`data/queue.json` garde la file et son ordonnancement. Les fichiers d’une analyse de lot en cours ou en échec sont hors du plugin, dans le dossier d’analyse décrit plus haut.

Le dossier `data/` est ignoré par Git.

Au démarrage, le serveur referme tout run resté sur un statut non terminal (`starting`, `running`, `attention`). `ctx.state` repart vide à chaque lancement, donc un run que le processus précédent n’a pas pu clore lui-même (arrêt brutal, `impl restart`) resterait sinon marqué `running`. Le serveur le reclasse `failed` avec un message qui l’explique, distinct d’un échec de l’agent.
