# Implementation Harness

Implementation Harness est une interface locale pour piloter Claude Code pendant l’implémentation d’un ticket GitLab. On colle l’URL du ticket, le harnais détecte le checkout correspondant, ouvre un terminal Claude Code et rend visibles la progression, les agents, les outils et les livrables.

Le dépôt contient un plugin Claude Code dont la commande `/implementation-harness:implement` orchestre le travail : lecture du ticket, questions de clarification, planification, implémentation, tests, revues spécialisées et préparation de la merge request. Le harnais constitue la couche visuelle de cette commande. Il utilise la connexion Claude Code déjà présente sur la machine et ne fait aucun appel direct à l’API Anthropic.

L’interface s’utilise dans une **application de bureau Electron** ou dans le navigateur via la commande `impl`. Les deux modes partagent le même workflow, les terminaux interactifs et la gestion des runs en parallèle.

## Application de bureau Electron

### Démarrer depuis le dépôt

Installer Node.js 22.12 ou plus récent, puis, depuis la racine du dépôt :

```bash
cd console
npm install
npm run desktop:dev
```

La fenêtre s’ouvre avec son serveur local embarqué. Electron choisit un port libre sur `127.0.0.1` et gère le démarrage ainsi que l’arrêt du serveur. Il peut fonctionner à côté de la console web lancée avec `impl`.

Pour traiter un ticket, la machine doit disposer de Claude Code connecté, de Git et de `glab` authentifié. Node reste nécessaire aux hooks du plugin et les MCP du workflow doivent être configurés dans Claude Code. Le PATH du shell de connexion est récupéré au lancement depuis le Finder pour retrouver ces outils.

### Installer une version macOS

Une fois le DMG construit, l’ouvrir, copier **Implementation Harness.app** dans **Applications**, puis lancer l’application depuis le Finder ou le Dock. Le ZIP contient la même application. Le serveur et le plugin sont inclus : le paquet embarque les commandes, les agents, les hooks et les skills du harnais, et un run n’emprunte rien à la configuration Claude Code de la machine. Aucune commande `impl` n’est nécessaire pour ouvrir la fenêtre. Seul le binaire `claude` reste à installer.

L’application est testée sur **macOS Apple Silicon**. La configuration d’empaquetage prévoit aussi Linux et Windows, mais ces plateformes nécessitent encore une validation complète.

### Fonctions natives

| Fonction | Comportement |
|---|---|
| Sélection du projet | **Parcourir les dossiers…** ouvre le sélecteur natif ; la détection depuis l’URL GitLab reste disponible |
| Notifications système | une décision, une demande d’attention ou la fin d’un run déclenche une notification lorsque la fenêtre n’a pas le focus ; cliquer affiche le run concerné |
| Badge du Dock | indique le nombre de runs qui attendent une réponse ou une intervention |
| Indicateur d’activité | signale les sessions ouvertes sur le Dock ou la barre des tâches, selon le système |
| Menus et raccourcis | `⌘N` / `Ctrl+N` ouvre un nouveau run ; les menus donnent accès au zoom, aux données locales, à la configuration et aux outils de développement |
| Préférences | la taille et la position de la fenêtre ainsi que le réglage sonore sont conservés entre les lancements |
| Instance unique | ouvrir une seconde fois l’application ramène à la fenêtre existante |

Le bouton haut-parleur active les signaux sonores de l’interface, coupés par défaut. L’affichage des notifications dépend aussi des réglages de notifications du système.

Sur macOS, **fermer la fenêtre la masque et laisse les runs continuer**. Le Dock ou le menu **Afficher l’application** la ramène. **Quitter** demande confirmation si des sessions sont encore ouvertes, arrête leurs terminaux et conserve les demandes en file pour le prochain lancement.

Les liens vers les tickets et merge requests s’ouvrent dans le navigateur par défaut. La fenêtre Electron est isolée du système : le preload expose seulement les fonctions natives nécessaires, sans donner accès à Node à l’interface.

### Compiler et empaqueter

Depuis `console/` :

