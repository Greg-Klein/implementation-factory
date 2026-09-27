# La couche moteur

Le harnais pilote un agent de code. Ce dossier est la seule partie du serveur qui sait **lequel**.

Il y a une implémentation aujourd'hui, `claude-code`. L'interface existe pour qu'une deuxième soit un fichier à écrire plutôt qu'une chirurgie à mener.

## Pourquoi

Le harnais est un outil de travail quotidien. Si le fournisseur d'IA change, l'outil ne doit pas mourir avec lui.

Ce qui coûte cher dans une migration n'est pas ce qu'on croit. Le serveur ne tenait qu'à six endroits, tous rassemblés ici depuis. Le vrai coût est ailleurs, dans `commands/implement.md` et les six agents, écrits contre les noms d'outils et la sémantique de sous-agents de Claude Code. Cette couche règle le premier problème, pas le second. Voir « Ce qui reste couplé » plus bas.

Le mécanisme le plus spécifique du harnais, la question bloquante, a été prouvé portable avant que cette couche soit écrite : voir le spike dans `~/workspace/opencode-question-bridge`.

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

`engine/types.ts`. Chaque membre existe parce qu'il varie réellement d'un agent à l'autre.

| Membre | Rôle | Ce qui varie |
|---|---|---|
| `id`, `label` | identité du moteur | `label` apparaît dans les erreurs et le journal d'activité |
| `locate()` | l'exécutable, ou `null` | nom du binaire |
| `command(issueUrl, instruction)` | point d'entrée du workflow | forme de la commande, ici une commande slash |
| `start(options)` | démarre la session, rend un `EngineSession`. `options.environment` porte les variables que le workflow lit (`IMPL_CODE_SNAPSHOT`, `IMPL_SNAPSHOT_LOG`, `IMPL_SNAPSHOT_EXCLUDE`), posées telles quelles | arguments, variables d'environnement, transport |
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
- `resize(cols, rows)`, `kill()`.

### EngineEvent

Un événement, dit dans les mots du harnais. Le moteur traduit, `hooks.ts` applique.

| Événement | Effet dans le harnais |
|---|---|
| `agent.start` / `agent.stop` | met à jour la liste des agents, fait avancer la phase |
| `agent.kill` | clôt un agent arrêté de l'extérieur (Claude Code n'émet pas de fin pour lui) |
| `tool.start` | nomme l'action en cours dans l'interface, détecte la création de branche |
| `tool.end` | y cherche l'adresse de la merge request |
| `question` | **bloque l'agent** jusqu'à la réponse de l'utilisateur |
| `attention` | l'agent réclame la main |
| `turn.end` | l'agent rend la main, ce qui ne veut pas dire que le workflow est fini |

Deux détails qui comptent dans la traduction :

1. **La commande passe entière.** `tool.start` porte `command` non tronqué, parce que `createsBranch` et `branchFromCommand` doivent matcher dessus. Pour l'affichage, il porte le nom de l'outil et un `target` neutre, la clé d'entrée qui le désigne (`file_path`, `pattern`, `subagent_type`, `url`) variant d'un outil à l'autre. `actionLabel` dans `domain.ts` en fait la ligne « ce que Claude fait en ce moment ». Ce libellé n'entre jamais dans le journal d'activité : deux cents appels d'outils y enterreraient les jalons du workflow.
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

La Promise non résolue **est** le blocage. Un moteur qui ne saurait pas attendre là-dessus ne peut pas porter le panneau de décisions.

## Ajouter un moteur

1. Écrire `engine/<nom>.ts` qui satisfait `Engine`.
2. Le choisir dans `engine/index.ts`.
3. Fournir l'équivalent du corpus de prompts pour cet agent.

L'étape 3 est la vraie. Les deux premières sont mécaniques.

## Ce qui reste couplé, en toute franchise

Cette couche ne rend pas le harnais agnostique, elle rend le **serveur** agnostique. Restent dehors :

- **`commands/` et `agents/`**, environ 600 lignes plus six agents, écrits contre les noms d'outils de Claude Code. C'est le gros du coût de migration. Piste : une source canonique et une table de correspondance des noms d'outils, générées à l'installation.
- **Les libellés d'interface** dans `console/lib/notifications.ts` et `console/lib/run-state.ts`, qui disent « Claude » en dur. Le client ne connaît pas le moteur; il faudrait faire descendre `engine.label` dans `RunState`.
- **Le mode démo** (`server/demo.ts`), qui met en scène une session Claude Code.
- **La qualité selon le modèle.** Un moteur qui répond n'est pas un moteur qui tient le workflow. Six agents et deux tours de review demandent un modèle solide, et rien ici ne le vérifie. Cela demande un eval, pas une interface.
