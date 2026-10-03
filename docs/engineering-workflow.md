# Agents, skills et revue indépendante

Le Harness sépare les responsabilités des agents, les méthodes réutilisables et les formats consommés par la console. Les dossiers `commands/`, `agents/`, `skills/` et `hooks/` restent à la racine du plugin.

Le [schéma de fonctionnement](architecture.html) montre le trajet d'un run, le workflow, la santé des runs, l'ordonnancement d'un lot et la boucle d'auto-amélioration. C'est une page HTML autonome, à ouvrir dans un navigateur.

## Répartition

| Couche | Responsabilité |
| --- | --- |
| `commands/implement.md` | Étapes, délégations, interaction utilisateur, git, livraison et archivage. |
| `agents/` | Mission, périmètre, décisions, droits, méthodes à charger et livrables. |
| `skills/` | Procédures invocables, avec leurs références chargées selon le besoin. |
| `principles/engineering.md` | Preuves, proportionnalité, simplicité, contraintes et traitement des inconnues. |
| `contracts/` | Formats de sortie, politique de spécification, transmission et identité des preuves. |

Les principes et contrats sont lus explicitement depuis le chemin du plugin. Le `CLAUDE.md` de ce dépôt documente le développement du Harness ; il n'est pas supposé être injecté dans les projets que le plugin pilote. Aucun champ YAML propriétaire de chargement des principes n'est introduit.

## Capacités et déclencheurs

| Skill | Déclenchement | Résultat |
| --- | --- | --- |
| `how` | Comportement mal compris avant planification, modification ou investigation. | Modèle actuel sourcé, frontières et inconnues. |
| `why` | Raison historique ou pertinence actuelle d'une contrainte à établir. | Motivation documentée, chronologie et limites. Nécessite `how`. |
| `clarify-spec` | Contradiction entre sources ou décision produit manquante. | Exigences établies, hypothèses et questions à transmettre au pilote. |
| `self-check` | Le développeur vérifie sa propre implémentation. | Couverture des comportements modifiés, tests, résultats et limites. |
| `collect-evidence` | Exécuter des contrôles déjà choisis. | Observations reproductibles, commandes, contexte et obstacles. |
| `review-change` | Revue de code ou QA indépendante. | Contre-exemples, défauts étayés et limites de vérification. |
| `figma-review` | Revue design d'un changement visible dans l'interface, avec ou sans Figma. | Inventaire, mesures qui citent leur référence, couverture, observations pour QA et cellules non vérifiées. |
| `document-change` | Documentation rendue obsolète par un changement autorisé. | Mise à jour de la documentation existante et des décisions nécessaires. |
| `glab-gitlab-api` | Opération GitLab choisie et autorisée par l'appelant. | Recette adaptée et vérification du résultat. |
| `unslop` | Tout texte lu par une personne : rapport, synthèse, question, description ou commentaire de MR, ticket, documentation, champ libre d'un artefact JSON. | Phrases sans tics d'IA, format et langue du contrat inchangés. |

`gitlab-tickets` conserve ses conventions Synapse. Ces conventions ne deviennent pas des principes d'ingénierie universels.

Les skills s'appellent sous leur nom qualifié dans le plugin, par exemple `implementation-harness:how`. Les agents techniques disposent de la découverte dynamique des skills. Le designer, sans outil `Skill`, précharge uniquement `implementation-harness:figma-review` et lit les références que cette skill cite. Si le préchargement manque, il lit d'abord l'entrée de la skill. Cette lecture documentaire ne lui permet pas de lire le code produit.

Le champ natif `skills:` précharge le corps de la skill. Le mettre sur toutes les capacités déplacerait le texte sans réduire le contexte. Les autres méthodes et leurs références restent conditionnelles. Les droits de l'agent continuent à borner toute méthode chargée.

## Répartition des notions d'ingénierie

