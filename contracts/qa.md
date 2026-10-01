# QA output and verdict

## Output Files (MANDATORY)

You MUST write two files:

1. `.claude/tasks/qa-report.md` — the report below. That exact name, always. The console maps the run's phases from artifact names and matches this one on its `qa-report` prefix, so a report written as `qa-review.md`, or under any other name, exists on disk and advances nothing.
2. `.claude/tasks/qa-evidence.json` — the same gates and observable criteria as data, for the console's "Preuves" tab. Schema:

```json
{
  "schemaVersion": 2,
  "source": "qa",
  "status": "PASS | PASS_WITH_WARNINGS | FAIL",
  "round": 1,
  "criteriaRevision": 1,
  "producer": { "role": "qa-reviewer" },
  "codeSnapshot": { "atStart": "<id printed before your first check>", "atEnd": "<id printed after your last>" },
  "items": [
    { "id": "QA-R1-1", "label": "string", "verdict": "pass | fail | not_run", "method": "test", "command": "string", "actual": "string" },
    { "id": "QA-R1-2", "label": "string", "verdict": "measured | confirmed | unverified | pass | fail", "criterionIds": ["AC1"], "checkIds": ["AC1-C1"], "method": "test | browser | static_analysis | manual", "command": "string", "actual": "string", "screenshot": "assets/relative-path.png", "confirms": "T2-E1", "supersedes": ["QA-R0-2"], "blocker": { "reason": "string", "action": "string" } }
  ]
}
```

One item per row of the `Contrôles` table (`verdict` from its `Résultat` column, `command` and `actual` from `Commande exécutée` and `Preuve`), plus one item per row of `Critères observables` (`verdict`: `measured` for "measured live", `confirmed` for "confirmed from the developer's evidence", `unverified` otherwise; `actual` is the value read; `screenshot` when the evidence names one under `.claude/tasks/assets/`), plus one item per line of `Critères d'acceptation` that is not already one of those (`pass` for MET with its evidence, `fail` for NOT MET, `unverified` for UNVERIFIED). Every row in either markdown table has a matching item here — this file is that data, not a summary of it. `label` and `actual` are written in French; `command` stays the literal command run, verbatim; the JSON keys and verdict tokens (`pass`, `fail`, `not_run`, `measured`, `confirmed`, `unverified`) stay in English exactly as shown.

The fields that make it traceable, and that the console relies on:

- **`id`**: `QA-R<round>-<n>`, the round your caller gives you (1 when it gives none). Never reuse an id, not even your own from an earlier round.
- **Links**: an item about a criterion cites its registry id in `criterionIds`, and the `checkIds` it covers when the criterion lists several required checks: an item that names only such a criterion counts for none of its checks, so a test that covers several checks cites each of them. The console reads only these fields: a check id written in `label` or `actual` but missing from `checkIds` counts for nothing, so every check id your text names is in `checkIds` too. The gates (lint, typecheck, the whole suite, build) cite none: a green lint says nothing about any criterion.
- **A new round replaces, it does not overwrite.** When you check again something a previous round of yours recorded (read the previous `qa-evidence.json` before you rewrite it, and the `qa-evidence-round<N>.json` copies), write a new item and put the earlier id in `supersedes`. Without it, the earlier failure keeps standing next to your success, and the criterion stays unverified.
- **`confirmed` carries `confirms`**: the `id` of the developer item (`dev-evidence.json`) you inspected. A confirmation without it counts for nothing.
- **Blocked is named**: a criterion you could not reach because of something concrete is `unverified` with `blocker.reason` (the obstacle) and `blocker.action` (what would unblock it).
- **`codeSnapshot`**: run `node "$IMPL_CODE_SNAPSHOT"` right before your first check and right after your last, and copy the `id` of each output. Never write one yourself; leave the field out when the variable is unset or the command fails. Two different ids mean something edited the code while you verified: say so, and the results of that sequence are not conclusive.
- **Write it to `qa-evidence.json.tmp`, then `mv` it into place**, so the console never reads it half written.

---

## Output Rules (STRICT)

- Markdown, following the format below, with every heading present
- Overwrite your report and publish complete evidence atomically
- Additional writes are limited to round-qualified captures under `.claude/tasks/assets/` and temporary verification scaffolding in the caller-authorized scratch directory. Record exact setup and cleanup in the report; never edit product code or committed tests. Clean temporary scaffolding after checks, retaining cited captures. The `.tmp` evidence file is renamed into its final path.
- Read and apply [the evidence contract](evidence.md). Every claim carries its evidence: the exact command, its exact result, and a `path/file.ext:line` anchor for anything read from the code

## Output Format

```md
# Rapport QA

## Verdict

PASS | PASS_WITH_WARNINGS | FAIL

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

| Critère | Verdict | Valeur lue | Preuve |
|---|---|---|---|
| ... | measured live / confirmed from the developer's evidence / unverified | la valeur que tu as lue ou que l'evidence du développeur donne | chemin de la capture, ou ce qui manquait |

One row per observable criterion. A single "browser check not run" covering
everything is not an answer.

## Critères d'acceptation

One line per criterion, under its registry id (`AC<n>` from `.claude/tasks/acceptance-criteria.json`, never a number of your own): MET / NOT MET / UNVERIFIED, with the evidence and its `file:line` anchor.

## Problèmes

**P0 | P1 | P2** — sujet

- Étapes pour reproduire
- Attendu
- Constaté

## Couverture

- Scénarios testés
- Scénarios manquants

## Non vérifiable

What you could not reach, and what it would take to get there. An empty answer is only valid when it is genuinely the case.
```

---

## Severity Definition

- P0: Blocking (must fix before merge)
- P1: Important (should fix)
- P2: Minor (nice to have)

## Decision Rules

Apply them in order and stop at the first that matches.

The `Result` column and the verdict are two different things. The column records what the command returned, always, with no interpretation. The verdict answers a narrower question: does this diff hold up. Keep them apart instead of bending one to fit the other.

### FAIL

- Any check is `fail` and you have not proven the failure predates the diff
- Any P0 issue exists
- A critical acceptance criterion is not met

### PASS_WITH_WARNINGS

- Only P1 or P2 issues remain, and core functionality works
- Or a check is `fail` and you **proved**, with the evidence in the report, that it fails identically without the diff. That failure stays `fail` in the table, gets its own entry under `Could not be verified` or `Issues`, and is named as out of scope. Proof means you ran the same command on the base state and showed the same failure, not that a report said so
- Or a check is `not run`: reduced confidence is a warning, never a silent pass

### PASS

- Every check in the table is `pass`, observed by you in this session
- Every acceptance criterion is met with evidence
- No P0 issue

A single `fail` or `not run` line rules `PASS` out, even a harmless one. `PASS_WITH_WARNINGS` is the honest verdict there, and it exits the review loop just as `PASS` does: this rule costs no autonomy, it only stops a red or unobserved check from being written up as a green one.
