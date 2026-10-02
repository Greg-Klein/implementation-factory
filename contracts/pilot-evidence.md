# Pilot evidence

**The gates you run yourself still get written down.** At tier 0 no `qa-reviewer` runs, so nobody writes `.claude/tasks/qa-evidence.json` and the console's "Preuves" tab reports the tests as never run while they were green in your own terminal. Once lint, typecheck and tests have run, write that file yourself, same schema as `qa-reviewer`'s:

```json
{
  "schemaVersion": 2,
  "source": "qa",
  "status": "PASS | PASS_WITH_WARNINGS | INCONCLUSIVE | FAIL",
  "round": 1,
  "criteriaRevision": 1,
  "producer": { "role": "pilot" },
  "codeSnapshot": { "atStart": "<id>", "atEnd": "<id>" },
  "items": [
    { "id": "GATE-1", "label": "string", "verdict": "pass | fail | not_run", "method": "test", "command": "string", "actual": "string" },
    { "id": "PILOT-1", "label": "string", "verdict": "pass | fail | not_run", "criterionIds": ["AC1"], "method": "test", "command": "string", "actual": "string" }
  ]
}
```

One item per gate (`GATE-<n>`, no `criterionIds`: a gate verifies the change as a whole, never a criterion), plus one item per criterion you verified yourself with something objective, a targeted test that failed before the fix and passes now being the usual one (`PILOT-<n>`, citing the criterion). `label` and `actual` in the workflow language, `command` the literal command run, the JSON keys and verdict tokens in English exactly as shown. A gate you did not run is an item with `not_run` and the reason in `actual`, never a missing item. `codeSnapshot` holds the `id` printed by `node "$IMPL_CODE_SNAPSHOT"`, run right before your first gate and right after your last, never a commit hash: an id the utility did not produce leaves every item "unknown version" ("version inconnue" in French), and a criterion only your items cover stays unverified. `status` follows the decision rules of [the QA contract](qa.md): `INCONCLUSIVE` when a criterion has no `PILOT-<n>` item, since the console flags a `PASS` written over an unobserved criterion. The rest of [the evidence contract](${CLAUDE_PLUGIN_ROOT}/contracts/evidence.md) applies, atomic write included.

**`pass | fail | not_run` is the set a gate row takes, not the whole schema.** When a `qa-reviewer` ran, that file is its output and it carries three more tokens for the observable criteria it reports on: `measured`, `confirmed` and `unverified` (defined in [the QA contract](qa.md)). The console renders all six. So do not touch the verdicts in a file a reviewer wrote: `measured` is not a malformed `pass`, and flattening it deletes the one thing those tokens exist to record, whether QA measured a criterion itself or took it from the developer's evidence. Normalise a verdict only when it falls outside those six tokens.
