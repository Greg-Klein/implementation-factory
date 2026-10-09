# Improvement verdict

Files of the headless session that decides whether a self-improvement branch is merged into the harness without the user (`/implementation-harness:judge-improvement`). The console writes the input, the judge writes the verdict, and the console validates it with `judgeVerdict` in `console/server/auto-merge-policy.ts`. Every value the judge writes is in English: it is shown in the console.

## Input (written by the console)

```json
{
  "worktreeName": "self-improvement-1a2b3c4d",
  "branch": "worktree-self-improvement-1a2b3c4d",
  "worktreePath": "/abs/.claude/worktrees/self-improvement-1a2b3c4d",
  "base": "<commit of the harness the branch sits on>",
  "diffPath": "/abs/diff.patch",
  "changedFiles": [{ "status": "M", "path": "agents/developer.md", "added": 4, "removed": 1 }],
  "checks": [{ "name": "unit tests", "command": "npm run test:unit", "ok": true }],
  "feedbackDirectory": "/abs/feedback",
  "runsDirectory": "/abs/runs",
  "planPath": "/abs/feedback/improvement-plan-1a2b3c4d.md",
  "reportPath": "/abs/feedback/improvement-report-1a2b3c4d.md"
}
```

`planPath` may be `null` when the improvement session wrote no plan. The checks listed all passed: the console does not start the judge otherwise. The processed feedback entries of this branch are the files of `<feedbackDirectory>/processed/` whose `branch` names it.

## Verdict (written by the judge)

```json
{
  "expected": "What a correct fix of the evidence should change, written before reading the plan, the report and the diff.",
  "decision": "merge",
  "reasons": ["One sentence per reason, the first one carrying the decision."]
}
```

- `decision`: `merge` or `hold`. Nothing else.
- `expected`: a non-empty string.
- `reasons`: 1 to 10 non-empty sentences.

A missing file, a file that is not valid JSON or a field outside these rules is read as `hold`. The judge never edits, commits, merges or discards anything: the console acts on the verdict.

## When to answer `hold`

Any one of these is enough:

1. The evidence (the processed entries and their run archives) does not establish the cause the change claims to fix, or the cause sits in the target repository, the ticket or the environment.
2. The change treats a symptom of that cause, or fixes something the evidence does not mention.
3. The change writes a rule from a single run that the evidence does not show recurring, outside an explicit user report.
4. The change weakens a quality gate: a check removed or loosened, a review skipped, a verdict accepted on less evidence, a safety or privacy rule relaxed.
5. The diff goes beyond what the plan announces.
6. The change alters a behavior that `docs/` (`architecture.html`, `agent-map.html`, `engineering-workflow.md`), `README.md` or `CLAUDE.md` describes, and the branch leaves that description stale.
7. You cannot tell. A doubt is a `hold`: the user then decides.
