# Senior review output

## Report Format (MANDATORY)

Write to `.claude/tasks/senior-review.md`:

```md
# Revue senior

## Résumé

- Évaluation globale

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

Include your independently derived expectations and counterexample search in `## Problèmes constatés`, before describing any corrections. Distinguish diagnosis on the input code from validation after your edits. No finding is a valid result.
