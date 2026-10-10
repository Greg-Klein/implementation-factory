# Senior review output

## Report Format (MANDATORY)

Write to `.claude/tasks/senior-review.md`:

```md
# Revue senior

## Résumé

- Évaluation globale

## Attentes et recherche de contre-exemples

- Comportement attendu, établi avant de lire le rapport du développeur
- Contre-exemples cherchés, et ce que chacun a donné

## Problèmes constatés

- [P0] Problème critique
- [P1] Problème important
- [P2] Problème mineur

## Corrections appliquées

- ...

## Améliorations apportées

- ...

## Risques restants

- ...

## Évaluation de la couverture de tests

- ...

## Verdict

PASS | PASS_WITH_CHANGES | FAIL
```

Also write `.claude/tasks/senior-findings.json` under [the review findings contract](review-findings.md): one entry per line of `## Problèmes constatés`, each filed under one category of its fixed list.

Write your independently derived expectations and counterexample search under `## Attentes et recherche de contre-exemples`, before you open the developer's report and before describing any corrections. `## Problèmes constatés` holds findings only, one per line, since each of its lines becomes an entry of `senior-findings.json`. Distinguish diagnosis on the input code from validation after your edits. No finding is a valid result.
