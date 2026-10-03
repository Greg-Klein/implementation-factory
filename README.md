# Implementation Harness

Implementation Harness est une interface locale pour piloter Claude Code pendant l’implémentation d’un ticket GitLab. On colle l’URL du ticket, le harnais détecte le checkout correspondant, crée un worktree git pour ce run, y ouvre un terminal Claude Code et rend visibles la progression, les agents, les outils et les livrables. On peut aussi coller plusieurs tickets d’un coup : le harnais les met en file et retient ceux qui toucheraient le même code.

Le dépôt contient un plugin Claude Code dont la commande `/implementation-harness:implement` orchestre le travail : lecture du ticket, questions de clarification, planification, implémentation, tests, revues spécialisées et préparation de la merge request. Le harnais est la couche visuelle de cette commande. Il utilise la connexion Claude Code déjà présente sur la machine et ne fait aucun appel direct à l’API Anthropic.

L’interface s’ouvre dans le navigateur avec la commande `impl`, qui sert la version compilée du checkout. Il n’y a pas d’application de bureau. Le harnais tourne depuis son propre dépôt, ce qui permet à la boucle d’auto-amélioration de modifier le code qui s’exécute.

## Organisation des agents et skills

Les agents définissent les responsabilités et les livrables. Les skills contiennent les méthodes, chargées selon le besoin. L’autovérification du développeur et la revue contradictoire suivent des démarches distinctes et partagent la collecte de preuves. Les formats que la console lit restent dans des contrats dédiés.

Six agents portent un run :

| Agent | Rôle |
|---|---|
| `ticket-planner` | transforme le ticket et le code actuel en plan de tâches, avec hypothèses, dépendances, risques et étapes de vérification |
| `developer` | implémente une tâche et vérifie son propre travail |
| `senior-reviewer` | revue de code indépendante, puis corrections justifiées dans le périmètre autorisé |
| `designer-reviewer` | revue design d’un changement visible dans l’interface, avec ou sans Figma, sans lire le code du produit |
| `qa-reviewer` | validation indépendante du comportement final, sans modifier le code livré |
| `review-orchestrator` | enchaîne les revues, route les corrections et écrit la synthèse de revue |

