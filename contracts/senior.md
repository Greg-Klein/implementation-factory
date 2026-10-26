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

## Recheck

A round after the first is a recheck of the rework, not a second review. The caller passes the rework diff and the previous round's findings. `## Problèmes constatés` holds only a defect the rework introduced, one per line, with a new id of this round in `senior-findings.json`. A previous finding the rework left unresolved is not a new line and not a new id: name it by its existing id under `## Encore ouvert`. A finding the rework closed is not repeated. Round 1 does not have that section.

Write your independently derived expectations and counterexample search under `## Attentes et recherche de contre-exemples`, before you open the developer's report and before describing any corrections. `## Problèmes constatés` holds findings only, one per line, since each of its lines becomes an entry of `senior-findings.json`. Distinguish diagnosis on the input code from validation after your edits. No finding is a valid result.

When `.claude/tasks/review-guide.md` was read, one line of `## Résumé` names the source path and what the guide set aside, under [review guide](review-guide.md). When it was not read, that line is "Aucun" and the review is unchanged.