| Notion | Responsable et méthode |
| --- | --- |
| Flux, état, invariants et consommateurs | Planner/developer/reviewers via `how` si nécessaire. |
| Motivation historique et compatibilité | `why`, avec vérification de la pertinence actuelle. |
| Exigences et hypothèses | Planner et pilote via `clarify-spec` ; le pilote tranche avec l'utilisateur. |
| Décomposition et dépendances | Planner ; fichiers partagés séquencés par le pilote. |
| Simplicité et conventions | Principes communs ; application dans le périmètre du rôle. |
| Cause racine et régression | Developer via `self-check`, puis contre-exemples indépendants via `review-change`. |
| Sécurité et intégrité des données | Planner, developer et senior aux frontières modifiées ; QA pour les comportements observables. |
| Concurrence, annulation et ressources | Analyse ciblée des transitions et propriétaires ; orchestration séparée des ressources partagées entre agents. |
| Performance, migrations et retour arrière | Analyse proportionnée au risque et aux consommateurs réels, sans audit systématique. |
| Accessibilité et contrats de sélecteurs | Developer et QA, qui teste le parcours clavier, le focus et le nom accessible quand le changement les touche. Le designer mesure contraste, parcours clavier, focus visible, rôle et nom, taille de cible sur la surface modifiée. |
| Fidélité à la référence design (`figma`, `ticket-mockup` ou `live-neighbours`) et responsive | Designer via `figma-review`, quand le pilote déclenche la revue design et que l'app est joignable, avec observation du frame et correction limitée au ticket. |
| Documentation et décisions | `document-change` dans le périmètre d'écriture autorisé. |
| Résultats reproductibles | `collect-evidence` ; interprétation séparée par chaque rôle. |
| Fraîcheur et traçabilité | Contrat de preuves, snapshots, identifiants immuables et supersession. |

L'analyse d'impact autonome et le diagnostic de bugs dédié restent des évolutions possibles. Leurs principes sont appliqués dans les rôles actuels ; aucune nouvelle étape obligatoire n'est ajoutée pour eux.

## Indépendance de la revue

La méthode d'autovérification du développeur n'est pas le plan de revue. Les reviewers commencent par la spécification, les consommateurs et le code ; ils formulent leurs attentes et leurs contre-exemples avant de consulter les conclusions de l'auteur. Le senior consigne cette base initiale dans son rapport. QA l'écrit dans `qa-plan.md` et le designer dans `design-inventory.md`, avant d'ouvrir les rapports de l'auteur, que le brief ne transmet que par chemin. Ils confrontent ensuite leurs résultats à ces rapports.

`collect-evidence` peut être partagé : il décrit comment exécuter un contrôle et conserver le résultat, sans choisir les scénarios ni juger leur suffisance. Partager une recette d'accès à un état ne signifie pas partager le résultat attendu ; les stubs et les fixtures restent contestables.

Le senior reste correctif, en deux phases : diagnostic indépendant, puis corrections justifiées. QA vérifie le code final après ces corrections. Au niveau 0, une correction du senior déclenche une vérification QA ciblée, ou demeure explicitement non vérifiée si le budget de revue l'empêche. Au niveau 1, une reprise faite après QA reçoit la même passe ciblée sur les critères qu'elle touche.

Les reviewers reçoivent les preuves de l'auteur (`developer-report.md`, `dev-evidence.json`, `browser-recipe.md`, captures) par chemin. Le brief ne recopie jamais leurs valeurs. Une fois son plan écrit, QA lit aussi la section `## À vérifier par la QA` de la revue design et la section `## Risques restants` du senior, transmises par chemin, et les teste comme hypothèses. Ces hypothèses ne bornent pas sa couverture.

L'indépendance ne garantit pas l'absence de biais. Un diagnostic déjà présent dans le brief est déclaré comme tel, puis une explication concurrente est examinée. Les reprises exposent nécessairement les constats du tour précédent. Aucun quota de défauts n'est imposé.

## Niveaux de revue

Le pilote choisit le niveau d'après la taille du diff (étape 7 de `commands/implement.md`).

| Niveau | Déroulé | Modèle des reviewers |
| --- | --- | --- |
| 0 | Un passage de `senior-reviewer`, sans orchestrateur ni boucle de reprise. Le pilote lance lui-même les contrôles généraux. | Sonnet, par surcharge à l'appel. |
| 1 | `senior-reviewer`, puis `designer-reviewer` si le pilote a déclenché la revue design et que l'application est joignable, puis `qa-reviewer`, une fois chacun. Le pilote enchaîne les agents et fait pour eux ce que l'orchestrateur fait au niveau 2. | Sonnet, par surcharge à l'appel. |
| 2 | `review-orchestrator` conduit la boucle complète. | Opus, le modèle par défaut de `senior-reviewer` et `qa-reviewer`. L'orchestrateur ne passe aucune surcharge. |