| Commande | Résultat |
|---|---|
| `npm run desktop:dev` | compile le serveur Electron et lance l’interface avec rechargement des changements frontend |
| `npm run desktop:build` | compile l’interface de production, le serveur et l’icône |
| `npm run desktop:start` | ouvre la dernière compilation de production ; nécessite `desktop:build` au préalable |
| `npm run desktop:pack` | compile puis produit une application dans `console/release/`, sans installateur |
| `npm run desktop:dist` | compile et produit les installateurs de la plateforme courante |
| `npm run desktop:dist:signed` | produit le DMG et le ZIP macOS en exigeant une signature Developer ID valide |

Construire sur la plateforme et l’architecture cibles. Sur un Mac Apple Silicon, le `.app` est créé dans `console/release/mac-arm64/` et les fichiers `.dmg` et `.zip` dans `console/release/`. Les données des runs, la configuration `.env` et les caches de développement sont exclus du paquet.

### Signature macOS et notarisation

La signature utilise un certificat **Developer ID Application** et sa clé privée présents dans le trousseau. Depuis `console/` :

```bash
security find-identity -v -p codesigning
npm run desktop:dist:signed
```

`CSC_NAME` permet de sélectionner le certificat si plusieurs sont disponibles. La construction active Hardened Runtime. Sans profil de notarisation, elle produit une application signée mais non notarisée.

Pour ajouter la notarisation, enregistrer les identifiants dans le trousseau avec l’invite interactive de `notarytool`, puis fournir uniquement le nom du profil à la construction :

```bash
xcrun notarytool store-credentials "implementation-harness"
IMPL_NOTARY_PROFILE="implementation-harness" npm run desktop:dist:signed
```

Le hook soumet l’application signée à Apple, attend son acceptation, puis agrafe et vérifie le ticket avant de créer les installateurs. Un rejet fait échouer la construction. Les identifiants restent dans le trousseau.

Les chemins de données, les tests et les détails techniques sont aussi décrits dans le [guide de la console et de l’application Electron](console/README.md).

## Console web : installation en une commande

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

## Console web : utilisation

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

`impl status` ne se contente pas de chercher un processus. Il interroge `/api/runs`, puis demande au serveur chaque ressource `/_next/static/` que la page référence. Un serveur qui tourne encore sur un build précédent répond avec un manifeste dont les fichiers ont été effacés par la recompilation, et c’est ce qui produit une page sans style. Ses codes de sortie : `0` en écoute et cohérent, `1` en écoute mais incohérent, `3` arrêté.

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

`impl` détecte un harnais déjà en écoute et se contente d’ouvrir le navigateur. Après une recompilation de l’interface, le serveur en cours sert encore l’ancien manifeste Next.js et les feuilles de style renvoient une erreur : la page s’affiche alors sans aucun style. `impl restart` arrête le serveur du port courant, attend la libération du port et relance la version compilée. Il se combine avec le mode démo (`impl restart demo`) et n’arrête rien si son argument est invalide.

Le navigateur s’ouvre sur <http://127.0.0.1:3210>.

## Piloter les runs

Dans la fenêtre Electron comme dans la console web :

1. coller l’URL du ticket GitLab;
2. vérifier le projet détecté ou renseigner son chemin;
3. ajouter si nécessaire une instruction propre à cette exécution;
4. lancer le workflow et répondre aux décisions dans le panneau dédié ou échanger librement dans le terminal.

### Plusieurs runs en parallèle

Le harnais tient plusieurs runs à la fois. La colonne de gauche les liste, du plus récent au plus ancien, et le run sélectionné s’affiche à droite. Chaque ligne donne le dépôt et le ticket, l’étape atteinte, ce que fait l’agent à cet instant, et une pastille orange quand une décision attend une réponse. Le bouton **+** en haut de la liste ramène au formulaire de lancement sans interrompre les runs en cours.

Deux limites encadrent le parallélisme :

