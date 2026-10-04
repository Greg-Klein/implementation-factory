# Workflow language

One setting decides the language of everything this workflow writes for a person: `IMPL_LANGUAGE` in the environment.

- `fr`: French.
- anything else, or unset: English.

Read it once, at the start (`echo "${IMPL_LANGUAGE:-en}"`), and keep it for the whole run. The pilot states the language in every delegation ("workflow language: French" or "workflow language: English"); an agent that was not told reads the variable itself. Never switch language halfway, and never follow the language of the ticket, of the repository or of these instructions instead: they are in English whatever the setting.

## What follows the workflow language

- every message of the pilot to the user, progress notes, questions and their options, the final report
- every report and document of the run: ticket context, open questions, plan, developer, QA, senior and design reports, review summary, runtime recipe
- the free-text fields of the JSON files: labels, summaries, reasons, descriptions, blockers
- what is published on the forge: the merge request or pull request description, the review comment, a comment or a correction on another ticket

## What never changes

- code, identifiers, commands, file names, branch names
- commit messages and the title of the merge request or pull request: English, conventional prefix
- JSON field names, enum values and verdict tokens (`PASS`, `PASS_WITH_WARNINGS`, `INCONCLUSIVE`, `measured`, `confirmed`, `unverified`, `P0`, `P1`, `P2`): the console reads them
- the strings of the product being built: they follow the ticket and the repository, not this setting
- `acceptance-summary.md`: the console writes it, already in the workflow language. Quote it as it is

Write prose with `implementation-harness:unslop` in both languages.

## Templates and fixed phrases

The templates in the contracts and recipes of this plugin are written in French: section headings, table headers, fixed phrases. In French, use them as they are. In English, keep the same structure and translate every heading, header and phrase. When a contract or a prompt names a section by its French heading, it means that section under its English heading too.

The ones several agents rely on have a fixed English form, so that everyone names them the same way:

| French | English |
|---|---|
| `## Résumé` | `## Summary` |
| `## Changements` | `## Changes` |
| `## Critères d'acceptation` | `## Acceptance criteria` |
| `## Notes d'implémentation` | `## Implementation notes` |
| `Hors scope selon le ticket :` | `Out of scope per the ticket:` |
| `## Revue automatisée` | `## Automated review` |
| `### Constats` | `### Findings` |
| `### Corrigé pendant la boucle` | `### Fixed during the loop` |
| `### Constats écartés` | `### Dismissed findings` |
| `### Validation` | `### Validation` |
| `### Captures` | `### Screenshots` |
| `### Verdict` | `### Verdict` |
| `à merger` / `changements mineurs` / `à retravailler` | `ready to merge` / `minor changes` / `needs rework` |
| `## Design non vérifié`, "design non vérifié" | `## Design not verified`, "design not verified" |
| `Écarts préexistants` | `Pre-existing deviations` |
| `Contrôles`, `Résultat`, `Commande exécutée`, `Preuve` | `Checks`, `Result`, `Command run`, `Evidence` |
| `Critères observables` | `Observable criteria` |
| `## Preuves navigateur` | `## Browser evidence` |
| `## Tentatives de mise en échec` | `## Break attempts` |
| `## À vérifier par la QA` | `## To be checked by QA` |
| `## Risques restants` | `## Remaining risks` |
| `Observations sans référence` | `Observations without a reference` |
| "à confirmer" | "to confirm" |
| "capture restée locale" | "screenshot kept local" |
| "Verdict QA à confirmer" | "QA verdict to confirm" |
| "Empilée sur `<branche>` (…) : à merger après elle." | "Stacked on `<branch>` (…): to be merged after it." |

Two words keep their meaning across languages. French "livré" means deployed to production, which this workflow never does; a merge is "mergé". In English, never write "shipped", "delivered" or "released" for a ticket whose merge request is only open or merged into a branch: name the stage it reached ("merge request open", "merged into `<branch>`").