`designer-reviewer` tourne sur Sonnet, son modèle par défaut, à tous les niveaux : son travail est surtout de la mesure.

L'appelant du designer prend l'identifiant de snapshot du code avant et après la revue, puis publie `design-evidence.json`. Quand le diff ajoute ou modifie des fichiers de test, l'appelant de QA crée le worktree jetable et le supprime au retour de QA. Au niveau 2 l'appelant est l'orchestrateur, aux niveaux 0 et 1 le pilote. La création et la suppression de ce worktree sont les seules opérations git de l'orchestrateur. Ce worktree jetable est créé hors du dépôt, dans un répertoire temporaire, jamais sous `.claude/worktrees/`, et l'appelant ne supprime que celui-là.

## Worktree du run

Lancé depuis la console, chaque run travaille dans son propre worktree git du dépôt cible. La console le crée avant d'ouvrir la session, dans `<dépôt>/.claude/worktrees/<id du run>`, détaché sur le HEAD du checkout principal, et y démarre Claude Code. Plusieurs tickets du même dépôt peuvent donc tourner en même temps. Un second lancement sur un ticket déjà en cours attend en file. Si le worktree ne peut pas être créé, le run ne démarre pas.

La console passe ces variables à la session :

| Variable | Valeur |
| --- | --- |
| `IMPL_RUN_WORKTREE` | Le worktree du run. |
| `IMPL_SOURCE_REPOSITORY` | Le checkout principal. |
| `IMPL_SOURCE_BRANCH` | La branche du checkout principal au lancement. Absente sur un HEAD détaché. |
| `IMPL_WORKTREE_DEPENDENCIES` | `symlink` dès qu'un répertoire de dépendances est un lien, `clone` quand tous sont des copies. Absente quand aucun n'a été repris. |

| Élément | Dans le worktree |
| --- | --- |
| Répertoires de dépendances ignorés (`node_modules` par défaut, réglage `IMPL_WORKTREE_DEPENDENCY_DIRS`) | Copie de ceux du checkout principal, en copy-on-write quand le système de fichiers le permet : une installation y reste dans le worktree. Lien symbolique seulement si la copie échoue. |
| Fichiers ignorés `.env*` et `.claude/settings.local.json` (réglage `IMPL_WORKTREE_COPY_FILES`) | Copiés depuis le checkout principal. |
| Sorties de build (`.next`, `dist`) | Rien n'est fourni. Le premier build a lieu dans le worktree. |
| `.claude/tasks/` | Propre au run, dans le worktree. |

Le répertoire `.claude/worktrees/` et les liens sont ajoutés au `.git/info/exclude` du dépôt et n'entrent jamais dans un commit.

Règles que `commands/implement.md` applique dans ce mode (section « Run worktree ») :

- Le pilote reste dans le worktree du début à la fin. Il n'écrit, ne range (`git stash`) et ne change de branche nulle part dans le checkout principal. Il ne fait aucun `git stash` : la liste des stashs est commune à tous les worktrees du dépôt.
- La branche du ticket est créée sans passer par la base : `git fetch origin`, puis `git switch -c <branche> --no-track origin/<base>`. `git checkout <base>` échoue dans un worktree lié dès que le checkout principal tient cette branche. Quand la base n'existe pas sur le remote, la branche part de la référence locale.
- Une branche de ticket qui existe déjà n'est jamais écrasée (`-B` et `--force` sont interdits). Si elle est sortie dans un autre worktree, le pilote prend un nom suffixé. Si elle existe seulement en local ou sur le remote, il demande à l'utilisateur s'il continue dessus ou s'il prend un nom suffixé.
- Un répertoire de dépendances en lien symbolique n'est jamais modifié à travers le lien. `IMPL_WORKTREE_DEPENDENCIES` dit s'il y a un lien, et `test -L node_modules` le vérifie quand la variable est absente. Si la tâche ajoute, retire ou met à jour une dépendance, ou si le lockfile diffère de la base, le développeur remplace d'abord le lien par une installation réelle dans le worktree. Sinon l'installation modifierait le checkout principal et les runs en parallèle. La règle est dans `agents/developer.md` et dans `skills/collect-evidence/references/commands.md`, que lisent ceux qui lancent les contrôles.
- Deux runs du même dépôt peuvent se disputer le port du serveur de développement. Le pilote démarre l'application sur un port libre et transmet l'URL réelle aux reviewers, qui n'utilisent jamais le port par défaut de leur propre chef.
- Le pilote ne supprime ni le worktree du run ni la branche du ticket. La console retire le worktree après la fin de la session, quand le run est terminé, que la merge request existe et n'est pas en draft, que le workflow n'est pas bloqué, que la synchronisation d'archive a reçu sa réponse, que l'arbre est propre et que HEAD est sur une branche du remote. La synchronisation d'archive reste donc avant la suppression de `.claude/tasks/`. Dans tous les autres cas, la console conserve le worktree avec la raison et propose sa suppression à l'utilisateur, avec une confirmation quand du travail serait perdu. Elle ne supprime jamais la branche. Au démarrage, elle applique les mêmes règles aux worktrees des runs précédents.

