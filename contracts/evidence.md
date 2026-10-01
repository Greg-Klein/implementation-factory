## Evidence contract

Every evidence file of the run (`dev-evidence-<suffix>.json` and its merge, `qa-evidence.json`, `design-evidence.json`) follows this contract, whoever writes it. Every producer reads this contract before writing evidence. The console reads these files as data and archives each version: what they claim is what the merge request summary will say.

```json
{
  "schemaVersion": 2,
  "source": "developer | qa | design",
  "round": 1,
  "criteriaRevision": 1,
  "producer": { "role": "developer | qa-reviewer | designer-reviewer | pilot" },
  "codeSnapshot": { "atStart": "<id>", "atEnd": "<id>" },
  "items": [
    {
      "id": "unique in the run",
      "label": "string, in French",
      "verdict": "pass | fail | not_run | measured | confirmed | unverified",
      "criterionIds": ["AC2"], "checkIds": ["AC2-C1"], "taskIds": ["T3"],
      "method": "test | browser | static_analysis | manual",
      "observedAt": "ISO 8601",
      "expected": "string", "actual": "string", "command": "string", "note": "string",
      "screenshot": "assets/relative-path.png", "attachments": ["assets/other.png"],
      "supersedes": ["an earlier id"], "confirms": "the id of the evidence inspected",
      "blocker": { "reason": "what prevented the check", "action": "what it would take" }
    }
  ]
}
```

- **Identifiers are unique in the run and never reused.** Developer `<task-id>-E<n>` (rework `rework<N>-E<n>`), QA `QA-R<round>-<n>`, design `DS-R<round>-<n>`, your own gates `GATE-<n>` and checks `PILOT-<n>`. A later round that verifies the same check again writes a **new** item with a new id and names the earlier one in `supersedes`. That is the only way a success replaces an earlier failure; a failure left unreplaced keeps the criterion from turning green.
- **Links.** An item about a criterion cites it in `criterionIds`, plus the `checkIds` it covers when the criterion lists several required checks; an item that names only such a criterion is shown but counts for none of its checks. General gates (lint, typecheck, the whole suite, a build) cite nothing. `criteriaRevision` is the registry revision the producer read.
- **Blocked is not unverified.** A check prevented by something concrete (an unreachable environment, missing credentials, a state that cannot be reached) is `not_run` or `unverified` with a `blocker` naming the obstacle and what would unblock it. Without a named obstacle it is simply unverified.
- **A confirmation names what it checked.** `confirmed` always carries `confirms` with the id of the evidence inspected; it stays worth that evidence, on the code that evidence was taken on.
- **The code version comes from the shared utility, never from you.** Run `node "$IMPL_CODE_SNAPSHOT"` right before the first measurement of a sequence and right after the last, and copy the `id` of its JSON output into `codeSnapshot.atStart` and `codeSnapshot.atEnd` (or `codeSnapshotId` / `codeSnapshotAtEnd` on each item, which is what developers do so a merge keeps them). Never type, shorten or edit an id. When `IMPL_CODE_SNAPSHOT` is unset or the command fails, leave the fields out: the console then shows "version inconnue", which is true. Two different ids around one measurement mean the code moved under it: that measurement is not conclusive, and it is redone rather than reported.
- **`observedAt` is read from the clock** (`date -u +%Y-%m-%dT%H:%M:%SZ`) when the result comes in, never a rounded or placeholder date. When you do not have it, leave the field out: the console then shows when it received the file. It does the same, with a warning, for a date later than the file's arrival.
- **Written whole, then renamed into place**: write `<name>.json.tmp`, then `mv` it over `<name>.json`. The console reads files as they land, and a file caught half written is counted as nothing.

## Idempotent aggregation and continuations

The pilot (or review orchestrator for rework) aggregates evidence by immutable item id. Preserve existing items and append unseen ids unchanged. An identical item already present is skipped; the same id with different content is a contract error, never an overwrite. Ask the producer for a fresh id with `supersedes` and retain the original. A measurement-only continuation follows the same rule as a new review round. Do not append duplicates just because the same suffixed file was read twice.

Reports are consolidated by suffix: keep other task sections, replace only the refreshed suffix section with its complete report, preserving its implementation history. Recipes use the same section ownership. The final evidence file retains history through unique ids and supersession, not through conflicting copies of the same id.
