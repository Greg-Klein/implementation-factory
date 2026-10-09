# Runtime recipe

`.claude/tasks/runtime-recipe.md` says how the target repository's app is started, reached and driven for a measurement. The pilot owns it. When the console drives the run, it puts there the recipe an earlier run of the same repository left, and keeps every version the pilot writes for the next run. Without the console the file starts absent and is lost with the task directory.

It is a starting point, never a fact about the current code. Check a line before relying on it: a command that fails, a route that moved or a flag that no longer exists is corrected in place. A recipe that was never executed is not written.

## Format

```md
# Recette d'exécution

Vérifiée le <date ISO> sur <commit court>, par le run du ticket <référence>.

## Lancer

- Commande documentée du dépôt, et comment changer de port
- Ce qui indique que l'app répond (ligne de log, route qui renvoie 200)
- Arrêt

## Prérequis

- Backend ou environnement visé, flags à activer, données à poser, et où chacun se règle

## Accès

- Route de connexion, et la référence du compte de test (nom de la variable ou du fichier qui le porte)

## Atteindre un état

- Par fonctionnalité déjà pilotée : route, étapes, sélecteurs stables, état final observable

## Pièges

- Ce qui a fait perdre du temps, et ce qui l'évite
```

## Rules

- **No secret, ever.** A credential is named by where it lives (an environment variable, a file the repository ignores), never copied. No token, password, cookie or personal data.
- **Nothing about one run.** No port this run picked, no worktree path, no ticket-specific fixture: those belong in `browser-recipe.md`. Write the override that picks a port, not the port.
- **Only what was executed in this run or checked again.** Keep an earlier line you did not exercise as it is; remove one you found false.
- Drop a section with nothing to say. Keep the file under 200 lines: it is read at the start of every run.
- Written in the workflow language with `implementation-factory:unslop`, commands and identifiers unchanged.