- **un run par dépôt**. Deux sessions Claude Code dans le même checkout se disputeraient la branche, le dossier `.claude/tasks` et leurs propres modifications. Un dépôt reste tenu tant que sa session est ouverte, y compris après la fin du workflow : la session attend encore à son prompt et peut toujours écrire;
- **`IMPL_MAX_CONCURRENT_RUNS` sessions au total** (3 par défaut). Chacune est une vraie session Claude Code, avec son quota et son CPU.

Un lancement qui bute sur l’une des deux n’est pas refusé : il part en file d’attente, visible sous la liste avec la raison de l’attente, et démarre tout seul dès qu’une place et son dépôt se libèrent. Une demande dont le dépôt est encore occupé ne bloque pas celles qui la suivent. La file est enregistrée dans `queue.json`, sous le [dossier de données du mode utilisé](#configuration), et survit à un redémarrage : les demandes en attente démarrent dès que le serveur écoute à nouveau, sans que personne ne les relance. Une croix retire une demande de la file.

Un run terminé dont la session est encore ouverte garde sa place. Le bouton **Libérer la place** ferme cette session et laisse la file avancer. Une fois la session fermée, l’icône corbeille de sa ligne, ou le bouton **Fermer** de la vue, retire le run de la liste. Ses documents, sa conversation et son journal restent archivés dans `runs/<id>/`, sous le dossier de données.

Les notifications, le titre de l’onglet et son icône parlent pour tous les runs à la fois, pas seulement pour celui qui est ouvert : le run qui réclame une réponse est rarement celui qu’on regarde. Les messages qui ne concernent aucun run en particulier (une demande mise en file, une amélioration rebasée) s’affichent dans un bandeau sous l’en-tête.

L’onglet **Suivi** affiche les tâches du plan (`planner-output.json`) en trois colonnes, To Do, In Progress et Done. Une tâche passe en cours quand l’orchestrateur la confie à un agent `developer`, et terminée quand son rapport `developer-report-<id>.md` est écrit. Chaque agent d’un run reçoit un prénom et une photo, dans l’ordre où il démarre, et la carte montre l’agent qui porte la tâche, sous la forme « Tom · Dev ». Le même nom apparaît dans le panneau des agents.

Le bouton **Documents générés** ouvre un lecteur intégré pour consulter le contexte du ticket, les plans, rapports de tests, reviews et descriptions de MR conservés pendant le run.

Le lecteur n’interrompt pas l’exécution. Si Claude Code pose une question pendant sa consultation, un bandeau signale la décision attendue et le bouton **Répondre** referme le lecteur pour afficher la carte de clarification.

Le panneau de progression récapitule le livrable du run : le ticket, la branche de travail dès que le workflow la crée, et la merge request dès qu’elle est ouverte. Le ticket et la merge request sont cliquables, la branche est là pour être relue. La merge request est lue dans la sortie de la commande qui l’ouvre, donc elle apparaît sans que le workflow ait à la déclarer.

Un run dure longtemps et n’a pas à être surveillé. Dans la console web, le titre de l’onglet et son icône suivent l’état des runs, et le navigateur envoie une notification système quand une décision attend une réponse, quand la session réclame de l’attention et quand le run se termine. La permission du navigateur est demandée au premier lancement, et une notification ne part que si la page n’est pas au premier plan. L’application Electron utilise les notifications natives décrites plus haut.

Le bouton haut-parleur de l’en-tête ajoute un signal sonore aux mêmes trois moments : une montée à deux notes quand quelque chose est attendu de toi, une résolution à trois notes quand le run est fini. Il est **coupé par défaut** et le réglage est mémorisé dans le navigateur ou dans les préférences de l’application Electron. L’activer joue le signal tout de suite, pour que le réglage se prouve sans attendre un run.

Le son vient de l’interface, pas du modèle, et c’est ce qui le rend juste : il part à l’instant exact où la question devient bloquante, alors qu’un son demandé au modèle arrivait en avance et pouvait être oublié. Deux réserves à connaître : un navigateur interdit à une page d’émettre du son avant une interaction, donc le tout premier signal d’une session ouverte sans un clic reste muet, et deux onglets ouverts sur le harnais sonnent deux fois.

Le harnais exécute Claude Code dans le projet sélectionné avec le plugin de ce dépôt, ou sa copie embarquée dans l’application installée. Aucun fichier du plugin n’est copié dans `~/.claude`.

Quand Claude Code utilise `AskUserQuestion`, le harnais présente les décisions dans un panneau dédié : les choix suggérés peuvent remplir la réponse, qui reste éditable dans un champ de texte avant son envoi. La réponse est transmise à Claude Code par le hook en attente. Le terminal intégré reste visible et interactif pendant toute l’exécution pour les échanges libres et les commandes qui ne passent pas par ce panneau.

## Configuration

### Application Electron

Le menu **Implementation Harness → Réglages…** (`⌘,` sur macOS, `Ctrl+,` ailleurs) ouvre une fenêtre dédiée :

| Rubrique | Réglages |
|---|---|
| Général | Dossiers de recherche, avec sélection native et un dossier par ligne ; son des alertes |
| Exécutions | Nombre de runs en parallèle (1 à 10), accès à distance, auto-audit |
| Prompts | Instructions système ajoutées à chaque session, commandes, agents et skills du plugin |
| Avancé | Dépôt Git du harnais utilisé pour l’auto-amélioration ; durée des étapes de démo en secondes |

**Enregistrer** valide les champs et conserve les autres valeurs du fichier de configuration. Les changements prennent effet avec **Redémarrer l’application** ; si des sessions sont ouvertes, une confirmation prévient de leur arrêt. La file d’attente est conservée. Le son s’applique immédiatement et reste synchronisé avec le bouton de l’en-tête.

La rubrique **Prompts** modifie les instructions sans toucher au plugin : chaque prompt modifié est enregistré dans `data/prompts/` et s’applique aux runs lancés ensuite. Un run démarre alors sur une copie du plugin placée dans son dossier (`data/runs/<run>/plugin`), si bien que les runs en cours gardent les prompts de leur lancement. L’en-tête YAML reste obligatoire et le champ `name` ne peut pas changer, car le workflow y fait référence. **Rétablir l’original** supprime la version personnalisée, et un avertissement signale un prompt dont l’original a changé depuis (mise à jour ou auto-amélioration). Les sessions d’auto-amélioration travaillent toujours sur le dépôt du harnais, sans ces modifications.

Les réglages imposés par l’environnement de lancement sont affichés mais non modifiables. Une modification externe du fichier demande de recharger les valeurs avant d’enregistrer, et fermer une fenêtre contenant des modifications non enregistrées demande confirmation. Aucun éditeur de fichier n’est nécessaire.

| Élément | Application macOS installée | Console web et Electron depuis les sources |
|---|---|---|
| Configuration | `~/Library/Application Support/Implementation Harness/.env` | `.env` à la racine du dépôt |
| Runs, file et retours | `~/Library/Application Support/Implementation Harness/data/` | `console/data/` |
| Préférences Electron | `~/Library/Application Support/Implementation Harness/preferences.json` | `~/Library/Application Support/Implementation Harness Development/preferences.json` |
| Journal du serveur Electron | `~/Library/Application Support/Implementation Harness/logs/server.log` | `~/Library/Application Support/Implementation Harness Development/logs/server.log` |

Le menu **Ouvrir les données locales** donne accès aux archives. L’application installée conserve ses données séparément de celles du dépôt ; ses mises à jour ne remplacent pas ce dossier utilisateur.

`IMPL_ENV_FILE` et `IMPL_DATA_DIR`, définis dans l’environnement de lancement, permettent de choisir d’autres chemins absolus. `IMPL_PLUGIN_ROOT` désigne un checkout du harnais à utiliser à la place du plugin embarqué, notamment pour l’auto-amélioration. `IMPL_DESKTOP_USER_DATA` permet d’isoler les préférences et les journaux dans un autre profil Electron.

Electron impose l’écoute sur `127.0.0.1` avec un port libre : `IMPL_PORT`, `IMPL_HOST` et `IMPL_NO_OPEN` concernent la console web. Les réglages de recherche de dépôts, parallélisme et Remote Control s’appliquent aux deux modes.

### Console web avec `impl`

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
| `IMPL_STALL_MINUTES` | minutes sans activité avant qu’un run en cours soit signalé comme peut-être bloqué | `20` |
| `IMPL_DEMO_STEP_MS` | durée d’une étape du mode démo | `5000` |

Une variable posée dans le shell l’emporte sur le `.env`, qui l’emporte sur le défaut. Un réglage ponctuel ne demande donc aucune écriture :

```bash
IMPL_PORT=4321 impl
IMPL_NO_OPEN=1 impl
```

### Permissions des sessions

Un run est fait pour aller au bout sans surveillance : il démarre donc avec un mode de permission explicite plutôt qu’avec celui configuré sur la machine qui l’ouvre. Par défaut `auto`, le même que les sessions d’arrière-plan du harnais. `manual` redonne la main avant chaque outil, au prix d’un run qui s’arrête à la première question. `bypassPermissions` ne vérifie plus rien. Le mode `plan` n’est pas proposé : il répond par un plan et n’ouvre jamais de merge request.

### Terminal joignable à distance

Un run démarre avec Remote Control activé. La session affiche son lien `claude.ai/code/session_…` dès la première seconde, et le terminal se reprend depuis un téléphone ou un autre poste sans attendre que le harnais propose quoi que ce soit. La session reste rattachée au compte déjà authentifié dans Claude Code : elle n’est pas exposée à un tiers. `IMPL_REMOTE_CONTROL=false` la démarre sans. La session d’auto-amélioration, elle, n’est jamais concernée : elle tourne en arrière-plan et n’est pas interactive.

### Détection du projet

Le harnais parcourt les racines de recherche jusqu’à deux niveaux de profondeur, lit le `.git/config` de chaque dossier et en déduit le projet GitLab. Après collage d’un ticket, le chemin détecté remplit le champ projet s’il est vide. Ce champ reste éditable et propose les checkouts découverts pendant la saisie. Un dépôt qui vit ailleurs se rend visible en ajoutant son dossier parent à `IMPL_SEARCH_ROOTS`.

## Boucle d’auto-amélioration

Dans l’application empaquetée, la boucle nécessite un checkout Git modifiable du harnais, désigné par `IMPL_PLUGIN_ROOT`. Avec le seul plugin embarqué, les retours sont enregistrés mais aucun auto-audit ne modifie le paquet installé. La procédure ci-dessous décrit l’usage depuis un checkout du dépôt.

À la fin d’un run, le panneau de droite permet d’enregistrer un retour concret. Il est conservé localement avec l’identifiant du run et ses documents générés, puis traité avec :

```bash
impl improve
```

Cette commande lance Claude Code sur `/implementation-harness:improve`. Il regroupe les retours en attente, vérifie les preuves du run, crée une branche `self-improvement-*`, applique la plus petite amélioration durable, exécute les vérifications et crée un commit local. Il ne pousse rien et ne fusionne rien : le résultat reste inspectable et réversible.

Son worktree est découpé depuis le dernier commit poussé, et la boucle ne pousse jamais : l’itération commence donc par mettre sa propre branche à niveau sur le harnais, en `--ff-only`, pour ne pas diagnostiquer un arbre auquel manquent les améliorations déjà acceptées. Une branche qui porte déjà un commit fait refuser la commande et ne bouge pas.

Avant de choisir quoi corriger, il lit aussi les branches `self-improvement-*` que l’utilisateur n’a pas encore acceptées ou écartées, ainsi que les worktrees en cours. Il ne réimplémente pas un correctif déjà porté par une branche en attente : il nomme cette branche dans son rapport. Comme plusieurs itérations peuvent tourner en parallèle, son diagnostic et son rapport portent le nom de sa propre branche, `improvement-plan-<slug>.md` et `improvement-report-<slug>.md`, pour qu’aucune itération n’écrase le travail d’une autre.

Les tickets, logs et retours bruts restent sous `console/data/` et ne sont jamais ajoutés au commit d’amélioration.

Le harnais peut également se critiquer sans retour humain. À la fin de chaque workflow, y compris après un échec ou un arrêt manuel, il enregistre un auto-audit portant sur les échecs, interventions, boucles de revue, documents manquants et vérifications incomplètes. En mode autonome, Claude Code traite cette preuve dans un worktree isolé. Un signal auto-généré doit apparaître sur au moins deux runs, sauf bug déterministe ou défaut de sécurité. La décision est prise une seule fois par run, et seulement si le run a laissé quelque chose à analyser : un agent délégué, un document produit ou une sortie inattendue. Une session arrêtée avant ça est écartée, avec une ligne dans le fil d’activité.

La politique se règle avec `impl config`, ou directement :

```bash
impl config set IMPL_SELF_IMPROVEMENT_AUTORUN=false
```

Elle lance l’analyse en arrière-plan à la fin du run. L’option est active par défaut ; la passer à `false` coupe la boucle. Dans l’application, l’auto-audit travaille sur le dépôt du harnais : s’il n’est pas renseigné dans les réglages, l’application le cherche dans les dossiers de recherche (un checkout Git dont le plugin s’appelle `implementation-harness`) et signale dans les réglages quand elle n’en trouve aucun.

L’agent travaille dans un worktree isolé et laisse toujours son commit sur sa branche `self-improvement-*`. Rien n’est fusionné automatiquement et rien n’est poussé sur GitHub. Le panneau de droite affiche le diff : c’est la seule porte de promotion. Après une fusion, redémarrer le harnais avec `impl restart` pour charger les changements du serveur local.

**Une seule amélioration est en vol à la fois.** Tant qu’un worktree `self-improvement-*` existe, la fin d’un run n’en ouvre pas un second : le fil d’activité nomme celui qui bloque et l’auto-audit reste dans `pending/`, où la prochaine itération le lira. Rien n’est détruit pour libérer la place, c’est la décision de l’utilisateur qui libère la boucle. La règle vient d’une mesure : la boucle a ouvert onze branches en une journée, dont quatre en conflit entre elles, et aucune n’a été promue par le bouton — elles ont toutes été reprises à la main. Une branche que personne n’a tranchée est aussi celle contre laquelle la suivante se diagnostique.

La revue n’est proposée qu’une fois un commit d’amélioration présent sur la branche du worktree. Le lanceur rend la main dès que le travail se détache, donc son code de sortie ne dit que le démarrage; et `/implementation-harness:improve` laisse sa branche non commitée quand sa propre validation échoue, un état qui ne doit jamais être proposé à la fusion. Sans commit au bout d’une heure et demie, le fil d’activité pointe le worktree à inspecter à la main plutôt que d’ouvrir les boutons, et dit que la boucle reste en pause tant qu’il existe.

Au moment d’ouvrir les boutons, le harnais simule la fusion avec `git merge-tree --write-tree`, qui n’écrit que dans la base d’objets. Le panneau avertit quand la branche ne fusionne plus, avant le clic : une promotion n’est jamais annoncée en un clic quand l’utilisateur découvrirait le conflit en cliquant.

### Rebase automatique

Les branches d’amélioration partent toutes de la même base et se fusionnent l’une après l’autre : la première promotion laisse toutes les suivantes derrière le harnais, et l’écart grandit à chaque fusion. Le harnais rejoue donc les branches en attente sur son propre `HEAD` à chaque fois qu’il bouge, c’est-à-dire au démarrage de la console et après chaque fusion. Une branche en retard d’un commit se rejoue presque toujours seule; la même branche en retard de dix ne se rejoue jamais.

Trois états sont laissés intacts : une branche sans commit est un agent encore en train d’écrire, une branche déjà contenue dans le harnais n’a plus rien à rejouer, et un worktree avec des changements non commités porte le diagnostic qu’une validation ratée a laissé sur place, qu’un rebase emporterait.

Quand git s’arrête sur un conflit, il est annulé et la branche reste exactement où elle était. En mode autonome (`IMPL_SELF_IMPROVEMENT_AUTORUN=true`), le harnais confie alors le rebase à un agent de fond lancé dans le worktree de la branche, sur `/implementation-harness:rebase`. Cet agent rejoue, résout en gardant les deux intentions plutôt qu’un côté, rejoue les vérifications et ne fusionne rien : la promotion reste le bouton de l’utilisateur. Hors mode autonome, le panneau signale simplement le conflit réel, à reprendre à la main.

La fusion ne s’annonce que si elle a réellement déplacé la branche du harnais. Git répond « Already up to date » avec un code de sortie nul, et un conflit laisse le dépôt à moitié fusionné : le conflit est annulé et le worktree conservé. Quand git n’apporte rien, deux situations que son code de sortie ne distingue pas se départagent :

- **les commits de la branche sont déjà contenus dans le harnais**, parce que le travail a été repris à la main. Le worktree n’est plus qu’un résidu : il est nettoyé, avec sa branche, et journalisé « Améliorations déjà présentes ». Le refuser ne laissait aucune sortie honnête, puisque « Fusionner » disait que rien n’avait été fusionné et « Ignorer » enregistrait comme écarté du travail qui avait en fait été gardé;
- **la branche ne porte aucun commit**, et l’agent peut encore être en train d’écrire. Le worktree est conservé. Le nettoyage n’a lieu que si le worktree n’a aussi rien de non commité : le diagnostic qu’une validation ratée laisse sur place n’existe nulle part ailleurs.

## Fonctionnement

Claude Code reste le moteur du workflow. Le harnais ajoute :

- une application Electron (`console/electron/`) qui gère la fenêtre, les menus, notifications et préférences, et démarre le serveur dans un processus séparé;
- un registre de runs (`console/server/registry.ts`) qui démarre, met en file et libère les sessions, chacune isolée dans sa `RunSession` avec son état, son terminal, ses surveillances de fichiers et sa question en attente;
- un pseudo-terminal interactif par run, relié à l’interface avec WebSocket. Chaque page s’abonne au run qu’elle affiche et ne reçoit que son terminal et son état, la liste des runs étant diffusée à toutes;
- des hooks Claude Code pour suivre les agents et les outils, puis présenter et résoudre les questions structurées dans l’interface;
- un dossier de preuves par critère d’acceptation : le pilote écrit un registre de critères identifiés, chaque preuve les cite avec la version du code qu’elle a vérifiée, et le serveur calcule pour chaque critère s’il est vérifié, en échec, bloqué ou non vérifié, dans l’onglet Preuves comme dans la synthèse de la merge request (voir `console/README.md`);
- une surveillance de `.claude/tasks/` pour suivre les étapes et conserver les rapports avant leur nettoyage. Ce dossier appartient au dépôt cible et un run interrompu n’a pas eu le temps de le nettoyer : seuls les fichiers écrits depuis le début du run lui sont rattachés, ceux laissés par un run précédent sont ignorés et ne font pas avancer le rail d’étapes. La surveillance est posée sur `.claude/` et restreinte à `tasks/`, parce que le workflow supprime et recrée ce dossier en cours de run et qu’une surveillance posée dessus ne se réveillerait plus ensuite.

### La couche moteur

Tout ce qui est propre à Claude Code, l’exécutable, le vocabulaire de hooks, le format du transcript, la façon de soumettre une instruction, vit dans `console/server/engine/`. Le reste du serveur raisonne en runs, phases, agents et documents, sans savoir quel agent tourne dessous.

Il y a une implémentation aujourd’hui, `claude-code`, et c’est délibéré : l’intérêt de la frontière n’est pas d’en avoir deux, c’est qu’en écrire une deuxième soit un fichier et non une réécriture. Le mécanisme le plus spécifique du harnais, la question qui bloque l’agent jusqu’à la réponse de l’utilisateur, a été prouvé portable avant que cette couche soit écrite.

`console/server/engine/README.md` documente le contrat membre par membre, le chemin complet d’une question bloquante, et ce qui reste couplé en dehors du serveur.

Les données sont archivées dans `runs/<run-id>/`, sous le [dossier de données](#configuration) (`console/data/` depuis le dépôt) :

- `run.json` contient l’état, les agents et l’activité;
- `terminal.log` contient la sortie brute du terminal;
- `artifacts/` contient les documents générés pendant le run : plans, rapports QA, reviews et captures;
- `evidence/` et `acceptance/` gardent chaque version des preuves, leurs captures et la synthèse de couverture.

Ce dossier est local et ignoré par Git. Il peut contenir des informations confidentielles provenant des tickets traités; il ne faut pas le partager.

Un run que le serveur n'a pas pu clore lui-même (arrêt brutal, redémarrage) est reclassé "failed" au démarrage suivant plutôt que de rester marqué "running" indéfiniment : voir `console/README.md`.

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

Pour Electron, depuis `console/` :

```bash
npm run test:desktop:policy
npm run desktop:build
npm run test:desktop
```

Les tests natifs ouvrent une vraie fenêtre Electron et utilisent un faux exécutable Claude ainsi que des données temporaires. Ils vérifient le sélecteur de dossier, les préférences, la validation et la sauvegarde des réglages, les conflits de modification, le redémarrage, le parcours de démonstration, le clic sur une notification, le terminal natif, les hooks sur le port attribué et l’arrêt du serveur avec conservation de la file. Ils ne traitent aucun vrai ticket. Les notifications sont interceptées pendant le test.

Pour viser le paquet macOS Apple Silicon déjà construit :

```bash
IMPL_DESKTOP_EXECUTABLE="$PWD/release/mac-arm64/Implementation Harness.app/Contents/MacOS/Implementation Harness" npm run test:desktop
```

Un job macOS de GitHub Actions construit et teste également l’application Electron, puis teste son paquet `.app`. Les rapports Electron sont séparés dans `console/desktop-test-results/`.

## Développement

```bash
cd console
npm install
npm run desktop:dev
```

Pour développer dans le navigateur, utiliser `npm run dev`. En mode Electron, les changements frontend sont rechargés ; une modification du serveur, du preload ou du processus principal demande de relancer `desktop:dev`. Pour vérifier la version de production, exécuter `npm run desktop:build` puis `npm run desktop:start`.

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
console/electron/  fenêtre native, preload, menus, notifications et icône
console/electron-builder.cjs  empaquetage des applications de bureau
console/scripts/notarize.cjs  notarisation Apple depuis un profil du trousseau
console/server/engine/  la couche qui isole l'agent piloté, une implémentation : claude-code
install.sh    installation et création des commandes globales
install-remote.sh  clone ou mise à jour depuis la commande curl
```

Selon le ticket, `/implementation-harness:implement` peut aussi utiliser Playwright et Figma. Un MCP absent réduit les vérifications correspondantes mais n’empêche pas le harnais de démarrer.

Un run type ouvre plusieurs sessions navigateur : l’agent développeur mesure son propre travail, puis la revue design et la QA repassent dessus. Déclarer le serveur MCP Playwright en `--headless` évite qu’une fenêtre Chrome prenne le premier plan à chaque fois, et écarte un mode de défaillance réel des mesures : en mode fenêtré, un viewport demandé plus large que l’écran est silencieusement rogné, et la mesure est alors rapportée à la largeur demandée et non à la largeur obtenue.

```json
"playwright": { "type": "stdio", "command": "npx",
                "args": ["@playwright/mcp@latest", "--headless"] }
```

Le seul cas qui demande l’inverse est un parcours où l’utilisateur doit intervenir lui-même dans le navigateur, typiquement une connexion à faire à la main. Retirer `--headless` rend la fenêtre.

## Licence

Implementation Harness est distribué sous [licence MIT](LICENSE). Copyright © 2026 Gregory Klein.
