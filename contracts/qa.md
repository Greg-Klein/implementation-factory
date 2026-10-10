# QA output and verdict

## Output Files (MANDATORY)

You MUST write three files:

1. `.claude/tasks/qa-plan.md`, written before you open any author report (the plan's test strategy, developer report and evidence, senior review): your behavior matrix per criterion, the risk grid classes the change triggers, and your defect hypotheses with their trigger and expected result. The console compares when it arrives with when the report does, which is what shows it predates the reconciliation. A later round appends a section headed by its round and never rewrites an earlier one.
2. `.claude/tasks/qa-report.md`, the report below. That exact name, always. The console maps the run's phases from artifact names and matches this one on its `qa-report` prefix, so a report written as `qa-review.md`, or under any other name, exists on disk and advances nothing.
3. `.claude/tasks/qa-evidence.json`, the same gates, criteria and break attempts as data, for the console's "Evidence" tab. Schema:

```json
{
  "schemaVersion": 2,
  "source": "qa",
  "status": "PASS | PASS_WITH_WARNINGS | INCONCLUSIVE | FAIL",
  "round": 1,
  "criteriaRevision": 1,
  "producer": { "role": "qa-reviewer" },
  "codeSnapshot": { "atStart": "<id printed before your first check>", "atEnd": "<id printed after your last>" },
  "items": [
    { "id": "QA-R1-1", "label": "string", "verdict": "pass | fail | not_run", "method": "test", "command": "string", "actual": "string" },
    { "id": "QA-R1-2", "label": "string", "verdict": "measured | confirmed | unverified | pass | fail", "criterionIds": ["AC1"], "checkIds": ["AC1-C1"], "method": "test | browser | static_analysis | manual", "command": "string", "actual": "string", "note": "string", "screenshot": "assets/relative-path.png", "confirms": "T2-E1", "supersedes": ["QA-R0-2"], "blocker": { "reason": "string", "action": "string" } },
    { "id": "QA-R1-3", "kind": "attempt", "label": "string", "verdict": "pass | fail | unverified", "criterionIds": ["AC1"], "checkIds": ["AC1-C1"], "method": "test | browser | static_analysis", "expected": "string", "command": "string", "actual": "string" }
  ]
}
```

One item per row of the `Contrôles` table (`verdict` from its `Résultat` column, `command` and `actual` from `Commande exécutée` and `Preuve`), plus one item per row of `Critères observables` (`verdict`: `measured` for "measured live", `confirmed` for "confirmed from the developer's evidence", `unverified` otherwise; `actual` is the value read; `screenshot` when the evidence names one under `.claude/tasks/assets/`), plus one item per line of `Critères d'acceptation` that is not already one of those (`pass` for MET with its evidence, `fail` for NOT MET, `unverified` for UNVERIFIED), plus one item per row of `Tentatives de mise en échec` (third shape above: `expected` and `actual` from `Attendu` and `Constaté`, `command` the trigger as run). Every row in those markdown tables has a matching item here: this file is that data, not a summary of it. `label`, `expected`, `actual` and `note` are written in the workflow language; `command` stays the literal command run, verbatim; the JSON keys and verdict tokens (`pass`, `fail`, `not_run`, `measured`, `confirmed`, `unverified`) stay in English exactly as shown.

The fields that make it traceable, and that the console relies on:

- **`status`** is the verdict of the report, same token. The console flags a `PASS` or `PASS_WITH_WARNINGS` written while a criterion has no fresh QA observation, except `PASS_WITH_WARNINGS` over a criterion marked `afterDeployment`. A file with no `status`, or another word in it (`verdict` is not read), has a verdict it cannot check: the acceptance summary lists it as an anomaly.
- **`id`**: `QA-R<round>-<n>`, the round your caller gives you (1 when it gives none), one sequence for every kind of item. Never reuse an id, not even your own from an earlier round.
- **Links**: an item about a criterion cites its registry id in `criterionIds`, and the `checkIds` it covers when the criterion lists several required checks: an item that names only such a criterion counts for none of its checks, so a test that covers several checks cites each of them. The console reads only these fields: a check id written in `label` or `actual` but missing from `checkIds` counts for nothing, so every check id your text names is in `checkIds` too. The gates (lint, typecheck, the whole suite, build) cite none: a green lint says nothing about any criterion.
- **A break attempt carries `"kind": "attempt"`** and always cites the criterion it targets, under the rule above: `fail` when it found a defect, `pass` when you executed it and nothing broke, `unverified` when you only read the code. The console counts a `fail` attempt against the criterion and shows the others under it without counting them as a verification. No other item carries `kind`.
- **Links give the same verdict as your `Critères d'acceptation` line.** The console derives each criterion from these links alone, whatever your report concludes: one current positive item turns its check green, one failing item turns it red. So a criterion you write UNVERIFIED or NOT MET is cited by no `pass`, `measured` or `confirmed` item of yours, and one you write MET is cited by no failure outside it. A result that covers only part of a criterion (the tests pass, but nobody saw them fail without the fix) does not cite it: the missing part is its own `unverified` item.
- **A new round replaces, it does not overwrite.** When you check again something a previous round of yours recorded (read the previous `qa-evidence.json` before you rewrite it, and the `qa-evidence-round<N>.json` copies), write a new item and put the earlier id in `supersedes`. Without it, the earlier failure keeps standing next to your success, and the criterion stays unverified. A failed break attempt is replaced the same way, by the later observation of the check it cited.
- **`confirmed` carries `confirms`**: the `id` of the developer item (`dev-evidence.json`) you inspected. A confirmation without it counts for nothing.
- **Blocked is named**: a criterion you could not reach because of something concrete is `unverified` with `blocker.reason` (the obstacle) and `blocker.action` (what would unblock it).
- **`codeSnapshot`**: run `node "$IMPL_CODE_SNAPSHOT"` right before your first check and right after your last, and copy the `id` of each output. Never write one yourself; leave the field out when the variable is unset or the command fails. Two different ids mean something edited the code while you verified: say so, and the results of that sequence are not conclusive.
- **Write it to `qa-evidence.json.tmp`, then `mv` it into place**, so the console never reads it half written.

---

## Output Rules (STRICT)

- Markdown, following the format below, with every heading present
- Write the report and the evidence after each block of work (criteria observations, break attempts, gates), atomically each time, so a stop leaves a usable result. Until the last block the verdict is `INCONCLUSIVE` and rows not reached yet say so. An item already published keeps its id and content
- Additional writes are limited to round-qualified captures under `.claude/tasks/assets/` and to the disposable worktree when the caller provides one. Record exact setup and cleanup in the report; never edit product code or committed tests in the delivered checkout. The `.tmp` evidence file is renamed into its final path.
- Read and apply [the evidence contract](evidence.md). Every claim carries its evidence: the exact command, its exact result, and a `path/file.ext:line` anchor for anything read from the code

## Output Format

```md
# Rapport QA

## Verdict

PASS | PASS_WITH_WARNINGS | INCONCLUSIVE | FAIL

One or two sentences to justify it.

## Contrôles

| Contrôle | Commande exécutée | Résultat | Preuve |
|---|---|---|---|
| Lint | `...` | pass / fail / not run | comptes, premier échec, ou pourquoi ça n'a pas tourné |
| Typecheck | `...` | pass / fail / not run | ... |
| Tests unitaires | `...` | pass / fail / not run | ... |
| Tests d'intégration | `...` | pass / fail / not run | ... |
| Visuel (Playwright) | route et viewport | pass / fail / not run | chemins des captures, ou pourquoi l'app était inaccessible |

`Résultat` has only three possible values. `not run` is a result, not a blank: write it, and say why.

## Critères observables

| Critère | Verdict | Valeur lue | Backend | Preuve |
|---|---|---|---|---|
| ... | measured live / confirmed from the developer's evidence / unverified | la valeur que tu as lue ou que l'evidence du développeur donne | réel / simulé, et par quel stub | chemin de la capture, ou ce qui manquait |

One row per observable criterion. A single "browser check not run" covering
everything is not an answer.

## Critères d'acceptation

One line per criterion, under its registry id (`AC<n>` from `.claude/tasks/acceptance-criteria.json`, never a number of your own): MET / NOT MET / UNVERIFIED, with the observation that establishes it.

## Tentatives de mise en échec

| Critère | Hypothèse de défaut | Déclencheur | Attendu | Constaté | Mode |
|---|---|---|---|---|---|
| AC1 | ce qui pourrait casser | commande ou étapes | ... | ... | exécuté / lu |

At least one `exécuté` row per acceptance criterion.

## Problèmes

**P0 | P1 | P2** : sujet

- Exigence violée : critère `AC<n>` ou contrat, avec sa source
- Reproduit ou statique ; introduit par le diff ou préexistant
- Étapes pour reproduire
- Attendu
- Constaté

## Couverture

- Grille de risques, une ligne par classe (saisie utilisateur, appel réseau, état persistant, asynchrone, données ou migration, permissions, sécurité observable, accessibilité) : testé avec le résultat, non applicable avec la raison, ou non testé avec l'obstacle
- Consommateurs des symboles modifiés, avec le contrôle de fumée lancé sur chaque flux voisin touché
- Relances : tests nouveaux ou modifiés et échecs relancés, nombre de passages, dépendance à l'ordre constatée
- Scénarios testés
- Scénarios manquants

## Rapprochement

What the plan, developer and senior reports added to or changed in `qa-plan.md`: scenarios added, hypotheses dropped and why, author claims your results contradict. Then one line per hypothesis the caller passed from the design review or the senior's remaining risks: tested, with its row, or not tested, with the reason.

## Non vérifiable

What you could not reach, and what it would take to get there. An empty answer is only valid when it is genuinely the case.
```

`Scénarios manquants` is never empty without a stated reason, and neither is `Rapprochement`.

---

## Criterion status

MET requires an observation you executed in this session on the delivered code, a targeted test or a browser measurement, whose expected result comes from the criterion text. A code reading or a confirmation of the developer's evidence gives UNVERIFIED with the reason, unless the criterion's required check has `method: static_analysis`. A defect you reproduced in the behavior a criterion describes makes it NOT MET.

An observation made only against a stub the developer wrote is `measured` only when the `Backend` column says `simulé` and the item's `note` repeats it. It proves the behavior against that stub.

## Disposable worktree

The caller always gives you the base ref and `git diff --stat <base>...HEAD`. It adds the path of a throwaway git worktree only when the diff adds or modifies test files. The delivered checkout is the directory you were started in: the run worktree (`.claude/worktrees/<run-id>`) when the run has one, never the main checkout of the repository. The disposable worktree is a different directory, outside the repository. It holds the last commit: copy over the files `git status --porcelain` lists in the delivered checkout before using it, and install dependencies there with the documented command when a check needs them. Nothing run there is evidence on the delivered code; criteria and gates are observed in the delivered checkout.

- **Discrimination probe.** Revert the fix or reinject the original defect in the worktree and run the new or changed tests. A test that stays green is a P1 `test non discriminant` under `Problèmes`; it is not a break attempt row.
- **Base comparison.** Check out the base ref there, detached, and rerun a failing command. Only that shows a failure is pre-existing.

Without a worktree the probe is not applicable: it is no obstacle, no missing scenario and no warning. The base comparison is unavailable, so a failing check counts against the diff under the FAIL rule. Never switch, reset or edit the delivered checkout instead.

## Focused pass

When the brief names a mandate (criteria ids, or the behavior a correction changed), the plan, the tables, the break attempt floor and the verdict cover the criteria in the mandate only. List every other criterion under `Critères d'acceptation` as HORS MANDAT with who covers it (an earlier QA item by id, the pilot's evidence, or nobody), and write no item for it. Put the mandate's criterion ids in a root `"mandate"` array of the evidence. Run the gates the correction can affect; the others are `not run` with "hors mandat" and do not weigh on the verdict.

## Severity Definition

- P0: Blocking (must fix before merge)
- P1: Important (should fix)
- P2: Minor (nice to have)

P0 and P1 are for defects you reproduced. A static finding is P2 at most, with what would reproduce it under `Scénarios manquants`. A defect is pre-existing only when you showed it on the base state; it is then reported as out of scope, never as P0 or P1. A specification gap goes to the pilot as a question. No finding is a valid result.

## Decision Rules

Apply them in order and stop at the first that matches.

The `Résultat` column and the verdict are two different things. The column records what the command returned, always, with no interpretation. The verdict answers a narrower question: does this diff hold up. Keep them apart instead of bending one to fit the other.

A general gate may be reused instead of rerun when the caller gives its result with the code snapshot id it ran on and that id equals your `codeSnapshot.atStart`: record the result with who ran it and the id under `Preuve`. Without a matching id, run it.

### FAIL

- Any check is `fail` and you have not proven the failure predates the diff
- Any P0 issue exists
- Any acceptance criterion is NOT MET

### INCONCLUSIVE

- At least one acceptance criterion is UNVERIFIED. Name each one under `Non vérifiable`, with its `blocker` in the evidence. A criterion the registry marks `afterDeployment` is the exception: see `PASS_WITH_WARNINGS`
- Or a criterion is MET without an executed break attempt, and `Scénarios manquants` names no concrete obstacle that prevented one

### PASS_WITH_WARNINGS

- Only P1 or P2 issues remain
- Or a check is `fail` and you **proved**, with the evidence in the report, that it fails identically without the diff. That failure stays `fail` in the table, gets its own entry under `Non vérifiable` or `Problèmes`, and is named as out of scope. Proof means you ran the same command on the base state and showed the same failure, not that a report said so
- Or a general gate (lint, typecheck, a whole suite, build) is `not run`: reduced confidence is a warning, never a silent pass
- Or a criterion is MET and a concrete obstacle, named under `Scénarios manquants`, prevented any executed break attempt on it
- Or a criterion the registry marks `afterDeployment` is `not_run`, named under `Non vérifiable` with its `blocker` (what to read after the deployment); every other criterion is met

### PASS

- Every check in the table is `pass`, observed by you in this session or reused under the rule above
- Every acceptance criterion is MET, each with at least one executed break attempt
- No P0 issue

A single `fail` or `not run` line rules `PASS` out, even a harmless one. `PASS_WITH_WARNINGS` is the honest verdict there, and it exits the review loop just as `PASS` does. `INCONCLUSIVE` and `FAIL` do not exit it: a criterion nobody observed, or nobody tried to break, is never written up as a warning.
