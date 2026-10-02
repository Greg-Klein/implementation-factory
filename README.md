# Implementation Harness

Implementation Harness est une interface locale pour piloter Claude Code pendant l’implémentation d’un ticket GitLab. On colle l’URL du ticket, le harnais détecte le checkout correspondant, ouvre un terminal Claude Code et rend visibles la progression, les agents, les outils et les livrables.

Le dépôt contient un plugin Claude Code dont la commande `/implementation-harness:implement` orchestre le travail : lecture du ticket, questions de clarification, planification, implémentation, tests, revues spécialisées et préparation de la merge request. Le harnais est la couche visuelle de cette commande. Il utilise la connexion Claude Code déjà présente sur la machine et ne fait aucun appel direct à l’API Anthropic.

L’interface s’ouvre dans le navigateur avec la commande `impl`, qui sert la version compilée du checkout. Il n’y a pas d’application de bureau. Le harnais tourne depuis son propre dépôt, ce qui permet à la boucle d’auto-amélioration de modifier le code qui s’exécute.

## Organisation des agents et skills

Les agents définissent les responsabilités et les livrables. Les skills contiennent les méthodes, chargées selon le besoin. L’autovérification du développeur et la revue contradictoire suivent des démarches distinctes et partagent la collecte de preuves. Les formats que la console lit restent dans des contrats dédiés.

Le plugin compte six agents :

| Agent | Rôle |
|---|---|
| `ticket-planner` | transforme le ticket et le code actuel en plan de tâches, avec hypothèses, dépendances, risques et étapes de vérification |
| `developer` | implémente une tâche et vérifie son propre travail |
| `senior-reviewer` | revue de code indépendante, puis corrections justifiées dans le périmètre autorisé |
| `designer-reviewer` | revue de tout changement visible dans l’interface, avec ou sans Figma, sans lire le code du produit |
| `qa-reviewer` | validation indépendante du comportement final, sans modifier le code livré |
| `review-orchestrator` | enchaîne les revues, route les corrections et écrit la synthèse de revue |

Le pilote choisit un niveau de revue d’après la taille du diff :

- niveau 0 : un seul passage de `senior-reviewer`, sans orchestrateur ni boucle de reprise, pendant que le pilote lance lui-même les contrôles généraux (lint, typecheck, tests);
- niveau 1 : `senior-reviewer`, puis `designer-reviewer` si le changement est visible dans l’interface et l’application joignable, puis `qa-reviewer`, une fois chacun;
- niveau 2 : `review-orchestrator` conduit la boucle complète, et les trois reviewers gardent leur modèle par défaut, Opus. Aux niveaux 0 et 1, le pilote les appelle avec Sonnet.

La QA écrit son plan de test dans `qa-plan.md` avant d’ouvrir les rapports de l’auteur, puis tente de mettre chaque critère en échec. Elle ne déclare un critère tenu que sur une observation qu’elle a exécutée elle-même. Quand un critère reste sans observation, le verdict est `INCONCLUSIVE` et la merge request part en draft, avec ces critères nommés.

La revue design fonctionne sans Figma. Elle juge le changement contre la meilleure référence disponible : les frames Figma (`figma`), les maquettes jointes au ticket (`ticket-mockup`) ou les écrans déjà livrés de l’application (`live-neighbours`). Elle écrit son inventaire dans `design-inventory.md` avant de lire les mesures du développeur. Un verdict design `INCONCLUSIVE` ne bloque pas la livraison. La merge request, le commentaire de review et le rapport final le signalent par la mention « design non vérifié », avec la raison.

Voir [Agents, skills et revue indépendante](docs/engineering-workflow.md) pour les capacités, les déclencheurs, la transmission du contexte, les méthodes de revue et les vérifications.

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

Cette commande ouvre un scénario local simulé avec progression, agents, documents générés et décisions interactives. Chaque étape dure cinq secondes. La première review demande des corrections, renvoie le travail à l’agent d’implémentation, puis une seconde review valide les changements. L’onglet Preuves y montre cinq critères dans tous les états possibles, dont un échec du premier tour remplacé au second et conservé dans l’historique avec sa capture. Elle ne modifie aucun dépôt, ne contacte pas GitLab et n’alimente pas la boucle d’auto-amélioration. Le mode démo n’ajoute aucun contrôle à l’interface normale : la validation des améliorations et le champ de retour sont affichés comme en usage réel, marqués `démo`, et leurs actions restent simulées.

