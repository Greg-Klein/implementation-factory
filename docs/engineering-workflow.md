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
| `figma-review` | Comparaison d'une application avec une référence Figma. | Mesures, écarts, observations pour QA et éléments non vérifiés. |
| `document-change` | Documentation rendue obsolète par un changement autorisé. | Mise à jour de la documentation existante et des décisions nécessaires. |
| `glab-gitlab-api` | Opération GitLab choisie et autorisée par l'appelant. | Recette adaptée et vérification du résultat. |

`gitlab-tickets` conserve ses conventions Synapse. Ces conventions ne deviennent pas des principes d'ingénierie universels.

Les skills s'appellent sous leur nom qualifié dans le plugin, par exemple `implementation-harness:how`. Les agents techniques disposent de la découverte dynamique des skills. Le designer, sans outil `Skill`, précharge uniquement `implementation-harness:figma-review` et peut lire son entrée et ses références si le préchargement n'est pas disponible. Cette lecture documentaire ne lui permet pas de lire le code produit.

Le champ natif `skills:` précharge le corps de la skill : le mettre sur toutes les capacités déplacerait le texte sans réduire le contexte. Les autres méthodes et leurs références restent conditionnelles. Les droits de l'agent continuent à borner toute méthode chargée.

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
| Accessibilité et contrats de sélecteurs | Developer et QA ; la revue visuelle ne remplace pas ces vérifications. |
| Fidélité Figma et responsive | Designer via `figma-review`, avec observation du frame et correction limitée au ticket. |
| Documentation et décisions | `document-change` dans le périmètre d'écriture autorisé. |
| Résultats reproductibles | `collect-evidence` ; interprétation séparée par chaque rôle. |
| Fraîcheur et traçabilité | Contrat de preuves, snapshots, identifiants immuables et supersession. |

L'analyse d'impact autonome et le diagnostic de bugs dédié restent des évolutions possibles. Leurs principes sont appliqués dans les rôles actuels ; aucune nouvelle étape obligatoire n'est ajoutée pour eux.

## Indépendance de la revue

La méthode d'autovérification du développeur n'est pas le plan de revue. Les reviewers commencent par la spécification, les consommateurs et le code ; ils formulent leurs attentes et leurs contre-exemples avant de consulter les conclusions de l'auteur. Ils consignent cette base initiale dans leur rapport existant, puis confrontent leurs résultats aux rapports du développeur.

`collect-evidence` peut être partagé : il décrit comment exécuter un contrôle et conserver le résultat, sans choisir les scénarios ni juger leur suffisance. Partager une recette d'accès à un état ne signifie pas partager le résultat attendu ; les stubs et les fixtures restent contestables.

Le senior reste correctif, en deux phases : diagnostic indépendant, puis corrections justifiées. QA vérifie le code final après ces corrections. Au niveau de revue le plus léger, une correction du senior déclenche une vérification QA ciblée, ou demeure explicitement non vérifiée si le budget de revue l'empêche.

L'indépendance ne garantit pas l'absence de biais. Un diagnostic déjà présent dans le brief est déclaré comme tel, puis une explication concurrente est examinée. Les reprises exposent nécessairement les constats du tour précédent. Aucun quota de défauts n'est imposé.

## Handoff et stabilité

`how` et `why` restent en lecture seule et retournent leurs résultats à l'appelant. Le pilote peut les conserver dans `investigation-context.md`. Il contrôle question, dépôt, révision et état local pertinent avant réutilisation ; une révision identique ne suffit pas si des fichiers ont changé. Chaque skill garde son propre `references/epistemics.md` et `why` s'arrête si `how` est indisponible.

Le pilote possède les rapports développeur consolidés et la recette navigateur commune. Chaque développeur écrit sous son suffixe, y compris `browser-recipe-<suffix>.md`. Les mesures sur l'application attendent la fin des éditions concurrentes. Une continuation de mesure conserve l'historique d'implémentation et alloue de nouveaux identifiants de preuve avec `supersedes` ; l'agrégation est idempotente par identifiant.

Le designer écrit `design-evidence.json.tmp`. Son appelant ajoute le snapshot de fin réellement observé, puis publie atomiquement `design-evidence.json`. Une version manquante ou instable n'est pas présentée comme vérifiée. Les consommateurs de la console continuent à lire les mêmes fichiers finaux.

La boucle complète comprend un tour initial et au plus deux reprises, QA en dernier, dans la limite temporelle existante. Une correction invalide les preuves affectées : même une dimension précédemment verte peut devoir être rejouée.

## Compatibilité et validation

- Les noms d'agents, commandes, fichiers finaux et champs JSON restent compatibles avec la console.
- Le brief d'une tâche garde son chemin concret, par exemple `developer-report-T1.md`. Le moteur s'en sert pour associer la délégation à la carte de suivi.
- Les références de contrat restent distinctes des capacités réutilisables. Leurs schémas ne sont pas copiés dans chaque skill.
- Les tests de composition vérifient les références, les préchargements, la portabilité des références `how`/`why` et la lecture des exemples de contrats par les parseurs réels.
- Les tests de structure ne prouvent pas le comportement d'un modèle. Les essais fonctionnels doivent couvrir au minimum une petite correction, un contre-exemple indépendant, une source manquante, une preuve rafraîchie, un modèle périmé et `why` privé de `how`.
- Une exécution réelle avec Figma, Playwright et GitLab reste nécessaire pour valider les intégrations de bout en bout ; les tests de la console utilisent un moteur simulé.

### Vérification de la réorganisation, 30 septembre 2026

Typecheck, build, 395 tests unitaires et 54 tests d'intégration passent. Les dix skills passent le validateur de structure. Claude Code découvre les six agents et les quatorze commandes/skills du plugin.

Un essai réel de `review-change` sur une fixture isolée détecte un seuil `> 18` contraire à la spécification `>= 18`. Le reviewer charge la référence de méthode, établit le contre-exemple avant de consulter le rapport auteur rassurant, puis distingue son constat statique d'un test exécuté. Cet essai utilise le mode `auto` du Harness, sans hooks ni connexions MCP.

Dans un mode restrictif comme `dontAsk`, une référence du plugin située hors du dépôt cible peut être refusée faute d'autorisation de lecture. Le chargement du catalogue ne prouve donc pas à lui seul que les fichiers annexes sont accessibles. Respecter le refus et signaler la méthode indisponible ; les permissions de l'hôte restent applicables. Voir la [documentation des permissions de Claude Code](https://code.claude.com/docs/en/permissions).
