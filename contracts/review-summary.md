# Review summary

## Report format

Write `.claude/tasks/review-summary.md`:

```md
# Résumé de revue

## Verdict

READY | BLOCKED

## Rounds

- Rounds au total : N (senior : N, designer : N, qa : N)

## Dimensions

| Dimension | Exécuté | Verdict final | P0 | P1 | P2 |
|---|---|---|---|---|---|
| Senior | oui | PASS_WITH_CHANGES | 0 | 0 | 2 |
| Designer | oui / ignoré et pourquoi | ... | ... | ... | ... |
| QA | oui | PASS_WITH_WARNINGS | 0 | 0 | 1 |

## Corrigé pendant la boucle

- [P0] ... (relevé par ..., corrigé au round N, confirmé par ...)

## Findings mineurs restants (P2)

- `path/file.ts:42` - ce que c'est, ce qui serait mieux

## Écarts de design préexistants (hors ticket, à reprendre dans un ticket de suivi)

- élément et emplacement visuel, attendu Figma, mesuré, sévérité

## Encore ouvert (BLOCKED uniquement)

- Ce qui reste, ce qui a été tenté, ce qu'un humain doit décider

## Confiance

- Tests : exécutés / partiellement exécutés / non exécutés
- App en direct : inspectée via Playwright / inaccessible et pourquoi
- Figma : comparé / pas de design fourni
- Critères observables, une ligne chacun : measured live / confirmed from the developer's evidence (avec le chemin de la capture) / unverified (avec ce qui manquait)
- Tout ce qui n'a pas pu être vérifié
```

Write one line per observable criterion. An unreachable app is a reason to fall back on the developer's evidence, never a reason to leave a criterion unexamined.
