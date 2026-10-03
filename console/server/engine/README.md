# La couche moteur

Le harnais pilote un agent de code. Ce dossier est la seule partie du serveur qui sait **lequel**.

Il y a une implémentation aujourd'hui, `claude-code`. L'interface existe pour qu'une deuxième demande un fichier à écrire plutôt qu'une réécriture du serveur.

## Pourquoi

Le harnais est un outil de travail quotidien. Si le fournisseur d'IA change, l'outil doit continuer à fonctionner.

Le serveur ne dépendait de Claude Code qu'à six endroits, tous rassemblés ici depuis. Le coût principal d'une migration est dans `commands/implement.md` et les six agents, écrits contre les noms d'outils et la sémantique de sous-agents de Claude Code. Cette couche traite le serveur et laisse ces prompts tels quels. Voir « Ce qui reste couplé » plus bas.

Le mécanisme le plus spécifique du harnais, la question bloquante, a été prouvé portable avant que cette couche soit écrite. Voir le spike dans `~/workspace/opencode-question-bridge`.

## La frontière

Au-dessus de cette ligne, le harnais raisonne en runs, phases, agents, documents et questions. En dessous, une implémentation connaît un exécutable, un vocabulaire d'événements et un format de transcript.

```text
index.ts, hooks.ts, artifacts.ts, transcript.ts, self-improvement.ts
        │
        │  engine.start() / engine.event() / engine.conversationLine() …
        ▼
engine/index.ts        choisit le moteur actif
engine/types.ts        le contrat
engine/claude-code.ts  la seule implémentation
```

Rien au-dessus n'importe `node-pty`, ne connaît le chemin `.claude/tasks`, ne lit `hook_event_name`, ne construit un `hookSpecificOutput`.

## Le contrat

`engine/types.ts`. Chaque membre existe parce qu'il varie d'un agent à l'autre.

| Membre | Rôle | Ce qui varie |
|---|---|---|
| `id`, `label` | identité du moteur | `label` apparaît dans les erreurs et le journal d'activité |
| `locate()` | l'exécutable, ou `null` | nom du binaire |
| `command(issueUrl, instruction)` | point d'entrée du workflow | forme de la commande, ici une commande slash |
| `start(options)` | démarre la session, rend un `EngineSession`. `options.onEvent` reçoit ce que l’agent dit hors de ses hooks, lu dans le terminal. `options.environment` porte les variables que le workflow lit (`IMPL_CODE_SNAPSHOT`, `IMPL_SNAPSHOT_LOG`, `IMPL_SNAPSHOT_EXCLUDE`), posées telles quelles | arguments, variables d'environnement, transport |
| `taskDirectory(cwd)` | où le workflow dépose ses documents | `.claude/tasks` pour Claude Code |
| `transcriptPath(payload)` | le fichier d'où se lit le dialogue | nommé par l'agent dans ses propres événements |
| `conversationLine(line)` | une ligne de ce fichier | format JSONL propre à l'agent |
| `event(payload)` | traduit un événement brut en `EngineEvent` | tout le vocabulaire de hooks |
| `questionAnswer(input, answers)` | ce que l'agent attend en retour d'une question | `updatedInput` pour Claude Code |
| `startSelfImprovement(options)` | lance la boucle d'auto-amélioration détachée | drapeaux de worktree et de permissions |
| `startConflictResolution(options)` | rejoue une branche d'amélioration que git seul n'a pas pu rebaser | drapeaux de worktree et de permissions |

### EngineSession

Ce que le harnais fait d'une session en cours :

- `write(data)` : les frappes brutes du terminal intégré;
- `submit(text)` : une instruction tapée dans l'interface, envoyée comme l'agent l'attend. Sous Claude Code c'est un collage entre marqueurs suivi d'un retour chariot séparé, parce qu'un retour chariot **dans** le collage est lu comme du contenu et l'instruction n'est jamais soumise;
- `resize(cols, rows)`, `kill()`;
- `answerPrompt(decision)` : la réponse (`accept` ou `refuse`) à la demande que la session a levée par `session.prompt`, tapée comme l’agent l’attend. Rend `false`, sans rien taper, quand cette demande n’est plus à l’écran.

### EngineEvent

Un événement, dit dans les mots du harnais. Le moteur traduit, `hooks.ts` applique.