Sans `IMPL_RUN_WORKTREE`, c'est-à-dire quand le plugin est utilisé sans la console, le déroulé dans le checkout est inchangé. Seule exception : une session déjà placée dans un worktree lié (`git rev-parse --git-dir` et `--git-common-dir` diffèrent) applique les mêmes règles.

## Ordonnancement d'un lot de tickets

`commands/schedule.md` compare les tickets d'un lot avant leur lancement. La console l'appelle quand plusieurs URL de tickets sont collées dans le formulaire, une fois par dépôt et par lot.

La commande tourne sans terminal (`claude -p`, Sonnet), depuis le checkout principal. Elle reçoit deux chemins absolus : un fichier d'entrée écrit par la console et le fichier de sortie à écrire. Le contrat des deux fichiers et les règles de validation sont dans `contracts/schedule.md`.

- L'entrée liste les nouveaux tickets (`tickets`) et les prédictions déjà faites pour les tickets en file, en cours ou en attente de merge (`known`). Les prédictions connues servent à la comparaison et ne sont pas recalculées.
- L'agent `ticket-scheduler` (Sonnet) lit chaque nouveau ticket avec `glab`, cherche dans le dépôt ce que le ticket toucherait, puis écrit pour chacun des fichiers, des zones, une confiance et un résumé d'une phrase.
- Il relie par une arête deux tickets qui ne peuvent pas tourner en même temps. `overlap` signale des fichiers communs ou une zone étroite commune. `depends_on` signale qu'un ticket a besoin du résultat de l'autre, d'après un lien GitLab « blocks » ou le texte du ticket, et donne l'ordre. Deux tickets du même grand module sans fichier commun n'ont pas d'arête.
- Une confiance `low` veut dire que le ticket ne permet aucune prédiction. La console le traite alors comme en conflit avec tous les tickets du dépôt.
- L'agent ne modifie rien dans le dépôt : pas d'édition, pas de changement de branche, pas d'installation. Le fichier de sortie est le seul fichier écrit, hors du dépôt. Le contenu des tickets ne va dans aucun fichier suivi.
- Un lot vide donne `{ "tickets": [], "edges": [] }` sans lancer l'agent. Une sortie qui ne respecte pas le contrat après une reprise est supprimée, et la console lit un fichier absent comme un ordonnancement en échec.

### Ce que la console fait du résultat

Le détail des modules est dans `console/README.md`, section « Lot de tickets et ordonnancement ».

- La console ne lance pas d'analyse pour un ticket seul dans son dépôt quand aucune prédiction n'y est connue. Un ticket ajouté à côté de tickets déjà prédits est analysé, même lancé seul.
- Les analyses d'un même dépôt passent l'une après l'autre et ne prennent aucune des places de `IMPL_MAX_CONCURRENT_RUNS`. Le délai est `IMPL_SCHEDULE_TIMEOUT_MINUTES` (5 minutes par défaut). Passé ce délai, la session est tuée.
- La console ne lit pas le code de sortie. Elle valide le fichier de sortie en entier et le refuse à la première règle du contrat qui échoue.
- Un fichier absent ou refusé, un délai dépassé ou un arrêt de la console pendant l'analyse marquent les tickets en échec d'analyse. Un ticket en échec d'analyse, comme un ticket `low`, est en conflit avec tous les tickets de son dépôt : ils passent un par un.
- Deux tickets de dépôts différents ne sont jamais en conflit, quoi que disent les arêtes. La règle est dans la console, pas dans l'agent.
- Un ticket en conflit avec un run en cours attend. Quand ce run se termine avec une merge request, le ticket attend qu'elle soit mergée. Une merge request fermée sans merge, ou un run terminé sans merge request, libère le ticket.
- Pour une arête `depends_on`, le premier ticket de `order` passe devant le second dans la file.
- Un ticket retenu n'occupe pas de place. Les tickets derrière lui qui ne sont en conflit avec rien démarrent.