Pour redémarrer un serveur déjà lancé :

```bash
impl restart
```

`impl` détecte un harnais déjà en écoute et se contente d’ouvrir le navigateur. Après une recompilation de l’interface, le serveur en cours sert encore l’ancien manifeste Next.js, les feuilles de style renvoient une erreur et la page s’affiche sans style. `impl restart` arrête le serveur du port courant, attend la libération du port et relance la version compilée. Il se combine avec le mode démo (`impl restart demo`) et n’arrête rien si son argument est invalide.

Le navigateur s’ouvre sur <http://127.0.0.1:3210>.

## Piloter les runs

Dans la console :

1. coller l’URL du ticket GitLab;
2. vérifier le projet détecté ou renseigner son chemin;
3. ajouter si nécessaire une instruction propre à cette exécution;
4. lancer le workflow et répondre aux décisions dans le panneau dédié ou échanger librement dans le terminal.

### Plusieurs runs en parallèle

Le harnais tient plusieurs runs à la fois. La colonne de gauche les liste, du plus récent au plus ancien, et le run sélectionné s’affiche à droite. Chaque ligne donne le dépôt et le ticket, l’étape atteinte, ce que fait l’agent à cet instant, et une pastille orange quand une décision attend une réponse. Le bouton **+** en haut de la liste ramène au formulaire de lancement sans interrompre les runs en cours.

Deux limites encadrent le parallélisme :

- **un run par dépôt**. Deux sessions Claude Code dans le même checkout se disputeraient la branche, le dossier `.claude/tasks` et leurs propres modifications. Un dépôt reste tenu tant que sa session est ouverte, y compris après la fin du workflow : la session attend encore à son prompt et peut toujours écrire;
- **`IMPL_MAX_CONCURRENT_RUNS` sessions au total** (3 par défaut). Chacune est une vraie session Claude Code, avec son quota et son CPU.

