# Review findings

The senior reviewer writes its findings twice. `senior-review.md` holds them as prose, for the people and agents of this run. `.claude/tasks/senior-findings.json` holds them as data, for the runs that come after. The console keeps that second file per repository. When a kind of defect has been found on at least two tickets in the last 90 days, the next run of the repository receives `.claude/tasks/recurring-findings.md`, which its developers read before they write code.

```json
{
  "schemaVersion": 1,
  "source": "senior",
  "round": 1,
  "findings": [
    { "id": "SR-R1-1", "category": "consumer-left-behind", "severity": "P1", "file": "src/cart/total.ts", "summary": "string, in the workflow language", "fixed": true }
  ]
}
```

- **One entry per line of `## Problèmes constatés`**, corrected or not, in every round. `"findings": []` is what a review that found nothing writes.
- **`id`** is `SR-R<round>-<n>`, unique in the run and never reused. A later round writes its own findings under its own round number, and the console adds them to the earlier ones.
- **`severity`** is the `P0`, `P1` or `P2` of the report.
- **`file`** is the path the finding sits in, relative to the repository root, without a line number. Leave it out when the finding has no single place.
- **`summary`** is one sentence a developer on another ticket can act on. It names the defect and where that kind of defect hides. It carries no ticket number, no name, no secret and no value copied from the ticket's data. "The total is recomputed in the list but not in the cart badge that reads the same store" reads well six weeks later; "AC3 fails" does not.
- **`fixed`** says whether you corrected it yourself.
- Written whole to `senior-findings.json.tmp`, then renamed into place.

## Categories

`category` is one key of this list, exactly as written. The list is fixed because two reviews word the same defect differently, and free labels could not be counted across runs. Pick the key from the kind of mistake that was made. The part of the code it was made in goes in `file`.

| Key | The finding is |
| --- | --- |
| `requirement-missed` | an acceptance criterion or the run instruction left unimplemented |
| `consumer-left-behind` | a caller or consumer of a changed contract left as it was |
| `edge-case` | a boundary value or an empty case mishandled |
| `error-handling` | an error swallowed, left unhandled or shown raw |
| `async-state` | a race, a missing cancellation, a stale or half-updated state |
| `ui-state` | a loading, empty or error state missing |
| `boundary-validation` | outside data trusted without validation |
| `authorization` | a permission or ownership check missing |
| `injection` | an outside value reaching a query, a command, a path, markup or a URL unescaped |
| `secret-exposure` | a secret, a token or personal data leaving in a log, an error, a response or a URL |
| `data-integrity` | a write that can lose or corrupt data |
| `type-escape` | a type silenced: `any`, unsafe cast, non-null assertion |
| `test-cannot-fail` | a test that cannot fail for the defect it covers |
| `test-gap` | a changed behaviour left without a test |
| `repository-convention` | a convention or an existing pattern of the repository not followed |
| `duplication` | an existing helper or component written again |
| `accessibility` | a control without semantics, label or keyboard access |
| `performance` | needless work on a changed path |
| `dead-code` | dead code, leftover debug output or TODO |
| `stale-documentation` | documentation the change made false |
| `other` | anything else |

`other` is counted nowhere, so use it only when no key fits. Never invent a key, since the console files an unknown one under `other`.

## Reading `recurring-findings.md`

The file lists kinds of defect, each with the latest findings of that kind. A developer checks its own change against them before handing over, and names in its report the ones that applied. The file adds no requirement and widens no scope. A kind that does not concern the task is left alone, and code outside the task stays as it is even when it shows one. A reviewer does not read the file before its own diagnosis.
