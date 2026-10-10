# Developer output

## Output Files (MANDATORY)

**Your caller gives you an artifact suffix**: the task id you are implementing, or the rework label when you are invoked to fix review findings. Both of your output files carry it. Ask for it rather than inventing one, and never fall back to the unsuffixed names: those two belong to the caller, which merges every agent's output into them, and an agent writing them directly erases work that is not its own.

You MUST produce:

1. Code changes directly in the repository
2. A report written to:

.claude/tasks/developer-report-<suffix>.md

3. `.claude/tasks/dev-evidence-<suffix>.json`, the rows of the `## Preuves navigateur` and `## Observations par test` tables below, as data for the console's "Evidence" tab. Schema:

```json
{
  "schemaVersion": 2,
  "source": "developer",
  "criteriaRevision": 1,
  "producer": { "role": "developer" },
  "items": [
    {
      "id": "<suffix>-E1",
      "label": "string (what was measured, in the workflow language)",
      "verdict": "measured",
      "criterionIds": ["AC2"], "checkIds": ["AC2-C1"], "taskIds": ["<task id>"],
      "method": "browser",
      "observedAt": "ISO 8601",
      "codeSnapshotId": "<id printed before the measurement>", "codeSnapshotAtEnd": "<id printed after it>",
      "expected": "string (the reference value)", "actual": "string (the measured value)",
      "screenshot": "assets/relative-path.png", "note": "route, viewport, how to reproduce"
    },
    {
      "id": "<suffix>-E2",
      "label": "string (what the test or command establishes, in the workflow language)",
      "verdict": "measured",
      "criterionIds": ["AC1"], "taskIds": ["<task id>"],
      "method": "test",
      "observedAt": "ISO 8601",
      "codeSnapshotId": "<id printed before the run>", "codeSnapshotAtEnd": "<id printed after it>",
      "command": "the literal command run",
      "expected": "string (the result the criterion asks for)", "actual": "string (what the command returned)",
      "note": "for a reproduction: before or after the fix, and the id of the other observation"
    }
  ]
}
```

One item per row of the `## Preuves navigateur` table (first shape, `method: "browser"`) and one per row of the `## Observations par test` table (second shape, `method: "test"`, with the literal `command`). Write this file as soon as one of the two tables has a row; skip it entirely rather than writing an empty one when neither has. `label`, `expected`, `actual` and `note` are written in the workflow language, matching the tables; the JSON keys and `"verdict": "measured"` stay in English exactly as shown.

- **The reproduction of a defect is two items.** The observation made before the fix (the regression test seen failing, or the faulty behaviour measured on the base code) cites no criterion: it shows the defect, not the criterion. The same reproduction run after the fix cites the criterion it closes and names the earlier id in `note`. A reproduction you could not run is an `unverified` item with its `blocker`, as below.

- **`id`**: `<suffix>-E<n>`. Before a continuation or repeated invocation, read your previous suffixed evidence and the merged `dev-evidence.json`; allocate above the highest number ever used for this suffix. New measurements, including a formerly unverified check, always get new ids and name the older ids in `supersedes`. Never recycle table positions as ids. If you cannot establish earlier ids, ask the caller for a fresh suffix rather than guessing. An unchanged observation retains its id and exact content.
- **`criterionIds`** are the registry ids (`.claude/tasks/acceptance-criteria.json`) the row measures, among those your task serves; add `checkIds` when that criterion lists several required checks, since a row that names only such a criterion counts for none of its checks. A row that measures no criterion cites none.
- **`codeSnapshotId` / `codeSnapshotAtEnd`**: run `node "$IMPL_CODE_SNAPSHOT"` right before your first check (test run, static analysis or browser measurement) and right after your last, and copy the `id` of each output onto every item, a test result as much as a measurement: without it the console cannot tell whether the result still describes the code. Never write an id yourself. Leave both out when the variable is unset or the command fails. If the two differ, the code moved while you measured (a peer's batch, a hot reload): measure again once it is still.
- A criterion you could not measure because of something concrete gets an item too, `"verdict": "unverified"` with `"blocker": { "reason": "…", "action": "…" }`.
- Your measurement is a result you report about your own work; a reviewer confirms it later by citing your id. Do not call it anything else.
- **Write it to `dev-evidence-<suffix>.json.tmp`, then `mv` it into place**, so the console never reads it half written.

---

## Output Rules

- The report MUST be valid Markdown
- Publish a complete updated report and evidence file. On a measurement-only continuation, retain the report’s implementation history and update the verification sections; read earlier evidence before replacing the file so ids and supersession remain valid. No other report files except the scoped recipe below (the `.tmp` file you rename into place is the same file).
- Never write, append to or delete `.claude/tasks/developer-report.md` or `.claude/tasks/dev-evidence.json`

## Report Format (MANDATORY)

Write to `.claude/tasks/developer-report-<suffix>.md`:

```md
# Rapport développeur

## Résumé

- Ce qui a été implémenté

## Tâches réalisées

- T1 : ...
- T2 : ...

## Écarts par rapport au plan

- ...

## Hypothèses retenues

- ...

## Cas limites traités

- ...

## Tests ajoutés / modifiés

- ...

## Preuves navigateur

One row per observable acceptance criterion, whether it renders pixels or only
changes what the application sends, stores or caches. Omit the section only when
nothing in the change is observable in a running app, and say so in one line
instead.

| Critère | Valeur mesurée | Référence | Capture | Comment reproduire |
| --- | --- | --- | --- | --- |
| ... | valeur lue dans le DOM en direct | nœud Figma, ticket, ou la valeur du design | `.claude/tasks/assets/<nom>.png` | route, viewport, et la section de `browser-recipe.md` qui pose l'état s'il a fallu un harnais |

- Critères non mesurables, et pourquoi (app inaccessible, pas de credentials, état non atteignable)

## Observations par test

One row per test or command that establishes a criterion, the reproduction of a
defect before and after the fix included. Omit the section when no criterion
rests on a test, and say so in one line instead. The general gates (lint,
typecheck, the whole suite) do not go here.

| Critère | Commande exécutée | Attendu | Constaté | Moment |
| --- | --- | --- | --- | --- |
| ... | commande littérale | ... | ... | avant la correction / après la correction / sans objet |

## Limites connues

- ...

## Notes pour le reviewer

- ...
```

## Scoped reproduction recipe

If a temporary fixture, route or stub was needed, write `.claude/tasks/browser-recipe-<suffix>.md`, never the shared `browser-recipe.md`. Include exact fixture code, response shapes, setup order, route and viewport, assumptions and which checks were simulated. Keep temporary scaffolding out of the delivered diff. The pilot merges these sections into `browser-recipe.md` after each batch; the review orchestrator does so after rework. Reference your section in the report. Screenshots belong under `.claude/tasks/assets/` with suffix-qualified names.
