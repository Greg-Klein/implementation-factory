## Workflow state

`.claude/tasks/workflow-state.json` says what you are doing and what comes next. The console reads it as data; hooks tell it what happened, only this file tells it what you expect to happen. Write it whole to `workflow-state.json.tmp`, then `mv` it into place, like every other file the console reads.

```json
{
  "schemaVersion": 1,
  "revision": 7,
  "state": "working | waiting | completed | blocked",
  "step": "5",
  "reviewTier": 1,
  "nextAction": {
    "kind": "run_step | await_agent | await_process | await_dependency | deliver",
    "taskIds": ["T3"],
    "agents": ["developer"],
    "expectedArtifact": "qa-report.md",
    "description": "string, in the workflow language: what happens next, in one sentence"
  },
  "result": {
    "delivery": "merge_request | draft_merge_request | none",
    "mergeRequestUrl": "https://…",
    "blockers": ["string, in the workflow language"]
  }
}
```

- **`revision` starts at 1 and goes up by one on every write.** A lower revision is ignored.
- **`reviewTier`** is the tier you picked at step 7 (`0`, `1` or `2`). Write it from the state that opens step 7 onwards, on every later write. The console keeps it with the run's figures, which is how two runs of the same tier get compared.
- **`working`** when you start a step (`step` is its number, `nextAction.kind` `run_step`). The console shows and times the run by this number: a step you do not declare is a step it never saw.
- **`waiting`** right before you end a turn while something works for you: `await_agent` with the `agents` and `taskIds` of the batch you launched in the background, `await_process` for a background command or a `Monitor` you are waiting on, `await_dependency` for anything else outside the session, with `expectedArtifact` when a file will mark the end. A declared wait never hides a run for long: with no agent actually running, `await_agent` is reported as no next action, and the others turn into a doubt after the silence threshold.
- **`completed`** at step 10, before the archive sync, and again at the end of a run a later request reopened (back to `working` first, see "A request after the final report" in the command): `result.delivery` is `merge_request` or `draft_merge_request` with the `mergeRequestUrl` you opened (the address of the pull request on GitHub, under the same field and the same `delivery` values), or `none` with every reason in `blockers`. A draft merge request with known blockers is a correct end: list them. The console checks the end against the merge request it saw; an end it cannot confirm does not close the run.
- **`blocked`** when you stop for one of the two reasons "Never invent" allows, with `nextAction.description` naming what would unblock the run.

Without `IMPL_RUN_ID` there is no console reading it; write it anyway, it costs nothing.