Un lancement qui bute sur l’une des deux part en file d’attente, visible sous la liste avec la raison de l’attente, et démarre seul dès qu’une place et son dépôt se libèrent. Une demande dont le dépôt est encore occupé ne bloque pas celles qui la suivent. La file est enregistrée dans `queue.json`, sous le [dossier de données](#configuration), et survit à un redémarrage. Les demandes en attente démarrent dès que le serveur écoute à nouveau, sans que personne ne les relance. Une croix retire une demande de la file.

Un run terminé dont la session est encore ouverte garde sa place. Le bouton **Libérer la place** ferme cette session et laisse la file avancer. Une fois la session fermée, l’icône corbeille de sa ligne, ou le bouton **Fermer** de la vue, retire le run de la liste. Ses documents, sa conversation et son journal restent archivés dans `runs/<id>/`, sous le dossier de données.

Les notifications, le titre de l’onglet et son icône couvrent tous les runs à la fois, parce que le run qui réclame une réponse est rarement celui qu’on regarde. Les messages qui ne concernent aucun run en particulier (une demande mise en file, une amélioration rebasée) s’affichent dans un bandeau sous l’en-tête.

L’onglet **Suivi** affiche les tâches du plan (`planner-output.json`) en trois colonnes, To Do, In Progress et Done. Une tâche passe en cours quand l’orchestrateur la confie à un agent `developer`, et terminée quand son rapport `developer-report-<id>.md` est écrit. Chaque agent d’un run reçoit un prénom et une photo, dans l’ordre où il démarre, et la carte montre l’agent qui porte la tâche, sous la forme « Tom · Dev ». Le même nom apparaît dans le panneau des agents.

Le bouton **Documents générés** ouvre un lecteur intégré pour consulter le contexte du ticket, les plans, rapports de tests, reviews et descriptions de MR conservés pendant le run.

Le lecteur n’interrompt pas l’exécution. Si Claude Code pose une question pendant sa consultation, un bandeau signale la décision attendue et le bouton **Répondre** referme le lecteur pour afficher la carte de clarification.

Le panneau de progression récapitule le livrable du run : le ticket, la branche de travail dès que le workflow la crée, et la merge request dès qu’elle est ouverte. Le ticket et la merge request sont cliquables, la branche est là pour être relue. La merge request est lue dans la sortie de la commande qui l’ouvre, donc elle apparaît sans que le workflow ait à la déclarer.

Un run dure longtemps et n’a pas à être surveillé. Le titre de l’onglet et son icône suivent l’état des runs, et le navigateur envoie une notification système quand une décision attend une réponse, quand la session réclame de l’attention et quand le run se termine. La permission du navigateur est demandée au premier lancement, et une notification ne part que si la page n’est pas au premier plan.

Le bouton haut-parleur de l’en-tête ajoute un signal sonore aux mêmes trois moments : une montée à deux notes quand quelque chose est attendu de toi, une résolution à trois notes quand le run est fini. Il est **coupé par défaut** et le réglage est mémorisé dans le navigateur. L’activer joue le signal tout de suite, pour vérifier le réglage sans attendre un run.

L’interface émet le son à l’instant où la question devient bloquante. Un son demandé au modèle arrivait en avance et pouvait être oublié. Deux réserves à connaître : un navigateur interdit à une page d’émettre du son avant une interaction, donc le tout premier signal d’une session ouverte sans un clic reste muet, et deux onglets ouverts sur le harnais sonnent deux fois.

Le harnais exécute Claude Code dans le projet sélectionné avec le plugin de ce dépôt. Aucun fichier du plugin n’est copié dans `~/.claude`.

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
- un pseudo-terminal interactif par run, relié à l’interface avec WebSocket. Chaque page s’abonne au run qu’elle affiche et ne reçoit que son terminal et son état, la liste des runs étant diffusée à toutes;
- des hooks Claude Code pour suivre les agents et les outils, puis présenter et résoudre les questions structurées dans l’interface;
- un dossier de preuves par critère d’acceptation : le pilote écrit un registre de critères identifiés, chaque preuve les cite avec la version du code qu’elle a vérifiée, et le serveur calcule pour chaque critère s’il est vérifié, en échec, bloqué ou non vérifié, dans l’onglet Preuves comme dans la synthèse de la merge request. Une tentative de mise en échec de la QA qui ne trouve aucun défaut est affichée sous son critère sans compter comme vérification. Le serveur signale un verdict QA `PASS` ou `PASS_WITH_WARNINGS` écrit alors qu’un critère n’a aucune observation QA sur le code actuel (voir `console/README.md`);
- une détection des runs sans prochaine action : le serveur distingue qui peut faire avancer un run (l’utilisateur, un agent, une tâche de fond, personne), ouvre un incident explicite quand le pilote a rendu la main sans suite ou quand la session s’est perdue, et ne propose que les actions possibles, dont une demande de continuation à la session encore active (voir `console/README.md`);
- une surveillance de `.claude/tasks/` pour suivre les étapes et conserver les rapports avant leur nettoyage. Ce dossier appartient au dépôt cible et un run interrompu n’a pas eu le temps de le nettoyer : seuls les fichiers écrits depuis le début du run lui sont rattachés, ceux laissés par un run précédent sont ignorés et ne font pas avancer le rail d’étapes. La surveillance est posée sur `.claude/` et restreinte à `tasks/`, parce que le workflow supprime et recrée ce dossier en cours de run et qu’une surveillance posée dessus ne se réveillerait plus ensuite.

### La couche moteur

Tout ce qui est propre à Claude Code, l’exécutable, le vocabulaire de hooks, le format du transcript, la façon de soumettre une instruction, vit dans `console/server/engine/`. Le reste du serveur raisonne en runs, phases, agents et documents, sans savoir quel agent tourne dessous.

Il y a une seule implémentation aujourd’hui, `claude-code`, et c’est délibéré. La frontière sert à ce qu’une deuxième implémentation demande un fichier à écrire, sans réécrire le serveur. Le mécanisme le plus spécifique du harnais, la question qui bloque l’agent jusqu’à la réponse de l’utilisateur, a été prouvé portable avant que cette couche soit écrite.

`console/server/engine/README.md` documente le contrat membre par membre, le chemin complet d’une question bloquante, et ce qui reste couplé en dehors du serveur.

Les données sont archivées dans `runs/<run-id>/`, sous le [dossier de données](#configuration) (`console/data/` depuis le dépôt) :

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
commands/     commandes /implementation-harness:implement, /implementation-harness:review, /implementation-harness:improve et /implementation-harness:rebase
hooks/        événements envoyés au harnais local
bin/          lanceur impl et commande impl config
console/      interface Next.js et serveur PTY
console/server/engine/  la couche qui isole l'agent piloté, une implémentation : claude-code
contracts/    formats de sortie des agents et règles de preuve
principles/   règles de décision communes aux agents
skills/       méthodes chargées selon le besoin
docs/         organisation des agents, des skills et de la revue
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
