# Design review output

## Output Files (MANDATORY)

You MUST write three files, in this order:

1. `.claude/tasks/design-inventory.md`, before opening any author evidence: the reference level, then one row per element the reference gives, with its source (frame, mockup, neighbour screen or token), the viewports, states and content cases you will measure, and whether it sits in the correction scope. Its only sources are the reference at that level and the brief. Never rewrite a row after reading author evidence; a later addition goes under `## Added after reconciliation` with what prompted it.
2. `.claude/tasks/designer-review.md`, the report below.
3. `.claude/tasks/design-evidence.json.tmp`, the same property comparisons as data, for the console's "Evidence" tab. Schema:

```json
{
  "schemaVersion": 2,
  "source": "design",
  "round": 1,
  "criteriaRevision": 1,
  "producer": { "role": "designer-reviewer" },
  "codeSnapshot": { "atStart": "<the id your caller gave you>" },
  "items": [
    { "id": "DS-R1-1", "label": "string", "verdict": "pass | fail | unverified", "method": "browser", "expected": "string", "actual": "string", "screenshot": "assets/live-capture.png", "attachments": ["assets/reference-capture.png"], "criterionIds": ["AC3"], "checkIds": ["AC3-C1"], "supersedes": ["DS-R0-1"], "blocker": { "reason": "what prevented the measurement", "action": "what it would take" } }
  ]
}
```

One item per measured comparison or objective check (property, state cell, invariant, accessibility check, string), `label` naming it and its visual location, never a file path or component name. `expected` names the reference it was judged against. For each line of the coverage matrix, at least one item carries the live capture in `screenshot` and the reference capture in `attachments`; an invariant with no reference capture carries the live one alone. `label`, `expected` and `actual` are written in the workflow language; the JSON keys and `verdict` (`pass`/`fail`/`unverified`) stay in English exactly as shown.

- **`id`**: `DS-R<round>-<n>`, never reused across rounds. When you measure again a property an earlier round recorded (read the previous `design-evidence.json` first), write a new item and name the earlier id in `supersedes`.
- **`criterionIds`** only on a row that checks a visual acceptance criterion of the registry, plus the `checkIds` the row covers when that criterion lists several required checks (a row that names only such a criterion counts for none of them); a property of the design that no criterion states cites none.
- **`blocker`** on every `unverified` row that something concrete prevented (viewport or state not reached, frame unreadable, access missing). The console shows that row as blocked with its obstacle; without `blocker` it is plain unverified. Never put it on a `pass` or `fail` row.
- **`codeSnapshot.atStart`** is the id your caller gave you, copied exactly. You have no shell to take one yourself; without an id from the caller, leave `codeSnapshot` out.

---

## Output Rules

- Output MUST be valid Markdown
- Overwrite the inventory, the report and the staged evidence completely on each round; the staged evidence is valid JSON at every save
- Do NOT create other report files; captures go under `.claude/tasks/assets/` with round-qualified names.

## Output Format (MANDATORY)

Write to `.claude/tasks/designer-review.md`:

