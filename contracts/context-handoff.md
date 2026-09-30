# Investigation handoff

`how` and `why` return findings; neither writes artifacts, starts the application or runs tests. Their own epistemics references remain separate and self-contained.

Load them on demand through the host skill catalog: in this plugin their qualified names are `implementation-harness:how` and `implementation-harness:why`. Do not assume a slash command is a shell program. When using `why`, resolve and load the installed `how` through that catalog; a matching directory alone does not prove availability. If it is missing or unloadable, report the required dependency and stop the historical investigation, without installing or imitating it.

The pilot owns `.claude/tasks/investigation-context.md` when persistence is useful. A planner or worker returns additional findings to the pilot in its existing output; it does not acquire another writable report path. No investigation file is required for a simple, already understood change.

For each saved result, record:

- the question, scope and producing skill;
- repository identity, revision, relevant dirty/untracked files and the inspected source state;
- entry points, consumers, invariants and precise source references;
- observed facts, consequential inferences, unknowns and inspection limits;
- whether tests were merely read or independently executed elsewhere.

Before reuse, compare scope, repository, revision and relevant working-tree state, then check consequential source anchors. A matching HEAD is insufficient when local files changed. Refresh the affected slice when it differs or cannot be established; preserve still-valid findings. A narrower model does not answer a broader question.

For reviewers, an author-provided model is deferred context: form initial expectations from the specification and code first, then challenge that model and recheck its anchors. Do not pass the author's diagnosis as the reviewer's expected answer. An independently invoked `how` explains the code; it does not certify the implementation.
