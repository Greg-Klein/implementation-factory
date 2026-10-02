# Agents, skills et revue indépendante

Le Harness sépare les responsabilités des agents, les méthodes réutilisables et les formats consommés par la console. Les dossiers `commands/`, `agents/`, `skills/` et `hooks/` restent à la racine du plugin.

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
| Fidélité à la référence design (`figma`, `ticket-mockup` ou `live-neighbours`) et responsive | Designer via `figma-review`, dès que le changement est visible et l'app joignable, avec observation du frame et correction limitée au ticket. |
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
| 1 | `senior-reviewer`, puis `designer-reviewer` si le changement est visible dans l'interface et l'application joignable, puis `qa-reviewer`, une fois chacun. Le pilote enchaîne les agents et fait pour eux ce que l'orchestrateur fait au niveau 2. | Sonnet, par surcharge à l'appel. |
| 2 | `review-orchestrator` conduit la boucle complète. | Opus, le modèle par défaut de `senior-reviewer`, `designer-reviewer` et `qa-reviewer`. L'orchestrateur ne passe aucune surcharge. |

L'appelant du designer prend l'identifiant de snapshot du code avant et après la revue, puis publie `design-evidence.json`. L'appelant de QA crée le worktree jetable et le supprime au retour de QA. Au niveau 2 l'appelant est l'orchestrateur, aux niveaux 0 et 1 le pilote. La création et la suppression de ce worktree sont les seules opérations git de l'orchestrateur.

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

QA reçoit de son appelant un worktree git jetable, la référence de base et `git diff --stat <base>...HEAD`. Il y annule le correctif ou y réinjecte le défaut pour vérifier que les tests nouveaux ou modifiés passent au rouge : un test resté vert ne discrimine rien et devient un P1. Il y rejoue aussi une commande en échec sur la base, seule façon de montrer qu'un échec est préexistant. Les preuves sur le code livré restent prises dans le checkout principal. Sans worktree, ces deux contrôles sont notés non testés avec cet obstacle.

Les verdicts QA sont `PASS`, `PASS_WITH_WARNINGS`, `INCONCLUSIVE` et `FAIL`. Le verdict est `INCONCLUSIVE` quand un critère est UNVERIFIED, ou quand un critère est MET sans tentative de mise en échec exécutée et sans obstacle nommé.

## Méthode design

Le contrat est `contracts/design.md`, la méthode `skills/figma-review/`. Malgré son nom, cette skill s'applique avec ou sans Figma. `designer-reviewer` intervient dès que le changement est visible dans l'interface et que l'application est joignable. Il ne lit pas le code du produit.

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

Un verdict design `INCONCLUSIVE`, ou une revue non lancée parce que l'application était injoignable, ne bloque pas READY. La synthèse de revue l'écrit sous `## Design non vérifié` avec la raison. Le pilote reporte la mention « design non vérifié » dans la description de la merge request, le commentaire de review et le rapport final.

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