La veille des merge requests n'utilise ni cette commande ni aucun agent. Le serveur Node appelle `glab api` toutes les 60 secondes (`IMPL_MERGE_POLL_MS`), seulement pour les merge requests qu'un ticket en file attend. Cet appel n'ouvre pas de session Claude et ne consomme aucun token. Un appel en échec donne un état inconnu, qui retient le ticket comme une merge request ouverte.

L'utilisateur peut passer outre depuis la file : départ depuis la base, qui ignore l'ordonnancement, ou départ empilé, décrit ci-dessous. Il peut aussi changer l'ordre de la file ou en retirer un ticket.

### Départ empilé

Un ticket retenu par un autre peut partir avant que la merge request du premier soit mergée. C'est une décision de l'utilisateur, prise dans la file (« Empiler sur `<branche>` »), jamais un choix de la console. Elle est proposée quand la branche du premier ticket est connue. La console passe alors `IMPL_BASE_BRANCH`, le nom de cette branche.

- `commands/implement.md` ne pose pas la question de la branche de base à l'étape 2. La base est cette branche.
- L'étape 3 crée la branche du ticket depuis `origin/<base>` après le fetch, ou depuis la référence locale, avec les règles du worktree du run. Le pilote ne sort jamais la branche de base et n'y écrit pas. Si elle n'existe ni sur le remote ni en local, il s'arrête et le signale.
- La merge request cible cette branche. Sa description dit qu'elle est empilée et sur quelle branche.
- La description porte `Closes #<iid>` malgré la cible. Quand la première merge request est mergée et sa branche supprimée, GitLab recible la seconde vers la branche où la première a été mergée. Il ferme le ticket seulement quand les commits atteignent la branche par défaut. Toute autre cible qui n'est pas la branche par défaut garde `Related to`.

Sans `IMPL_BASE_BRANCH`, rien ne change.

## Méthode QA

Le contrat est `contracts/qa.md`, la méthode `skills/review-change/references/behavioral-qa.md`. `qa-reviewer` déclare ses outils (`Bash`, `Read`, `Glob`, `Grep`, `Write`, `Skill` et Playwright) et n'a pas `Edit`.

