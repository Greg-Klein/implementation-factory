# Design review output

## Output Files (MANDATORY)

You MUST write two files:

1. `.claude/tasks/designer-review.md` — the report below.
2. `.claude/tasks/design-evidence.json.tmp` — the same property comparisons as data, for the console's "Preuves" tab. Schema:

```json
{
  "schemaVersion": 2,
  "source": "design",
  "round": 1,
  "criteriaRevision": 1,
  "producer": { "role": "designer-reviewer" },
  "codeSnapshot": { "atStart": "<the id your caller gave you>" },
  "items": [
    { "id": "DS-R1-1", "label": "string", "verdict": "pass | fail | unverified", "method": "browser", "expected": "string", "actual": "string", "screenshot": "assets/relative-path.png", "criterionIds": ["AC3"], "supersedes": ["DS-R0-1"] }
  ]
}
```

One item per row of the property/expected/actual/verdict comparison table, `label` naming the property and its visual location — never a file path or component name, same rule as everywhere else in this agent. Attach `screenshot` whenever a screenshot documents that row. `label`, `expected` and `actual` are written in French; the JSON keys and `verdict` (`pass`/`fail`/`unverified`) stay in English exactly as shown.

- **`id`**: `DS-R<round>-<n>`, never reused across rounds. When you measure again a property an earlier round recorded (read the previous `design-evidence.json` first), write a new item and name the earlier id in `supersedes`.
- **`criterionIds`** only on a row that checks a visual acceptance criterion of the registry; a property of the design that no criterion states cites none.
- **`codeSnapshot.atStart`** is the id your caller gave you, copied exactly. You have no shell to take one yourself; without an id from the caller, leave `codeSnapshot` out.

---

## Output Rules

- Output MUST be valid Markdown
- Overwrite the report and the staged evidence completely
- Do NOT create other report files; captures go under `.claude/tasks/assets/` with round-qualified names.

## Output Format (MANDATORY)

Write to `.claude/tasks/designer-review.md`:

```md
# Revue de design

## Résumé

- Évaluation globale

## Méthode d'inspection

- Figma : accédé / inaccessible
- App en direct : inspectée via Playwright / non disponible
- Niveau de confiance : élevé / moyen / faible

## Couverture Figma

- Frames revues : ...
- Frames manquantes : ...

## Captures de l'app en direct

- Pages inspectées : ...
- Viewports testés : ...

## Problèmes bloquants (P0)

- ...

## Problèmes importants (P1)

- ...

## Problèmes mineurs (P2)

- ...

## Problèmes UX

- ...

## Écarts préexistants (éléments que le ticket ne touche pas)

- ...

## Violations du design system

- ...

## Suggestions

- ...

## Verdict

PASS | PASS_WITH_WARNINGS | FAIL
```

## Decision Rules

- FAIL: an in-scope P0/P1 visual defect remains. Functional suspicions go to QA without a design defect severity.
- PASS_WITH_WARNINGS: only in-scope P2 differences remain, or some properties could not be independently measured. Name each unverified property and obstacle.
- PASS: every in-scope required comparison was measured against an authoritative reference, no unresolved in-scope defect remains, and no required property is unverified.

Pre-existing differences remain separately reported and do not block this ticket. An explicit authoritative waiver is recorded, never silently invented.

## Publication without shell access

Write complete JSON to `design-evidence.json.tmp` and notify the caller. Read the existing final `design-evidence.json` for ids to supersede before writing the next round. The caller samples the end snapshot, inserts the actual `codeSnapshot.atEnd` when available and atomically renames the staged file to `design-evidence.json`. Missing snapshots stay absent; changed snapshots require remeasurement or an explicit non-conclusive result. The final filename and schema remain the console contract. Your report states any missing or non-conclusive measurement; never mark it PASS.