| Événement | Effet dans le harnais |
|---|---|
| `agent.start` / `agent.stop` | met à jour la liste des agents, fait avancer la phase |
| `agent.kill` | clôt un agent arrêté de l'extérieur (Claude Code n'émet pas de fin pour lui) |
| `tool.start` | nomme l'action en cours dans l'interface, détecte la création de branche ; porte l'identifiant de l'appel (`toolUseId`), le sous-agent appelant (`agentId`, absent pour le pilote), si l'appel travaille en arrière-plan (`background`) et si une fin sera rapportée (`endReported`) |
| `tool.end` | y cherche l'adresse de la merge request, et clôt l'appel de même `toolUseId` |
| `question` | **bloque l'agent** jusqu'à la réponse de l'utilisateur |
| `attention` | l'agent réclame la main, avec sa cause : `permission`, `terminal_interaction` ou `unknown` |
| `turn.end` | le **pilote** rend la main, ce qui ne veut pas dire que le workflow est fini (la fin d'un sous-agent est `agent.stop`) |
| `session.prompt` | l’agent s’arrête sur une demande à lui avant que la session démarre (`folder_trust` : faire confiance au dossier) : une décision attend l’utilisateur |
| `session.prompt.end` | cette demande a quitté l’écran |

Ces champs ne sont remplis que quand Claude Code les fournit : `tool_use_id` et `agent_id` des hooks d'outils, `notification_type` des notifications. Un champ absent reste inconnu, et la santé du run (`server/run-health.ts`) s'en accommode. `END_REPORTED_TOOLS` doit rester égal au matcher `PostToolUse` de `hooks/hooks.json`, ce que vérifie un test.

Deux détails qui comptent dans la traduction :

1. **La commande passe entière.** `tool.start` porte `command` non tronqué, parce que `createsBranch` et `branchFromCommand` doivent matcher dessus. Pour l'affichage, il porte le nom de l'outil et un `target` neutre, la clé d'entrée qui le désigne (`file_path`, `pattern`, `subagent_type`, `url`) variant d'un outil à l'autre. `actionLabel` dans `domain.ts` en fait la ligne « ce que Claude fait en ce moment ». Ce libellé n'entre jamais dans le journal d'activité, où deux cents appels d'outils rendraient les jalons du workflow illisibles.
2. **Une question déjà répondue n'est pas reposée.** Claude Code rejoue le hook sur l'appel que le harnais a lui-même complété, et ce second passage porte les réponses. `claude-code.ts` le reconnaît et ne produit aucun événement.

### La question bloquante

C'est le mécanisme central, et le seul qui demande de la coopération des deux côtés.

```text
l'agent appelle son outil de question
        │
        ▼
hooks/emit.mjs poste sur /api/hooks, timeout 1 h
        │
        ▼
processHook → engine.event() → EngineEvent { kind: "question" }
        │
        ▼
waitForQuestionAnswer rend une Promise NON RÉSOLUE
        │                       et publie l'état (le panneau s'affiche)
        │
        ▼                       … l'utilisateur répond dans l'interface
answerQuestion → engine.questionAnswer(input, answers)
        │
        ▼
la Promise se résout, la réponse HTTP part, l'agent repart
```

Le blocage est cette Promise non résolue. Un moteur qui ne sait pas attendre dessus ne peut pas alimenter le panneau de décisions.

### La demande de confiance du dossier

Claude Code la dessine avant tout hook et tout transcript : elle ne peut être lue que dans la sortie du terminal. `trust-prompt.ts` contient tout ce qu’on en sait, et rien d’autre n’en parle.

- **Le texte.** Observé sur Claude Code 2.1.288, dans un dossier jamais ouvert : « Accessing workspace: », le chemin, « Quick safety check: Is this a project you created or one you trust? … », puis deux options, « No, exit » (sous le curseur à l’ouverture) et « Yes, I trust this folder », et « Enter to confirm · Esc to cancel ». La sortie brute est gardée dans `tests/unit/fixtures/trust-dialog.json`, chemin remplacé.
- **La détection.** Les mots sont séparés par des déplacements de curseur (`ESC[<colonne>G`), pas par des espaces, et la trame arrive coupée n’importe où. Le texte est donc comparé sans séquences d’échappement ni blancs, sur une fenêtre glissante. Trois expressions doivent s’y trouver dans l’ordre. La recherche s’arrête après les 16 premiers kilo-octets de sortie : la demande est la première chose que la session dessine, et le même texte affiché plus tard par un outil n’en est pas une.
- **La fin.** Une sortie de 400 caractères visibles sans aucune expression de la demande veut dire que la session est passée à son propre écran. Au-dessus du moteur, le premier hook reçu et la sortie du processus ferment aussi la demande.
- **La réponse.** Refuser envoie Échap, que la demande propose elle-même, puis termine la session si elle est encore là deux secondes plus tard. Accepter envoie Flèche bas puis Entrée, ou Entrée seule si le curseur a été vu sur « Yes ». Si le curseur n’est pas où il a été vu, une acceptation peut au pire devenir un refus.
- **Ce qui n’est pas vérifié.** Aucune réponse n’a été envoyée au vrai Claude Code : accepter écrit dans la configuration de l’utilisateur. Les touches sont vérifiées contre `tests/fake-claude/claude`, qui rejoue la trame capturée.
- **Un texte reformulé** ne correspond à rien. Le run se comporte alors comme avant : rien dans la conversation, la réponse dans l’onglet Terminal. Jamais une carte qui bloque un run sain.
- Un sous-dossier d’un dossier déjà approuvé ne reçoit pas la demande (observé dans `<dépôt>/.claude/worktrees/trust-probe`, même version).

## Ajouter un moteur

1. Écrire `engine/<nom>.ts` qui satisfait `Engine`.
2. Le choisir dans `engine/index.ts`.
3. Fournir l'équivalent du corpus de prompts pour cet agent.

L'étape 3 demande le plus de travail. Les deux premières sont mécaniques.

## Ce qui reste couplé, en toute franchise

Cette couche rend le serveur agnostique, pas le reste du harnais. Restent dehors :

- **`commands/` et `agents/`**, environ 600 lignes plus six agents, écrits contre les noms d'outils de Claude Code. C'est le gros du coût de migration. Piste : une source canonique et une table de correspondance des noms d'outils, générées à l'installation.
- **Les libellés d'interface** dans `console/lib/notifications.ts` et `console/lib/run-state.ts`, qui disent « Claude » en dur. Le client ne connaît pas le moteur; il faudrait faire descendre `engine.label` dans `RunState`.
- **Le mode démo** (`server/demo.ts`), qui met en scène une session Claude Code.
- **La qualité selon le modèle.** Un moteur peut répondre sans tenir le workflow. Six agents et deux tours de review demandent un modèle solide, et rien ici ne le vérifie. Le vérifier demande un eval.