- QA écrit `qa-plan.md` avant d'ouvrir un rapport d'auteur. Ce plan contient la matrice de comportement par critère, les classes de la grille de risques que le changement déclenche et les hypothèses de défaut, chacune avec son déclencheur et le résultat attendu.
- La grille de risques compte huit classes : saisie utilisateur, appel réseau, état persistant, travail asynchrone, données ou migration, permissions, sécurité observable, accessibilité. Le rapport dit pour chaque classe si elle est testée, non applicable (avec la raison) ou non testée (avec l'obstacle).
- QA travaille par ordre de risque. Les observations des critères et les tentatives de mise en échec passent en premier, les contrôles généraux en dernier. QA reprend un contrôle général sans le relancer quand l'appelant fournit son résultat avec l'identifiant de snapshot du code et que cet identifiant est celui du début de sa session.
- Chaque critère reçoit au moins une tentative de mise en échec exécutée. Les tentatives figurent dans la section `## Tentatives de mise en échec` du rapport et dans `qa-evidence.json`, sous forme d'items `"kind": "attempt"`. Une tentative seulement lue dans le code ne compte pas pour ce minimum.
- Un critère est MET seulement sur une observation que QA a exécutée dans sa session, sur le code livré. Une lecture de code ou la confirmation d'une preuve du développeur donne UNVERIFIED, sauf si le contrôle requis du critère a la méthode `static_analysis`.
- QA écrit le rapport et les preuves après chaque bloc de travail, pour qu'un arrêt laisse un résultat utilisable. Jusqu'au dernier bloc, le verdict écrit est `INCONCLUSIVE`.
- La section `## Rapprochement` dit ce que le plan, les rapports du développeur et du senior et les hypothèses transmises ont ajouté ou changé par rapport à `qa-plan.md`.
- Une passe ciblée reçoit un mandat : des identifiants de critères, ou le comportement qu'une correction a changé. Le plan, les tables, le minimum de tentatives et le verdict ne couvrent que ce mandat. Les autres critères sont listés HORS MANDAT et `qa-evidence.json` cite le mandat dans un tableau `"mandate"` à sa racine.

QA reçoit toujours de son appelant la référence de base et `git diff --stat <base>...HEAD`. Il reçoit aussi un worktree git jetable quand le diff ajoute ou modifie des fichiers de test, c'est-à-dire des fichiers que le lanceur de tests du dépôt collecte. Il y annule le correctif ou y réinjecte le défaut pour vérifier que les tests nouveaux ou modifiés passent au rouge : un test resté vert ne discrimine rien et devient un P1. Il y rejoue aussi une commande en échec sur la base, seule façon de montrer qu'un échec est préexistant. Les preuves sur le code livré restent prises dans le checkout livré, c'est-à-dire le worktree du run quand il en a un. Sans worktree, la sonde est non applicable : ce n'est ni un obstacle, ni un scénario manquant, ni un avertissement. La comparaison avec la base est alors indisponible, et un contrôle en échec compte contre le diff.

Les verdicts QA sont `PASS`, `PASS_WITH_WARNINGS`, `INCONCLUSIVE` et `FAIL`. Le verdict est `INCONCLUSIVE` quand un critère est UNVERIFIED, ou quand un critère est MET sans tentative de mise en échec exécutée et sans obstacle nommé.

## Méthode design

Le contrat est `contracts/design.md`, la méthode `skills/figma-review/`. Malgré son nom, cette skill s'applique avec ou sans Figma. Il ne lit pas le code du produit.

Le pilote décide de la revue design en dimensionnant la revue, d'après le diff, et annonce sa décision avec sa raison en une ligne. Avec des frames Figma, la revue a lieu dès que le changement est visible dans l'interface. Sans Figma (niveaux `ticket-mockup` et `live-neighbours`), elle a lieu seulement quand le diff modifie un composant d'interface partagé ou crée un écran ou une route. Un composant partagé est un fichier d'interface importé par plus d'un écran ou d'une route, ou rangé dans les répertoires d'interface partagée ou de design system du dépôt. Une revue hors déclencheur n'est pas une revue ratée : elle ne donne pas de ligne « design non vérifié ».

| Niveau de référence | Source | Sévérité |
| --- | --- | --- |
| `figma` | Frames fournies et lisibles. | Échelle complète. |
| `ticket-mockup` | Maquettes ou captures jointes au ticket. | Un écart établi sur l'image seule est P2 au plus, noté « à confirmer ». Il passe P1 ou P0 quand un contrôle objectif échoue sur le même élément. |
| `live-neighbours` | 2 ou 3 écrans déjà livrés, et `design-reference.md` quand le pilote le fournit. | Un écart est P1 au plus. Des écrans voisins en désaccord ne donnent aucune référence. |

Le designer utilise le niveau le plus haut que le brief permet et le déclare en tête du rapport. Une propriété que ce niveau laisse ouverte est jugée au niveau suivant. Le pilote écrit `design-reference.md` quand le dépôt a des fichiers de tokens, un document de marque ou une bibliothèque de composants, avec leurs chemins et les valeurs utiles, pour que le designer n'ouvre pas le code source.

- Le designer écrit `design-inventory.md` à partir de la référence et du brief, avant d'ouvrir une preuve d'auteur. Il mesure ensuite chaque ligne lui-même, puis rapproche ses résultats des mesures du développeur.
- Les contrôles objectifs s'appliquent à tous les niveaux, sans référence design (`skills/figma-review/references/objective-checks.md`). Ils couvrent les invariants de mise en page, la matrice d'états, le design d'interaction mesurable dans le navigateur, l'accessibilité, les thèmes, les libellés et les routes consommatrices.
- Les invariants de mise en page (pas de défilement horizontal de la page, pas de texte qui déborde sans ellipse ni défilement, pas d'enfant hors de son parent, pas de chevauchement non voulu) sont mesurés à chaque largeur requise : celles du brief, sinon 360, 768 et 1280, plus la largeur exacte de chaque frame fournie. Ils sont mesurés avec le contenu normal, puis avec la valeur la plus longue plausible, une valeur vide, et zéro, un et plusieurs éléments.
- La matrice d'états couvre huit états par élément interactif modifié : repos, survol, focus clavier, actif, désactivé, chargement, vide, erreur.
- L'accessibilité est mesurée sur la surface modifiée : contraste (4,5 pour le texte, 3 pour le grand texte, le contour des contrôles et les indicateurs de focus), parcours clavier, focus visible, rôle et nom accessible, taille de cible de 24 px CSS au moins.
- Le thème sombre et le mouvement réduit sont rejoués quand l'application les prend en charge. Leur absence est notée dans la méthode sans devenir un constat.
- Chaque libellé de l'inventaire est comparé à la chaîne de la référence, casse et ponctuation comprises.
- Le brief liste 3 à 5 routes qui consomment les composants partagés que le diff modifie. Le designer ouvre chacune et n'en ajoute aucune.
- Chaque constat cite sa référence : nœud Figma, fichier de maquette, écran voisin et valeur mesurée, token de `design-reference.md`, seuil WCAG ou invariant nommé. Une remarque sans référence va dans « Observations sans référence », section non bloquante limitée à trois lignes.

Le rapport contient une matrice de couverture, avec une ligne par écran, viewport et état ou cas de contenu requis. Une cellule est mesurée seulement si le designer l'a atteinte dans l'application, a lu ses valeurs et a gardé la paire de captures. Le verdict est `INCONCLUSIVE` quand un viewport requis ou un état explicitement requis n'est pas atteint, quand la couverture mesurée est sous 80 %, ou quand aucun niveau de référence n'a pu être établi.

Un verdict design `INCONCLUSIVE`, ou une revue déclenchée mais non lancée parce que l'application était injoignable, ne bloque pas READY. La synthèse de revue l'écrit sous `## Design non vérifié` avec la raison. Le pilote reporte la mention « design non vérifié » dans la description de la merge request, le commentaire de review et le rapport final.

## Handoff et stabilité

`how` et `why` restent en lecture seule et retournent leurs résultats à l'appelant. Le pilote peut les conserver dans `investigation-context.md`. Il contrôle question, dépôt, révision et état local pertinent avant réutilisation ; une révision identique ne suffit pas si des fichiers ont changé. Chaque skill garde son propre `references/epistemics.md` et `why` s'arrête si `how` est indisponible.

Le pilote possède les rapports développeur consolidés et la recette navigateur commune. Chaque développeur écrit sous son suffixe, y compris `browser-recipe-<suffix>.md`. Les mesures sur l'application attendent la fin des éditions concurrentes. Une continuation de mesure conserve l'historique d'implémentation et alloue de nouveaux identifiants de preuve avec `supersedes` ; l'agrégation est idempotente par identifiant.

Le designer écrit `design-inventory.md`, `designer-review.md` et `design-evidence.json.tmp`. Son appelant ajoute le snapshot de fin réellement observé, puis publie atomiquement `design-evidence.json`. Une version manquante ou instable n'est pas présentée comme vérifiée. Les consommateurs de la console continuent à lire les mêmes fichiers finaux.

La boucle complète comprend un tour initial et au plus deux reprises, QA en dernier, dans la limite temporelle existante. Une correction invalide les preuves affectées : même une dimension précédemment verte peut devoir être rejouée. Un verdict QA `INCONCLUSIVE` ne sort jamais en READY. L'orchestrateur lève l'obstacle nommé et relance QA quand la limite de tours le permet. Sinon la revue est BLOCKED et la MR part en draft, avec chaque critère non observé et son obstacle.

## Compatibilité et validation

- Les noms d'agents, commandes, fichiers finaux et champs JSON restent compatibles avec la console. Elle lit aussi `qa-plan.md`, `design-inventory.md`, le champ `kind` des items de preuve et les champs `status` et `mandate` de `qa-evidence.json`.
- Le brief d'une tâche garde son chemin concret, par exemple `developer-report-T1.md`. Le moteur s'en sert pour associer la délégation à la carte de suivi.
- Les références de contrat restent distinctes des capacités réutilisables. Leurs schémas ne sont pas copiés dans chaque skill.
- Les tests de composition vérifient les références, les préchargements, la portabilité des références `how`/`why` et la lecture des exemples de contrats par les parseurs réels.
- Les tests de structure ne prouvent pas le comportement d'un modèle. Les essais fonctionnels doivent couvrir au minimum une petite correction, un contre-exemple indépendant, une source manquante, une preuve rafraîchie, un modèle périmé et `why` privé de `how`.
- Une exécution réelle avec Figma, Playwright et GitLab reste nécessaire pour valider les intégrations de bout en bout ; les tests de la console utilisent un moteur simulé.

### Vérification de la réorganisation, 30 septembre 2026

Typecheck, build, 395 tests unitaires et 54 tests d'intégration passent. Les dix skills passent le validateur de structure. Claude Code découvre les six agents et les quatorze commandes/skills du plugin.

Un essai réel de `review-change` sur une fixture isolée détecte un seuil `> 18` contraire à la spécification `>= 18`. Le reviewer charge la référence de méthode, établit le contre-exemple avant de consulter le rapport auteur rassurant, puis distingue son constat statique d'un test exécuté. Cet essai utilise le mode `auto` du Harness, sans hooks ni connexions MCP.

Dans un mode restrictif comme `dontAsk`, une référence du plugin située hors du dépôt cible peut être refusée faute d'autorisation de lecture. Le chargement du catalogue ne prouve donc pas à lui seul que les fichiers annexes sont accessibles. Respecter le refus et signaler la méthode indisponible ; les permissions de l'hôte restent applicables. Voir la [documentation des permissions de Claude Code](https://code.claude.com/docs/en/permissions).

### Vérification de la refonte des reviewers, 2 octobre 2026

Typecheck, build, 443 tests unitaires et 59 tests d'intégration passent sur la branche `feat/reviewer-detection`. Le dépôt compte onze skills. Aucun run sur un ticket réel n'a encore exercé les nouvelles règles de revue QA et design.

### Vérification de la commande d'ordonnancement, 3 octobre 2026

Essai réel de `/implementation-harness:schedule` avec `claude -p` (Claude Code 2.1.288), depuis un dépôt git jetable, sur un lot vide. La commande du plugin est résolue en mode non interactif, le fichier de sortie contient `{ "tickets": [], "edges": [] }` et le processus sort avec le code 0 en 9 à 12 secondes.

```bash
claude -p --plugin-dir <plugin> --add-dir <plugin> --add-dir <répertoire de sortie> \
  --model sonnet --permission-mode dontAsk --permission-prompts none \
  --allowedTools "Read,Write,Glob,Grep,Agent,Skill,Bash(glab issue view *),Bash(glab api *),Bash(git log *),Bash(git show *),Bash(git grep *),Bash(git ls-files *),Bash(git rev-parse *),Bash(ls *),Bash(rm <répertoire de sortie>/*)" \
  --output-format json -- "/implementation-harness:schedule <entrée> <sortie>"
```

- `--permission-mode auto` fonctionne aussi, sans liste d'outils.
- `--allowedTools` accepte plusieurs valeurs. Écrit en arguments séparés, il absorbe le prompt et `claude -p` sort avec le code 1 (« Input must be provided »). La liste va dans un seul argument séparé par des virgules, et `--` précède le prompt.
- En `dontAsk` sans `Write` dans la liste, l'écriture est refusée et le processus sort quand même avec le code 0. Le code de sortie ne dit donc rien du résultat : la console lit le fichier de sortie.
- Un second essai avec une URL de ticket inventée a exercé l'agent : il est lancé depuis la session non interactive, `glab` passe la liste d'outils, et le ticket illisible sort en `low`. Aucun ticket réel n'a été lu, donc la qualité des prédictions n'est pas vérifiée.

### Vérification de l'ordonnancement des lots, 3 octobre 2026

Typecheck et build passent, ainsi que 627 tests unitaires. La suite d'intégration donne 68 tests réussis et 1 échec, `terminal.spec.ts:12`, déjà en échec avant ce changement et sans lien avec les lots.

Ces tests remplacent `claude` et `glab` par les simulateurs de `console/tests/fake-claude/`. L'ordonnancement n'a pas encore tourné sur une vraie instance GitLab : ni la lecture d'un ticket réel par l'agent, ni l'appel `glab api` de la veille des merge requests, ni un départ empilé.
