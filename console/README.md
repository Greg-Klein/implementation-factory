# Implementation Harness

Interface locale pour piloter la commande `/implementation-harness:implement` avec le véritable exécutable Claude Code. Le harnais n’utilise pas directement l’API Anthropic et ne demande aucune clé API. Le [README principal](../README.md#installation-en-une-commande) présente l’installation et l’usage quotidien avec `impl`.

## Prérequis

- Claude Code installé et connecté (`claude --version`)
- Node.js 22.12 ou plus récent
- `glab` installé et authentifié pour accéder aux tickets et merge requests GitLab
- les MCP utilisés par le workflow, notamment Playwright et Figma quand un ticket contient une maquette

`node-pty` est un module natif. Sur une nouvelle machine, son installation peut nécessiter les outils de compilation du système, par exemple Xcode Command Line Tools sur macOS.

## Lancer la console

Depuis ce dossier :

```bash
npm install
npm run dev
```

Puis ouvrir <http://127.0.0.1:3210>.

Renseigner le chemin local du projet et l’URL du ticket. Le harnais démarre Claude Code dans ce projet avec le plugin voisin :

```bash
claude --plugin-dir /chemin/vers/implementation-harness "/implementation-harness:implement <ticket>"
```

La commande et les agents restent dans le dossier `implementation-harness`; rien n’est installé dans `~/.claude`.

## Ce que montrent les panneaux

Le panneau de discussion est lu dans le transcript de la session, et Claude Code n’y écrit un message qu’une fois revenue l’action qui l’a suivi. Un paragraphe peut donc y arriver avec une minute de retard sur le terminal, qui est la seule vue vraiment live. Tant que la session produit de la sortie, le panneau affiche « Claude écrit… » pour dire que le dernier message visible n’est pas le dernier état du run.

Le flux d’activité ne garde que les jalons du workflow : agents, documents, branche, merge request, décisions attendues. Le détail des commandes reste dans le terminal.

Le harnais ne réclame l’attention que quand il est vraiment arrêté : une décision attendue, une demande de permission, un incident (plus aucune action en cours, résultat manquant, session interrompue), la fin ou l’échec du run. Un simple silence n’est qu’un doute, signalé une fois.

## Qui peut faire avancer ce run ?

La santé d’un run est une projection à part de son statut (`server/run-health.ts`, logique pure, horloge injectée). Elle ne lit que des signaux structurés : fin de tour du pilote (`Stop`), début et fin des sous-agents, appels d’outils appariés par `tool_use_id` et rattachés à leur agent (`agent_id`), type des notifications (`permission_prompt`, `elicitation_dialog`), appels en arrière-plan (`run_in_background`, `Monitor`), documents archivés, et `workflow-state.json`, que le pilote écrit à chaque transition pour dire ce qu’il attend (contrat dans `commands/implement.md`, section « Workflow state »). La sortie du terminal, un spinner compris, n’est jamais une progression.

| Situation observée | Santé | Ce que montre la console |
|---|---|---|
| Question, permission ou saisie attendue | attente | le panneau de question, ou « Ouvrir le terminal » |
| Agent, commande ou tâche de fond au travail | sain ou attente | rien ; au-delà du seuil de silence, un doute |
| Silence prolongé (`IMPL_STALL_MINUTES`, 10 par défaut) | doute | « Aucune progression observée », sans rien arrêter ni relancer |
| Le pilote a rendu la main, rien ne tourne, rien n’est attendu, workflow inachevé | incident après 60 s | « Plus aucune action en cours » |
| Un agent a fini sans le fichier que son contrat exige, et personne n’a pris la suite | incident après 30 s | « Rapport QA attendu », « Rapport de T3 attendu »… |
| Aucune tâche restante exécutable (dépendance absente ou circulaire) | incident | « Plan bloqué par ses dépendances » |
| Session sortie avant un résultat, quel que soit son code | interruption | « Session interrompue » |

Une attente déclarée dans `workflow-state.json` ne masque jamais un blocage longtemps : `await_agent` sans agent actif reste une absence de prochaine action, les autres attentes deviennent un doute au seuil de silence. Une fin déclarée n’est prise que si elle tient face au livrable (merge request vue, ou blocages écrits). Sans ce fichier (prompts anciens), le détecteur s’en tient aux hooks et le dit dans son diagnostic. Après une mise en veille de la machine, toutes les grâces repartent du réveil.

Un incident est unique par cause stable (empreinte), notifié une fois, enregistré dans `run.json` et clos seulement sur l’événement qui lève sa cause : le pilote agit de nouveau, le fichier arrive, ou l’utilisateur le classe. Les actions proposées sont seulement celles qui peuvent s’exécuter :

- **Demander la continuation** : session active, pilote au repos, aucun agent, outil, question ni permission en cours. La console soumet à la session existante une instruction qui lui demande de relire le contexte, le plan, les rapports et l’état Git, de garder fichiers et commits, et de ne pas repartir de l’étape 1. L’incident reste ouvert, « continuation demandée », jusqu’à ce que la reprise soit observée.
- **Ouvrir le terminal**, **Arrêter**, **Classer comme faux positif** (avec un motif), et le diagnostic repliable.

Chaque action part avec la révision de l’incident affichée et un identifiant de requête : le serveur revérifie tout juste avant l’effet, refuse une action décidée sur un état qui a bougé, et n’exécute qu’une fois une requête envoyée par deux fenêtres. La décision est écrite avant l’effet ; après un arrêt entre les deux, elle reste « issue inconnue » et n’est jamais rejouée.

Au redémarrage, un run trouvé en cours reçoit un incident d’interruption, une seule fois, et sa question sans session est gardée comme contexte. Les runs restés avec un incident ouvert apparaissent sous « Interrompus », en lecture seule, par des routes séparées (`/api/archive/…`) : ni session, ni place, ni dépôt tenu. Les classer les retire de la liste ; leur archive reste sur disque. `/?demo=incident` joue un run dont le pilote rend la main sans suite, pour voir le détecteur et la continuation sans dépôt.

Limites : aucune reprise d’une session Claude Code perdue (le contrat moteur ne le permet pas encore), aucun superviseur LLM, aucun agent recréé automatiquement.

## Preuves par critère d’acceptation

L’onglet Preuves répond à une question : qu’est-ce qui a réellement été vérifié ? Il part du registre des critères que le pilote écrit après la clarification (`.claude/tasks/acceptance-criteria.json`), des liens tâche → critère du plan (`criterion_ids` dans `planner-output.json`) et des fichiers de preuves (`dev-evidence*.json`, `qa-evidence*.json`, `design-evidence*.json`). Les contrats de ces fichiers sont décrits dans `commands/implement.md` (« Write the acceptance criteria registry » et « Evidence contract »).

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
- Un run sans registre (ancien run resté sur l’ancien contrat) affiche « Traçabilité par critère indisponible pour ce run » et garde ses rapports lisibles. Des critères reconstruits depuis un ancien plan sont signalés comme tels et restent non vérifiés.

`server/evidence-archive.ts` archive chaque version utile de ces fichiers sous un chemin immuable, avec son empreinte et sa date de réception, et copie dans cette version les captures qu’elle cite : une capture remplacée au tour 2 sous le même nom reste distincte de celle du tour 1. Une même preuve vue deux fois (fichier par tâche puis fichier fusionné, copie `-roundN`) compte une fois grâce à son identifiant. Un fichier surpris à moitié écrit devient un diagnostic et la dernière version valide reste en vigueur. Avant de supprimer `.claude/tasks/`, le workflow écrit `archive-sync-request.json` et attend `archive-sync-ack.json` : le serveur a alors tout réarchivé.

Le même calcul produit `acceptance-summary.md` et `acceptance-summary.json`, que le serveur dépose dans `.claude/tasks/` pour la merge request : une phrase de bilan et les critères non vérifiés pour la description, le tableau détaillé pour le commentaire de review. Les captures y sont nommées par leur chemin local et marquées comme telles : le workflow ne les lie dans GitLab qu’après upload.

Limites de cette version : aucune commande n’est encore corrélée à son résultat par les événements du moteur, tout résultat reste donc déclaré par l’agent qui l’écrit ; le serveur ne peut pas vérifier le contenu d’une preuve, seulement sa cohérence et sa version.

## Architecture du serveur

| Module | Rôle |
|---|---|
| `server/index.ts` | serveur HTTP et WebSocket, cycle de vie du run |
| `server/engine/` | **la seule partie qui sait quel agent est piloté** (voir son README) |
| `server/hooks.ts` | applique les événements du moteur à l’état du run |
| `server/transcript.ts` | suit le fichier de dialogue de la session |
| `server/artifacts.ts` | archive les documents produits avant leur nettoyage |
| `server/acceptance.ts` | couverture des critères d’acceptation, logique pure, et synthèse de merge request |
| `server/evidence-archive.ts` | versions immuables des registres, plans, preuves et captures d’un run |
| `server/acceptance-runtime.ts` | ingestion, identification du code, recalcul et synthèse remise au workflow |
| `server/run-health.ts` | qui peut faire avancer un run : signaux, matrice de détection, logique pure |
| `server/run-incidents.ts` | vie d’un incident, validation des actions, lecture des archives, logique pure |
| `server/run-monitor.ts` | ordonnanceur unique de la santé des runs vivants |
| `server/run-archive.ts` | runs d’un processus précédent restés avec un incident, en lecture seule |
| `server/workflow-state.ts` | lecture de `workflow-state.json` et vérification d’une fin déclarée |
| `server/self-improvement.ts` | retours, auto-audit et boucle d’amélioration |
| `server/domain.ts` | logique pure, sans agent ni système de fichiers |

`server/domain.ts` et `server/engine/` sont les deux endroits testables sans rien lancer, et c’est là que vit l’essentiel de la logique.

## Copier sur une autre machine

Copier ou cloner le dossier `implementation-harness` complet, puis exécuter les commandes d’installation ci-dessus dans `implementation-harness/console`. Le chemin du dépôt traité est choisi dans l’interface, il peut donc être différent sur chaque machine.

## Données locales

Chaque exécution est conservée dans `console/data/runs/<run-id>/` :

- `run.json` contient l’état, les agents et le journal d’activité;
- `terminal.log` contient la sortie brute du terminal;
- `artifacts/` reçoit une copie des documents produits dans `.claude/tasks/` avant leur nettoyage. Seuls les documents lisibles y sont copiés : les captures et les assets téléchargés restent dans le dépôt, sous `.claude/tasks/assets/`, sauf celles qu’un fichier de preuves cite;
- `evidence/` garde chaque version du registre, du plan et des fichiers de preuves (`<fichier>/v<n>.json`), les captures de chaque version (`<fichier>/v<n>/assets/…`) et leur index (`index.json`);
- `acceptance/` contient la dernière synthèse de couverture, en Markdown et en JSON;
- `snapshots.jsonl` journalise chaque identifiant de code pris par la session.

`run.json` est écrit en entier puis renommé, une écriture après l’autre : une lecture ne voit jamais un fichier à moitié écrit, et le dernier état publié est celui qui reste.

Le dossier `data/` est ignoré par Git.

Au démarrage, le serveur referme tout run resté sur un statut non terminal (`starting`, `running`, `attention`) : `ctx.state` repart vide à chaque lancement, donc un run que le processus précédent n'a pas pu clore lui-même (arrêt brutal, `impl restart`) resterait sinon marqué "running" indéfiniment. Il est reclassé "failed" avec un message l'expliquant, distinct d'un échec de l'agent.