```md
# Revue de design

## Résumé

- Niveau de référence : figma / ticket-mockup / live-neighbours, et ce qui a servi de référence (frames, maquettes, écrans voisins mesurés, design-reference.md)
- Évaluation globale

## Méthode d'inspection

- Référence : lue en entier / lue en partie / inaccessible
- App en direct : inspectée via Playwright / non disponible
- Recette : fournie / construite par la revue
- Thème sombre et mouvement réduit : pris en charge et rejoués / non pris en charge
- Routes consommatrices : vérifiées (liste) / non demandées
- Niveau de confiance : élevé / moyen / faible

## Matrice de couverture

| Écran | Viewport | État ou contenu | Couverture | Captures (référence, live) | Obstacle |
| --- | --- | --- | --- | --- | --- |
| ... | largeur en px | repos / survol / focus clavier / actif / désactivé / chargement / vide / erreur / contenu long / 0, 1, n éléments | mesuré / non atteint / sans objet | chemins | ce qui a empêché la mesure, ou pourquoi sans objet |

- Lignes d'inventaire dans le périmètre : N, dont mesurées : N (X %)

## Matrice des états

| Élément | Repos | Survol | Focus clavier | Actif | Désactivé | Chargement | Vide | Erreur |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| emplacement visuel | conforme / différent / absent de l'implémentation / non atteint / sans objet | ... | ... | ... | ... | ... | ... | ... |

## Accessibilité

| Contrôle | Élément | Seuil | Mesuré | Résultat |
| --- | --- | --- | --- | --- |
| contraste / parcours clavier / focus visible / rôle et nom / taille de cible | ... | ... | ... | conforme / échec / non atteint |

## Écarts avec les mesures du développeur

- Éléments, états ou viewports de l'inventaire que le développeur n'a pas mesurés : ...
- Mesurés par le développeur et absents de l'inventaire : ...
- Valeurs en désaccord : ...

## Problèmes bloquants (P0)

- emplacement visuel, attendu, mesuré, référence citée

## Problèmes importants (P1)

- ...

## Problèmes mineurs (P2)

- ...

## Écarts préexistants (éléments que le ticket ne touche pas)

- ...

## Conflits à arbitrer

- les deux sources en désaccord et leurs valeurs (référence contre seuil d'accessibilité, frame contre jeu de composants)

## À vérifier par la QA

- étapes exactes, ce qui a été observé, ce qui a servi d'indice de l'état de l'app ; sans sévérité

## Observations sans référence

- trois lignes au plus, non bloquantes

## Verdict

PASS | PASS_WITH_WARNINGS | FAIL | INCONCLUSIVE
```

Every line of a P0, P1, P2 or pre-existing section cites its reference: Figma node, mockup file, measured neighbour screen and value, token of `design-reference.md`, WCAG threshold or named invariant. A remark with no such reference goes to "Observations sans référence" and never to a severity section. Keep every heading; write "Aucun" under an empty one.

Write the report with `INCONCLUSIVE` as its verdict from the first save, and overwrite the report and the staged evidence after each step of the pass. Replace the verdict only when the pass is complete, so a review stopped midway reads as what it is.

## Coverage

The coverage matrix has one line per screen, viewport and state or content case the review required.

- Required viewports: the ones the brief names, else 360, 768 and 1280, plus the exact width of every supplied frame.
- Required states: for each interactive element in the correction scope, the eight states of the state matrix, minus those marked `sans objet` with a reason. A state the brief names or the reference draws is explicitly required.
- Required content cases: the stressed content of the method, for each text zone or list in the correction scope.

A cell is `mesuré` only when you reached it in the live app, read its values yourself and kept the pair of captures. A developer capture or measurement never fills one. Anything else is `non atteint` with its obstacle.

Measured coverage is the share of in-scope rows of `design-inventory.md`, state and content cells included, with a measured `pass` or `fail`. `sans objet` cells are left out of the count. Rows added after reconciliation count too.

## Decision Rules

Apply the first rule that matches, at every reference level.

- FAIL: an in-scope P0/P1 remains, whatever the coverage. Functional suspicions go to QA without a severity.
- INCONCLUSIVE: a required viewport or an explicitly required state is `non atteint`, or measured coverage is below 80 %, or no reference level could be established. The review did not see enough to approve; it is reported as "design non vérifié", never as a pass.
- PASS_WITH_WARNINGS: coverage is at least 80 % and only in-scope P2 differences, "à confirmer" mockup differences or unverified cells remain. Name each unverified cell and its obstacle.
- PASS: every required cell is measured, every in-scope row was judged against a cited reference, and no in-scope defect or unverified cell remains.

Pre-existing differences and conflicts to arbitrate remain separately reported and do not block this ticket. An explicit authoritative waiver is recorded, never silently invented.

## Publication without shell access

Write complete JSON to `design-evidence.json.tmp` and notify the caller. Read the existing final `design-evidence.json` for ids to supersede before writing the next round. The caller samples the end snapshot, inserts the actual `codeSnapshot.atEnd` when available and atomically renames the staged file to `design-evidence.json`. Missing snapshots stay absent; changed snapshots require remeasurement or an explicit non-conclusive result. The final filename and schema remain the console contract. Your report states any missing or non-conclusive measurement; never mark it PASS. Rows measured on a changed snapshot count as not measured in the coverage.