Un septième agent, `ticket-scheduler`, ne participe à aucun run. La console l’appelle avant le démarrage d’un lot pour prédire ce que chaque ticket toucherait (voir [Lancer plusieurs tickets d’un coup](#lancer-plusieurs-tickets-dun-coup)).

Le pilote choisit un niveau de revue d’après la taille du diff :

- niveau 0 : un seul passage de `senior-reviewer`, sans orchestrateur ni boucle de reprise, pendant que le pilote lance lui-même les contrôles généraux (lint, typecheck, tests);
- niveau 1 : `senior-reviewer`, puis `designer-reviewer` si le pilote a déclenché la revue design et que l’application est joignable, puis `qa-reviewer`, une fois chacun;
- niveau 2 : `review-orchestrator` conduit la boucle complète. `senior-reviewer` et `qa-reviewer` y gardent leur modèle par défaut, Opus. Aux niveaux 0 et 1, le pilote les appelle avec Sonnet. `designer-reviewer` tourne sur Sonnet à tous les niveaux.

La QA écrit son plan de test dans `qa-plan.md` avant d’ouvrir les rapports de l’auteur, puis tente de mettre chaque critère en échec. Elle ne déclare un critère tenu que sur une observation qu’elle a exécutée elle-même. Quand un critère reste sans observation, le verdict est `INCONCLUSIVE` et la merge request part en draft, avec ces critères nommés.

La revue design fonctionne sans Figma. Avec des frames Figma, elle a lieu dès que le changement est visible dans l’interface. Sans Figma, le pilote ne la déclenche que si le diff modifie un composant d’interface partagé ou crée un écran ou une route. Elle juge le changement contre la meilleure référence disponible : les frames Figma (`figma`), les maquettes jointes au ticket (`ticket-mockup`) ou les écrans déjà livrés de l’application (`live-neighbours`). Elle écrit son inventaire dans `design-inventory.md` avant de lire les mesures du développeur. Un verdict design `INCONCLUSIVE` ne bloque pas la livraison. La merge request, le commentaire de review et le rapport final le signalent par la mention « design non vérifié », avec la raison.

Voir [Agents, skills et revue indépendante](docs/engineering-workflow.md) pour les capacités, les déclencheurs, la transmission du contexte, les méthodes de revue et les vérifications. Le [schéma de fonctionnement](docs/architecture.html) montre en une page le trajet d’un run, le workflow, la santé des runs, l’ordonnancement d’un lot et la boucle d’auto-amélioration. C’est un fichier HTML autonome, à ouvrir dans un navigateur depuis le checkout.

## Installation en une commande

Prérequis :

- macOS ou Linux;
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installé et connecté;
- Node.js 22.12 ou plus récent;
- `git` et [`glab`](https://gitlab.com/gitlab-org/cli) installé et authentifié.

Exécuter :

```bash
curl -fsSL https://raw.githubusercontent.com/Greg-Klein/implementation-harness/main/install-remote.sh | bash
```

La même commande met à jour une installation existante avec un `git pull --ff-only`. L’installation compile l’interface Next.js, puis `impl` lance cette version de production.

L’installateur télécharge les dépendances et crée deux commandes dans `~/.local/bin` :

- `impl`, l’alias court;
- `implementation-harness`, le nom explicite.

Si `~/.local/bin` n’est pas encore dans `PATH`, l’installateur affiche la ligne à ajouter à la configuration du shell.

## Utilisation

```bash
impl
```

| Commande | Effet |
|---|---|
| `impl` | démarre l’interface et ouvre le navigateur |
| `impl demo` | démarre l’interface sur un scénario simulé |
| `impl restart` | arrête le serveur en cours puis relance la version compilée |
| `impl stop` | arrête le serveur en cours |
| `impl status` | indique si un serveur écoute et s’il sert le build sur disque |
| `impl config` | lit et modifie la configuration locale |
| `impl improve` | traite les retours d’auto-amélioration avec Claude Code |
| `impl help` | affiche l’aide |

Une commande inconnue est refusée avec l’aide et un code de sortie non nul, plutôt que de démarrer le serveur en silence.

`impl status` interroge `/api/runs`, puis demande au serveur chaque ressource `/_next/static/` que la page référence. Un serveur qui tourne encore sur un build précédent répond avec un manifeste dont la recompilation a effacé les fichiers, ce qui produit une page sans style. Ses codes de sortie : `0` en écoute et cohérent, `1` en écoute mais incohérent, `3` arrêté.

```console
$ impl status
Serveur   : en écoute sur http://127.0.0.1:3210 (PID 76579)
Build     : caiz9bak8t_BsOXSZHCmN sur disque
API       : répond
Runs      : 2/3 places occupées, 3 affiché(s), 1 en file
Ressources: 11 servies, build à jour
```

Pour découvrir l’interface sans ticket ni appel à Claude Code :

```bash
impl demo
```

Cette commande ouvre un scénario local simulé avec progression, agents, documents générés et décisions interactives. Chaque étape dure cinq secondes. La première review demande des corrections, renvoie le travail à l’agent d’implémentation, puis une seconde review valide les changements. L’onglet Preuves y montre cinq critères dans tous les états possibles, dont un échec du premier tour remplacé au second et conservé dans l’historique avec sa capture. Elle ne modifie aucun dépôt, ne contacte pas GitLab et n’alimente pas la boucle d’auto-amélioration. Deux autres scénarios s’ouvrent par l’adresse, sur un serveur déjà lancé : `/?demo=incident` joue un run dont le pilote rend la main sans suite, et `/?demo=batch` un lot de trois tickets inventés dont deux touchent le même code. Le mode démo n’ajoute aucun contrôle à l’interface normale : la validation des améliorations et le champ de retour sont affichés comme en usage réel, marqués `démo`, et leurs actions restent simulées.

Pour redémarrer un serveur déjà lancé :

```bash
impl restart
```

`impl` détecte un harnais déjà en écoute et se contente d’ouvrir le navigateur. Après une recompilation de l’interface, le serveur en cours sert encore l’ancien manifeste Next.js, les feuilles de style renvoient une erreur et la page s’affiche sans style. `impl restart` arrête le serveur du port courant, attend la libération du port et relance la version compilée. Il se combine avec le mode démo (`impl restart demo`) et n’arrête rien si son argument est invalide.

Le navigateur s’ouvre sur <http://127.0.0.1:3210>.

## Piloter les runs

Dans la console :

1. coller l’URL du ticket GitLab, ou plusieurs URL, une par ligne (voir [Lancer plusieurs tickets d’un coup](#lancer-plusieurs-tickets-dun-coup));
2. vérifier le projet détecté ou renseigner son chemin;
3. ajouter si nécessaire une instruction propre à cette exécution;
4. lancer le workflow et répondre aux décisions dans le panneau dédié ou échanger librement dans le terminal.

### Plusieurs runs en parallèle

Le harnais tient plusieurs runs à la fois. La colonne de gauche les liste, du plus récent au plus ancien, et le run sélectionné s’affiche à droite. Chaque ligne donne le dépôt et le ticket, l’étape atteinte, ce que fait l’agent à cet instant, et une pastille orange quand une décision attend une réponse. Le bouton **+** en haut de la liste ramène au formulaire de lancement sans interrompre les runs en cours.

Plusieurs tickets du même dépôt peuvent tourner en même temps, parce que chaque run travaille dans son propre worktree (voir [Un worktree par run](#un-worktree-par-run)). Deux limites encadrent le parallélisme, et l’ordonnancement d’un lot en ajoute une troisième, décrite plus bas :

- **un seul run par ticket d’un dépôt.** Deux sessions sur le même ticket se disputeraient sa branche et sa merge request;
- **`IMPL_MAX_CONCURRENT_RUNS` sessions au total** (3 par défaut). Chacune est une vraie session Claude Code, avec son quota et son CPU.

Un lancement qui bute sur l’une des deux part en file d’attente, visible sous la liste avec la raison de l’attente, « ticket déjà en cours » ou « toutes les places sont prises ». Il démarre seul dès que le ticket ou une place se libère. La file est enregistrée dans `queue.json`, sous le [dossier de données](#configuration), avec l’ordonnancement qui la retient, et survit à un redémarrage. Les demandes qui n’attendaient qu’une place démarrent dès que le serveur écoute à nouveau, sans que personne ne les relance. Celles qui attendent une merge request continuent de l’attendre. Une croix retire une demande de la file.

Un run terminé dont la session est encore ouverte garde sa place et son ticket. Le bouton **Libérer la place** ferme cette session et laisse la file avancer. Quand un lancement en file attend ce ticket ou cette place, le harnais ferme cette session de lui-même. Une fois la session fermée, l’icône corbeille de sa ligne, ou le bouton **Fermer** de la vue, retire le run de la liste. Ses documents, sa conversation et son journal restent archivés dans `runs/<id>/`, sous le dossier de données.

Les notifications, le titre de l’onglet et son icône couvrent tous les runs à la fois, parce que le run qui réclame une réponse est rarement celui qu’on regarde. Les messages qui ne concernent aucun run en particulier (une demande mise en file, une amélioration rebasée) s’affichent dans un bandeau sous l’en-tête.

L’onglet **Suivi** affiche les tâches du plan (`planner-output.json`) en trois colonnes, To Do, In Progress et Done. Une tâche passe en cours quand l’orchestrateur la confie à un agent `developer`, et terminée quand son rapport `developer-report-<id>.md` est écrit. Chaque agent d’un run reçoit un prénom et une photo, dans l’ordre où il démarre, et la carte montre l’agent qui porte la tâche, sous la forme « Tom · Dev ». Le même nom apparaît dans le panneau des agents.

Le bouton **Documents générés** ouvre un lecteur intégré pour consulter le contexte du ticket, les plans, rapports de tests, reviews et descriptions de MR conservés pendant le run.

Le lecteur n’interrompt pas l’exécution. Si Claude Code pose une question pendant sa consultation, un bandeau signale la décision attendue et le bouton **Répondre** referme le lecteur pour afficher la carte de clarification.

Le panneau de progression récapitule le livrable du run : le ticket, la branche de travail dès que le workflow la crée, et la merge request dès qu’elle est ouverte. Le ticket et la merge request sont cliquables, la branche est là pour être relue. La merge request est lue dans la sortie de la commande qui l’ouvre, donc elle apparaît sans que le workflow ait à la déclarer.

Un run dure longtemps et n’a pas à être surveillé. Le titre de l’onglet et son icône suivent l’état des runs, et le navigateur envoie une notification système quand une décision attend une réponse, quand la session réclame de l’attention et quand le run se termine. La permission du navigateur est demandée au premier lancement, et une notification ne part que si la page n’est pas au premier plan.

Le bouton haut-parleur de l’en-tête ajoute un signal sonore aux mêmes trois moments : une montée à deux notes quand quelque chose est attendu de toi, une résolution à trois notes quand le run est fini. Il est **coupé par défaut** et le réglage est mémorisé dans le navigateur. L’activer joue le signal tout de suite, pour vérifier le réglage sans attendre un run.

L’interface émet le son à l’instant où la question devient bloquante. Un son demandé au modèle arrivait en avance et pouvait être oublié. Deux réserves à connaître : un navigateur interdit à une page d’émettre du son avant une interaction, donc le tout premier signal d’une session ouverte sans un clic reste muet, et deux onglets ouverts sur le harnais sonnent deux fois.

Le harnais exécute Claude Code dans le worktree du run avec le plugin de ce dépôt. Aucun fichier du plugin n’est copié dans `~/.claude`.

### Lancer plusieurs tickets d’un coup

Le champ **Ticket GitLab** accepte plusieurs URL, une par ligne. Des URL séparées par des espaces, des virgules ou des points-virgules sur une même ligne sont lues aussi. Sous le champ, le formulaire indique le nombre de tickets reconnus, les doublons ignorés et les lignes qui ne sont pas une URL de ticket. Tant qu’une ligne est invalide, le lot ne part pas.

À partir de deux tickets, le champ du répertoire disparaît : le dépôt de chaque ticket est détecté depuis son URL, dans les racines de `IMPL_SEARCH_ROOTS`. L’instruction particulière s’applique à tous les tickets du lot. Le bouton devient **Lancer les N tickets**.

Le lot est accepté ou refusé en entier. Si un seul ticket n’a pas de checkout, rien n’est mis en file et le bandeau dit lequel. Un ticket que le harnais a déjà, en file, en cours ou derrière une merge request qu’il surveille, est ignoré, et le bandeau en donne le nombre.

#### L’analyse du lot

Avant de démarrer, le harnais compare les tickets d’un même dépôt. Il ouvre pour cela une session Claude Code sans terminal (`claude -p`, modèle Sonnet) dans le checkout principal, sur la commande `/implementation-harness:schedule`. L’agent `ticket-scheduler` lit chaque ticket avec `glab`, cherche dans le dépôt les fichiers que le ticket toucherait et relie les tickets qui ne peuvent pas tourner ensemble : ceux qui modifieraient les mêmes fichiers, et ceux dont l’un a besoin du résultat de l’autre. Cette session ne modifie rien dans le dépôt.

- Il y a une session par dépôt et par lot. Elle ne compte pas dans `IMPL_MAX_CONCURRENT_RUNS`.
- Un ticket seul dans son dépôt, sans autre ticket connu à comparer, démarre sans analyse.
- Un ticket ajouté plus tard est comparé aux prédictions déjà faites pour les tickets en file, en cours ou en attente de merge. Elles ne sont pas recalculées.
- Deux tickets de dépôts différents ne se retiennent jamais.
- L’analyse a `IMPL_SCHEDULE_TIMEOUT_MINUTES` minutes (5 par défaut). Si elle échoue, dépasse ce délai ou rend un fichier invalide, les tickets concernés passent un par un sur leur dépôt et la file affiche « Analyse en échec ». Un redémarrage de la console pendant l’analyse a le même effet. L’analyse suivante du même dépôt reprend ces tickets avec les nouveaux, tant qu’ils sont en file, en cours ou en attente de merge. Aucune analyse n’est relancée pour eux seuls.
- Un ticket trop vague pour être prédit est marqué « Prédiction peu fiable » et passe seul sur son dépôt.

#### Ce que montre la file

La file s’affiche sous les runs en cours, par lot (« Lot de 14:32 · 3 tickets en file »), puis par dépôt. Chaque ligne dit ce que le ticket attend :

| Ligne | Ce que le ticket attend |
|---|---|
| « Analyse en cours » | la réponse de la session d’analyse |
| « En attente, conflit avec #217 en cours » | #217 tourne et touche le même code |
| « Attend que la MR !12 soit mergée (#217) » | le run de #217 est fini, sa merge request n’est pas encore mergée |
| « État de la MR !12 inconnu (#217) » | GitLab ne répond pas ; le ticket reste retenu tant que l’état n’est pas connu |
| « Dépend de #217, encore en file » | #217 doit passer avant, et n’a pas démarré |
| « Passe après #217 » | les deux tickets sont en conflit, #217 est devant dans la file |
| « En attente, ticket déjà en cours » | un run tient déjà ce ticket |
| « En attente, toutes les places sont prises » | une place |

Un ticket retenu par l’ordonnancement n’occupe aucune place, et les tickets derrière lui qui ne sont en conflit avec rien passent devant. Le dépliant **Pourquoi il attend** donne la raison écrite par l’agent et le résumé du ticket. Les flèches changent l’ordre des tickets d’un même dépôt, la croix retire un ticket de la file. Un ticket dont un autre dépend reste devant lui, quel que soit l’ordre choisi.

Un ticket en conflit attend que la merge request de l’autre soit mergée, et pas seulement la fin de son run : il part alors de la base à jour. Si cette merge request est fermée sans être mergée, ou si le run se termine sans en ouvrir, le ticket est libéré et le bandeau le signale.

#### Démarrer quand même

Le dépliant propose deux départs forcés. Un ticket forcé attend encore une place libre, et ne démarre pas tant qu’un run tient le même ticket.

- **Lancer depuis la base.** Le ticket part de la branche de base sans attendre l’autre. Les deux tickets touchent le même code, donc la seconde merge request devra sans doute être reprise à la main. Proposé aussi pendant l’analyse : rien ne dit encore si le ticket est en conflit.
- **Empiler sur `<branche>`.** Le ticket part de la branche de l’autre ticket, et sa merge request cible cette branche. Elle ne peut être mergée qu’après celle de l’autre. Quand l’autre est mergée et sa branche supprimée, GitLab recible la seconde. Proposé seulement quand la branche de l’autre ticket existe déjà.

#### Ce que ça coûte

- **L’analyse** est une session Claude Code sur Sonnet, par dépôt et par lot. Elle consomme le quota du compte connecté, comme un run, et le délai d’analyse la borne.
- **La veille des merge requests ne consomme aucun token.** C’est le serveur Node qui appelle `glab api` pour lire l’état de la merge request, sans ouvrir de session Claude. L’appel a lieu toutes les 60 secondes, seulement pour les merge requests qu’un ticket en file attend. Quand plus rien n’attend, le serveur n’interroge plus GitLab. `IMPL_MERGE_POLL_MS`, posée dans l’environnement de lancement, change cet intervalle.

#### Limites

- L’ordonnancement n’a pas encore tourné sur une vraie instance GitLab. Les tests remplacent `claude` et `glab` par des simulateurs. La commande d’analyse a été essayée en vrai sur un lot vide et sur une URL inventée, jamais sur un ticket réel : la qualité des prédictions n’est pas mesurée. La lecture de l’état d’une merge request par `glab` et le départ empilé n’ont été exercés que contre ces simulateurs.
- Une prédiction reste une estimation faite avant d’écrire le code. Deux tickets jugés indépendants peuvent quand même entrer en conflit au merge.
- Les tickets ne sont pas encore tirés de GitLab par labels ou par assignee : il faut coller les URL.

### Tickets proposés par un surveillant

Le harnais peut afficher des tickets trouvés par un outil extérieur, par exemple un script qui interroge GitLab sur un label, un assigné et un statut. Cet outil écrit la liste des tickets trouvés dans `console/data/ticket-proposals.json`, et le harnais relit ce fichier toutes les cinq secondes. Les deux ne se parlent pas autrement : l’un peut être arrêté sans gêner l’autre, et sans ce fichier le harnais fonctionne comme avant.

Les tickets apparaissent dans la liste de gauche, sous **Proposés**. Rien ne démarre seul :

- **Lancer** met le ticket en file comme une URL collée. **Tout lancer** les envoie en un seul lot, pour que les tickets d’un même dépôt soient comparés avant de partir.
- **Ignorer** retire le ticket de la liste.

Un ticket lancé ou ignoré n’est plus proposé tant qu’il reste dans le fichier. S’il en sort puis y revient, il est proposé de nouveau. Un ticket déjà en file, en cours ou en attente de merge n’est pas proposé.

`IMPL_TICKET_PROPOSALS_FILE`, défini dans l’environnement de lancement, désigne un autre fichier par son chemin absolu. Le format attendu est décrit dans [contracts/ticket-proposals.md](contracts/ticket-proposals.md).

### Un worktree par run

Avant d’ouvrir la session, le harnais crée un worktree git du projet dans `<projet>/.claude/worktrees/<id du run>`, détaché sur le commit courant du checkout principal. Claude Code démarre dans ce dossier et y fait tout son travail : la branche du ticket, les commits, le dossier `.claude/tasks` et le serveur de développement. Le checkout principal n’est pas touché. Sa branche, ses modifications en cours et son stash restent tels quels, et on peut continuer à y travailler pendant le run.

Ce que le worktree reçoit du checkout principal :

- les dossiers de dépendances ignorés par Git, à toute profondeur (`node_modules` par défaut, réglage `IMPL_WORKTREE_DEPENDENCY_DIRS`). Ils sont copiés, en copy-on-write quand le système de fichiers le permet : la copie n’occupe alors pas de disque tant qu’aucun des deux côtés ne change, et une installation dans le worktree y reste. Si la copie échoue, le dossier est lié par un lien symbolique;
- les fichiers ignorés par Git `.env*` et le fichier `.claude/settings.local.json` (réglage `IMPL_WORKTREE_COPY_FILES`), copiés.

Le dossier `.claude/worktrees/` et les liens sont inscrits dans le `.git/info/exclude` du dépôt. Ils n’apparaissent pas dans `git status` et n’entrent dans aucun commit, et le `.gitignore` suivi n’est pas modifié. Les sorties de build (`.next`, `dist`) ne sont pas fournies, donc le premier build d’un run est complet. Quand un ticket change les dépendances et que `node_modules` est un lien, le workflow le remplace d’abord par une installation réelle dans le worktree, pour ne modifier ni le checkout principal ni les autres runs.

Si le worktree ne peut pas être créé, le run ne démarre pas : le harnais ne se rabat jamais sur le checkout principal. Si les dépendances ne peuvent pas être reprises, le run démarre et le fil d’activité le signale.

Deux runs du même projet peuvent vouloir le même port pour leur serveur de développement. Le workflow démarre le sien sur un port libre.

Une fois la session fermée, le harnais supprime le worktree de lui-même quand toutes ces conditions sont réunies :

- le run est terminé et le workflow n’est pas bloqué;
- la merge request existe et n’est pas en draft;
- l’archive des preuves a été confirmée;
- l’arbre est propre;
- le dernier commit est sur une branche du remote, d’après les références locales.

La branche du ticket n’est jamais supprimée, et la merge request reste.

Dans tous les autres cas le worktree est conservé, pour qu’on puisse reprendre le travail, et le fil d’activité en donne la raison, par exemple « aucune merge request » ou « changements non poussés ». Dès que sa session est fermée, la vue du run propose le bouton **Supprimer le worktree**. Si le worktree contient du travail non commité ou non poussé, le harnais dit ce qui serait perdu et demande une confirmation. Ce qui n’est pas commité est alors perdu, la branche et ses commits restent dans le dépôt.

Un run retiré de la liste avec **Fermer**, ou laissé par un arrêt de la console, reste accessible tant que son worktree est sur le disque : il apparaît dans le groupe **Worktrees conservés** de la colonne de gauche, ou sous **Interrompus** s’il porte aussi un incident ouvert. Au démarrage, le harnais applique les mêmes règles aux worktrees des runs précédents : il supprime ceux qui remplissent les conditions, oublie ceux dont le dossier a disparu et conserve les autres avec leur raison.

Lancé sans la console, le plugin travaille comme avant, directement dans le checkout.

Quand Claude Code utilise `AskUserQuestion`, le harnais présente les décisions dans un panneau dédié : les choix suggérés peuvent remplir la réponse, qui reste éditable dans un champ de texte avant son envoi. La réponse est transmise à Claude Code par le hook en attente. Le terminal intégré reste visible et interactif pendant toute l’exécution pour les échanges libres et les commandes qui ne passent pas par ce panneau.

## Configuration

La configuration du dépôt se règle avec :

```bash
impl config
```

L’assistant parcourt chaque réglage, affiche la valeur courante entre crochets, garde cette valeur si on appuie sur Entrée, refuse une saisie invalide et propose de redémarrer le serveur quand un changement l’exige. Il écrit un `.env` local, ignoré par Git.

Pour les usages rapides ou scriptés :

| Commande | Effet |
|---|---|
| `impl config list` | valeur effective de chaque réglage et sa provenance |
| `impl config get CLÉ` | une valeur seule, sur la sortie standard |
| `impl config set CLÉ=VALEUR` | écrit un réglage sans passer par l’assistant |
| `impl config path` | chemin du `.env` |
| `impl config edit` | ouvre le `.env` dans `$EDITOR`, puis le vérifie |
| `impl config check` | vérifie la configuration, sort en 1 si elle est cassée |

Les réglages disponibles :

| Variable | Effet | Défaut |
|---|---|---|
| `IMPL_SEARCH_ROOTS` | racines où chercher les checkouts, séparées par des virgules | `~/workspace` |
| `IMPL_PERMISSION_MODE` | mode de permission de chaque run : `manual`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions` | `auto` |
| `IMPL_SELF_IMPROVEMENT_AUTORUN` | auto-audit à la fin de chaque run | `true` |
| `IMPL_REMOTE_CONTROL` | Remote Control sur le terminal d’un run | `true` |
| `IMPL_PORT` | port d’écoute | `3210` |
| `IMPL_HOST` | interface d’écoute ; hors boucle locale, la console est joignable depuis le réseau et le signale au démarrage | `127.0.0.1` |
| `IMPL_NO_OPEN` | `1` pour démarrer sans ouvrir le navigateur | `0` |
| `IMPL_MAX_CONCURRENT_RUNS` | nombre de runs tenus en parallèle, de 1 à 10 ; au-delà, les lancements attendent en file | `3` |
| `IMPL_SCHEDULE_TIMEOUT_MINUTES` | minutes laissées à l’analyse d’un lot de tickets, par dépôt, de 1 à 60 ; au-delà, les tickets de ce dépôt passent un par un | `5` |
| `IMPL_WORKTREE_DEPENDENCY_DIRS` | noms des dossiers de dépendances ignorés par Git que le worktree d’un run reprend du checkout principal, à toute profondeur, séparés par des virgules ; pas de sorties de build | `node_modules` |
| `IMPL_WORKTREE_COPY_FILES` | fichiers copiés du checkout principal vers le worktree d’un run, séparés par des virgules : un motif de nom comme `.env*` pour des fichiers ignorés par Git, ou un chemin depuis la racine du dépôt | `.env*,.claude/settings.local.json` |
| `IMPL_STALL_MINUTES` | minutes sans progression avant que la console exprime un doute sur un run en cours (un doute seulement : rien n’est arrêté ni relancé) | `10` |
| `IMPL_DEMO_STEP_MS` | durée d’une étape du mode démo | `5000` |

Une variable posée dans le shell l’emporte sur le `.env`, qui l’emporte sur le défaut. Un réglage ponctuel ne demande donc aucune écriture :

```bash
IMPL_PORT=4321 impl
IMPL_NO_OPEN=1 impl
```

Les runs, la file d’attente et les retours sont conservés dans `console/data/`. `IMPL_ENV_FILE` et `IMPL_DATA_DIR`, définis dans l’environnement de lancement, permettent de choisir d’autres chemins absolus, et `IMPL_PLUGIN_ROOT` désigne un autre checkout du harnais que celui qui sert la console.

### Permissions des sessions

Un run doit aller au bout sans surveillance. Il démarre donc avec un mode de permission explicite plutôt qu’avec celui configuré sur la machine qui l’ouvre. Par défaut `auto`, le même que les sessions d’arrière-plan du harnais. `manual` redonne la main avant chaque outil, au prix d’un run qui s’arrête à la première question. `bypassPermissions` ne vérifie plus rien. Le mode `plan` n’est pas proposé, parce qu’il répond par un plan et n’ouvre jamais de merge request.

### Terminal joignable à distance

Un run démarre avec Remote Control activé. La session affiche son lien `claude.ai/code/session_…` dès la première seconde, et le terminal se reprend depuis un téléphone ou un autre poste sans attendre que le harnais propose quoi que ce soit. La session reste rattachée au compte déjà authentifié dans Claude Code et n’est pas exposée à un tiers. `IMPL_REMOTE_CONTROL=false` la démarre sans. La session d’auto-amélioration n’est jamais concernée, parce qu’elle tourne en arrière-plan et n’est pas interactive.

### Détection du projet

Le harnais parcourt les racines de recherche jusqu’à deux niveaux de profondeur, lit le `.git/config` de chaque dossier et en déduit le projet GitLab. Après collage d’un ticket, le chemin détecté remplit le champ projet s’il est vide. Ce champ reste éditable et propose les checkouts découverts pendant la saisie. Pour un dépôt situé ailleurs, ajouter son dossier parent à `IMPL_SEARCH_ROOTS`.

## Boucle d’auto-amélioration

À la fin d’un run, le panneau de droite permet d’enregistrer un retour concret. Il est conservé localement avec l’identifiant du run et ses documents générés, puis traité avec :

```bash
impl improve
```

Cette commande lance Claude Code sur `/implementation-harness:improve`. Il regroupe les retours en attente, vérifie les preuves du run, crée une branche `self-improvement-*`, applique la plus petite amélioration durable, exécute les vérifications et crée un commit local. Il ne pousse rien et ne fusionne rien, donc le résultat reste inspectable et réversible.

Son worktree est découpé depuis le dernier commit poussé, et la boucle ne pousse jamais. L’itération commence donc par mettre sa propre branche à niveau sur le harnais, en `--ff-only`, pour ne pas diagnostiquer un arbre auquel manquent les améliorations déjà acceptées. Une branche qui porte déjà un commit fait refuser la commande et ne bouge pas.

Avant de choisir quoi corriger, il lit aussi les branches `self-improvement-*` que l’utilisateur n’a pas encore acceptées ou écartées, ainsi que les worktrees en cours. Quand une branche en attente contient déjà un correctif, il ne le réimplémente pas et nomme cette branche dans son rapport. Comme plusieurs itérations peuvent tourner en parallèle, son diagnostic et son rapport portent le nom de sa propre branche, `improvement-plan-<slug>.md` et `improvement-report-<slug>.md`, pour qu’aucune itération n’écrase le travail d’une autre.

Les tickets, logs et retours bruts restent sous `console/data/` et ne sont jamais ajoutés au commit d’amélioration.

Le harnais peut également se critiquer sans retour humain. À la fin de chaque workflow, y compris après un échec ou un arrêt manuel, il enregistre un auto-audit portant sur les échecs, interventions, boucles de revue, documents manquants et vérifications incomplètes. En mode autonome, Claude Code traite cette preuve dans un worktree isolé. Un signal auto-généré doit apparaître sur au moins deux runs, sauf bug déterministe ou défaut de sécurité. La décision est prise une seule fois par run, et seulement si le run a laissé quelque chose à analyser : un agent délégué, un document produit ou une sortie inattendue. Une session arrêtée avant ça est écartée, avec une ligne dans le fil d’activité.

La politique se règle avec `impl config`, ou directement :

```bash
impl config set IMPL_SELF_IMPROVEMENT_AUTORUN=false
```

Elle lance l’analyse en arrière-plan à la fin du run. L’option est active par défaut ; la passer à `false` coupe la boucle.

L’agent travaille dans un worktree isolé et laisse toujours son commit sur sa branche `self-improvement-*`. Rien n’est fusionné automatiquement et rien n’est poussé sur GitHub. Le panneau de droite affiche le diff, et son bouton de fusion est la seule voie de promotion. Une fusion arrive dans le checkout qui sert la console. Chaque nouvelle session relit les commandes, agents, skills et hooks, donc ils s’appliquent dès le run suivant, sans relance. Quand la fusion touche `console/` ou `bin/`, le bandeau le signale et demande un `impl restart`. Le harnais ne se relance pas seul, parce que des sessions peuvent tourner sous lui.

**Une seule amélioration est en cours à la fois.** Tant qu’un worktree `self-improvement-*` existe, la fin d’un run n’en ouvre pas un second. Le fil d’activité nomme celui qui bloque et l’auto-audit reste dans `pending/`, où la prochaine itération le lira. Le harnais ne détruit rien pour libérer la place, seule la décision de l’utilisateur libère la boucle. La règle vient d’une mesure : la boucle a ouvert onze branches en une journée, dont quatre en conflit entre elles, et aucune n’a été promue par le bouton. Elles ont toutes été reprises à la main. Une branche que personne n’a tranchée est aussi celle contre laquelle la suivante se diagnostique.

La revue n’est proposée qu’une fois un commit d’amélioration présent sur la branche du worktree. Le lanceur rend la main dès que le travail se détache, donc son code de sortie ne renseigne que sur le démarrage. De son côté, `/implementation-harness:improve` laisse sa branche non commitée quand sa propre validation échoue, un état qui ne doit jamais être proposé à la fusion. Sans commit au bout d’une heure et demie, le fil d’activité pointe le worktree à inspecter à la main plutôt que d’ouvrir les boutons, et dit que la boucle reste en pause tant qu’il existe.

Au moment d’ouvrir les boutons, le harnais simule la fusion avec `git merge-tree --write-tree`, qui n’écrit que dans la base d’objets. Le panneau avertit avant le clic quand la branche ne fusionne plus, pour que l’utilisateur ne découvre pas le conflit en cliquant.

### Rebase automatique

Les branches d’amélioration partent toutes de la même base et se fusionnent l’une après l’autre. La première promotion laisse toutes les suivantes derrière le harnais, et l’écart grandit à chaque fusion. Le harnais rejoue donc les branches en attente sur son propre `HEAD` à chaque fois qu’il bouge, c’est-à-dire au démarrage de la console et après chaque fusion. Une branche en retard d’un commit se rejoue presque toujours seule; la même branche en retard de dix ne se rejoue jamais.

Le harnais laisse trois états intacts : une branche sans commit, parce qu’un agent y écrit peut-être encore, une branche déjà contenue dans le harnais, qui n’a plus rien à rejouer, et un worktree avec des changements non commités, qui contient le diagnostic laissé par une validation ratée et qu’un rebase emporterait.

Quand git s’arrête sur un conflit, le harnais annule le rebase et la branche reste où elle était. En mode autonome (`IMPL_SELF_IMPROVEMENT_AUTORUN=true`), le harnais confie alors le rebase à un agent de fond lancé dans le worktree de la branche, sur `/implementation-harness:rebase`. Cet agent rejoue, résout en gardant les deux intentions plutôt qu’un côté, rejoue les vérifications et ne fusionne rien. La promotion passe toujours par le bouton de l’utilisateur. Hors mode autonome, le panneau signale le conflit, à reprendre à la main.

Le harnais n’annonce la fusion que si elle a déplacé sa branche. Git répond « Already up to date » avec un code de sortie nul, et un conflit laisse le dépôt à moitié fusionné. Dans ce second cas, le harnais annule la fusion et conserve le worktree. Quand git n’apporte rien, le harnais départage deux situations que le code de sortie ne distingue pas :

- **les commits de la branche sont déjà contenus dans le harnais**, parce que le travail a été repris à la main. Le worktree ne sert plus. Le harnais le supprime avec sa branche et journalise « Améliorations déjà présentes ». Refuser ce cas ne laissait aucune issue exacte, puisque « Fusionner » disait que rien n’avait été fusionné et « Ignorer » enregistrait comme écarté du travail qui avait en fait été gardé;
- **la branche ne porte aucun commit**, et l’agent peut encore être en train d’écrire. Le worktree est conservé. Le nettoyage n’a lieu que si le worktree n’a aussi rien de non commité, parce que le diagnostic qu’une validation ratée laisse sur place n’existe nulle part ailleurs.

## Fonctionnement

Claude Code reste le moteur du workflow. Le harnais ajoute :

- un registre de runs (`console/server/registry.ts`) qui démarre, met en file et libère les sessions, chacune isolée dans sa `RunSession` avec son état, son terminal, ses surveillances de fichiers et sa question en attente;
- un ordonnancement des lots : une session d’analyse par dépôt prédit ce que chaque ticket toucherait, le serveur retient les tickets en conflit et lit l’état des merge requests attendues avec `glab`, sans session Claude (voir `console/README.md`);
- un pseudo-terminal interactif par run, relié à l’interface avec WebSocket. Chaque page s’abonne au run qu’elle affiche et ne reçoit que son terminal et son état, la liste des runs étant diffusée à toutes;
- des hooks Claude Code pour suivre les agents et les outils, puis présenter et résoudre les questions structurées dans l’interface;
- un dossier de preuves par critère d’acceptation : le pilote écrit un registre de critères identifiés, chaque preuve les cite avec la version du code qu’elle a vérifiée, et le serveur calcule pour chaque critère s’il est vérifié, en échec, bloqué ou non vérifié, dans l’onglet Preuves comme dans la synthèse de la merge request. Une tentative de mise en échec de la QA qui ne trouve aucun défaut est affichée sous son critère sans compter comme vérification. Le serveur signale un verdict QA `PASS` ou `PASS_WITH_WARNINGS` écrit alors qu’un critère n’a aucune observation QA sur le code actuel (voir `console/README.md`);
- une détection des runs sans prochaine action : le serveur distingue qui peut faire avancer un run (l’utilisateur, un agent, une tâche de fond, personne), ouvre un incident explicite quand le pilote a rendu la main sans suite ou quand la session s’est perdue, et ne propose que les actions possibles, dont une demande de continuation à la session encore active (voir `console/README.md`);
- une surveillance de `.claude/tasks/` pour suivre les étapes et conserver les rapports avant leur nettoyage. Ce dossier appartient au dépôt cible et un run interrompu n’a pas eu le temps de le nettoyer : seuls les fichiers écrits depuis le début du run lui sont rattachés, ceux laissés par un run précédent sont ignorés et ne font pas avancer le rail d’étapes. La surveillance est posée sur `.claude/` et restreinte à `tasks/`, parce que le workflow supprime et recrée ce dossier en cours de run et qu’une surveillance posée dessus ne se réveillerait plus ensuite.

### La couche moteur

Tout ce qui est propre à Claude Code, l’exécutable, le vocabulaire de hooks, le format du transcript, la façon de soumettre une instruction, vit dans `console/server/engine/`. Le reste du serveur raisonne en runs, phases, agents et documents, sans savoir quel agent tourne dessous.

Il y a une seule implémentation aujourd’hui, `claude-code`, et c’est délibéré. La frontière sert à ce qu’une deuxième implémentation demande un fichier à écrire, sans réécrire le serveur. Le mécanisme le plus spécifique du harnais, la question qui bloque l’agent jusqu’à la réponse de l’utilisateur, a été prouvé portable avant que cette couche soit écrite.

`console/server/engine/README.md` documente le contrat membre par membre, le chemin complet d’une question bloquante, et ce qui reste couplé en dehors du serveur.

La file et son ordonnancement sont dans `queue.json`. Les fichiers d’une analyse de lot ne sont pas dans ce dossier tant qu’il est dans le plugin, parce que Claude Code refuse à une session toute écriture dans le dossier du plugin qu’elle a chargé : ils vont dans `implementation-harness-<utilisateur>/schedule/<id>/`, sous le dossier temporaire du système, réservé à ton utilisateur. Avec un dossier de données hors du plugin (`IMPL_DATA_DIR`), ils restent dans `schedule/<id>/`. Ils sont supprimés une fois la réponse lue, gardés après un échec pour le diagnostic, et effacés au démarrage suivant.

Les données d’un run sont archivées dans `runs/<run-id>/`, sous le [dossier de données](#configuration) (`console/data/` depuis le dépôt) :

- `run.json` contient l’état, les agents et l’activité;
- `terminal.log` contient la sortie brute du terminal;
- `artifacts/` contient les documents générés pendant le run : plans, rapports QA, reviews et captures;
- `evidence/` et `acceptance/` gardent chaque version des preuves, leurs captures et la synthèse de couverture.

Ce dossier est local et ignoré par Git. Il peut contenir des informations confidentielles provenant des tickets traités et ne doit pas être partagé.

Un run que le serveur n’a pas pu clore lui-même (arrêt brutal, redémarrage) est reclassé `failed` au démarrage suivant, au lieu de rester marqué `running`. Voir `console/README.md`.

## Tests

Depuis le dossier `console/` :

```bash
npm run test:unit
npm run test:integration
```

Les tests unitaires utilisent Jest. Ils sont séparés par responsabilité dans `tests/unit/` et suivent la convention `describe(...)` puis `it("should ...")`.

Les tests d’intégration sont répartis par parcours dans `tests/integration/`. Ils utilisent Playwright avec Google Chrome et démarrent un serveur isolé sur le port `3211`. Pour observer leur exécution :

```bash
npm run test:integration:headed
```

GitHub Actions exécute le contrôle TypeScript, les tests unitaires, le build de production et les tests d’intégration à chaque pull request et à chaque push sur `main`.

## Développement

```bash
cd console
npm install
npm run dev
```

Les changements du frontend sont rechargés. Une modification du serveur demande de relancer `npm run dev`, et un `impl` déjà lancé doit être relancé avec `impl restart` pour servir le nouveau build.

Vérifications :

```bash
npm run typecheck
npm run build
```

Le front utilise Next.js, React, TypeScript, Tailwind CSS et xterm.js. Le serveur local utilise `node-pty`, WebSocket et les hooks Claude Code.

## Contenu du dépôt

```text
agents/       sous-agents Claude Code
commands/     commandes /implementation-harness:implement, /implementation-harness:review, /implementation-harness:improve, /implementation-harness:rebase et /implementation-harness:schedule
hooks/        événements envoyés au harnais local
bin/          lanceur impl et commande impl config
console/      interface Next.js et serveur PTY
console/server/engine/  la couche qui isole l'agent piloté, une implémentation : claude-code
contracts/    formats de sortie des agents et règles de preuve
principles/   règles de décision communes aux agents
skills/       méthodes chargées selon le besoin
docs/         organisation des agents, des skills et de la revue, schéma de fonctionnement (architecture.html)
install.sh    installation et création des commandes globales
install-remote.sh  clone ou mise à jour depuis la commande curl
```

`/implementation-harness:implement` utilise deux serveurs MCP. Playwright sert au développeur pour mesurer son travail dans le navigateur, puis à la revue design et à la QA. Figma ne sert que si le ticket fournit des frames. Sans Figma, la revue design compare le changement aux maquettes jointes au ticket ou aux écrans déjà livrés. Un MCP absent réduit les vérifications correspondantes mais n’empêche pas le harnais de démarrer.

Un run type ouvre plusieurs sessions navigateur : l’agent développeur mesure son propre travail, puis la revue design et la QA repassent dessus. Déclarer le serveur MCP Playwright en `--headless` évite qu’une fenêtre Chrome prenne le premier plan à chaque fois. Cela écarte aussi une erreur de mesure : en mode fenêtré, le navigateur rogne sans le dire un viewport demandé plus large que l’écran, et la mesure est rapportée à la largeur demandée au lieu de la largeur obtenue.

```json
"playwright": { "type": "stdio", "command": "npx",
                "args": ["@playwright/mcp@latest", "--headless"] }
```

Le seul cas qui demande l’inverse est un parcours où l’utilisateur doit intervenir lui-même dans le navigateur, typiquement une connexion à faire à la main. Retirer `--headless` rend la fenêtre.

## Licence

Implementation Harness est distribué sous [licence MIT](LICENSE). Copyright © 2026 Gregory Klein.
