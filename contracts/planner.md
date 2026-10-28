# Planner output

## Language

Every free-text field's content is written in the workflow language: `summary`, `assumptions`, `open_questions`, `requirements.*`, `tasks[].title`/`summary`/`description`, `technical_notes`, `risks[].description`/`mitigation`, `test_strategy.*`. Field names, paths and enum-like values (`complexity: S|M|L`, `impact: low|medium|high`) stay in English exactly as specified below: other agents and the console read them as data, not as prose.

---

## Output Format (STRICT JSON)

```json
{
  "criteria_revision": 1,
  "summary": "string",
  "assumptions": ["string"],
  "open_questions": ["string"],
  "requirements": {
    "functional": ["string"],
    "non_functional": ["string"],
    "constraints": ["string"],
    "out_of_scope": ["string"]
  },
  "tasks": [
    {
      "id": "T1",
      "title": "string",
      "summary": "string",
      "description": "string",
      "file_paths": ["string"],
      "doc_paths": ["string"],
      "inputs": ["string"],
      "outputs": ["string"],
      "dependencies": ["T0"],
      "criterion_ids": ["AC1"],
      "verification_steps": ["string"],
      "complexity": "S|M|L"
    }
  ],
  "technical_notes": ["string"],
  "risks": [
    {
      "description": "string",
      "impact": "low|medium|high",
      "mitigation": "string"
    }
  ],
  "test_strategy": {
    "unit": ["string"],
    "integration": ["string"],
    "e2e": ["string"],
    "integration_policy": {
      "expected": true,
      "sources": ["string"],
      "command": "string",
      "reason": "string"
    },
    "e2e_policy": {
      "expected": true,
      "sources": ["string"],
      "command": "string",
      "reason": "string"
    }
  }
}
```

## Task summary and description

- `summary`: one or two sentences, 200 characters at most, saying what the task achieves, with no implementation detail. The console shows it to the person following the run.
- `description`: the detail a developer needs, in short paragraphs separated by a blank line. Put every file path, identifier and type between backticks.

## Criteria and documentation

- `criterion_ids` is the only link between a task and what it has to prove: the ids of the registry (`.claude/tasks/acceptance-criteria.json`). The plan restates no criterion text of its own.
- `doc_paths`: the documentation pages this task makes stale or has to create (README, architecture or feature page, index, configuration example, changelog), found by surveying what the repository documents. The task updates them in the same commit as the code. An empty list says you looked and found none. A page counts as a file the task writes, like a `file_paths` entry: two tasks that name the same page do not run together. A page that only makes sense once a later ticket lands is left to that ticket and named in `technical_notes`.

## Integration and end-to-end tests

Many repositories drive the running application in a browser in two suites that treat the backend differently. An **integration** suite drives the app with every request to the backend mocked, so it runs anywhere. An **end-to-end** suite drives the app against a real backend (a test environment, real accounts), so it needs that environment and its credentials. The repository's own names, folders and configs say which suite is which: `integration/` with a mocked API and `e2e/` against the test environment, for example. Read how each suite reaches the backend (its config, its support files, its setup) before deciding anything. A repository with a single browser suite has one kind only, the one its backend handling makes it.

Whether this ticket gets a spec in each suite is decided by the target repository, never by taste. Before splitting, read what it says and what it does, for each suite:

- **Instructions.** What the repository tells contributors about tests: `CLAUDE.md`, `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, at the root and in the package the change touches, the testing pages under `docs/`, the project skills under `.claude/skills/`, the merge request or pull request templates (`.gitlab/merge_request_templates/`, `.github/pull_request_template.md`). A rule they state ("every new page gets a Playwright spec", "a user flow is covered end to end") binds the changes it names; the nearest file wins over the root one.
- **Practice.** The tooling (`playwright*.config.*`, `cypress.config.*`, `wdio.conf.*`, a `test:integration` or `test:e2e`-like script in a manifest, the folder a config names as its test directory, a CI job that runs them) and the specs it holds. When the flows comparable to the one this ticket changes or adds each have a spec in a suite, this one gets one in that suite too. Tooling with no spec for a comparable flow is not a requirement.
- **Neither.** No spec in that suite. Never add a framework, a configuration, a suite or a CI job the ticket does not ask for.

The two decisions are independent: a change can need an integration spec and no end-to-end spec, both, or neither. When `.claude/tasks/runtime-recipe.md` has a section on these suites, start from it: check that the sources it names still say so and that its commands still exist, rather than surveying the repository again from scratch.

An instruction wins over practice. Record each decision in `test_strategy`, `integration_policy` for the suite that mocks the backend and `e2e_policy` for the suite that reaches a real one, with the same fields:

- `expected`: `true` when the instructions or the practice ask for a spec in that suite for this change.
- `sources`: the files that decided it, with the section or the comparable spec (`CONTRIBUTING.md#Tests`, `integration/chat.spec.ts`). Empty when you looked and found nothing, which `reason` says.
- `command`: the repository's command that runs one spec of that suite, as its manifest or documentation gives it, or `""` when there is none.
- `reason`: one sentence, in the workflow language.

When a policy is `expected`, the task that changes or adds the flow owns its spec in that suite: the spec path in `file_paths`, placed and named like its neighbours, the criteria it proves in `criterion_ids`, and in `verification_steps` a step that holds that policy's `command` exactly as written, followed by that spec's path.

A hook refuses to start a `developer` while either decision is missing or incomplete: the policy absent, `expected` not a boolean, `sources` not a list of strings, `command` not a string, `reason` empty, and when `expected` is `true`, no source, an empty `command`, or no task whose `verification_steps` hold it. `test_strategy.integration` and `test_strategy.e2e` list the scenarios of each suite, one per flow and state the criteria name. Whatever `expected` says, an existing spec that drives a flow the task changes is in that task's `file_paths`: a change that breaks a spec updates it in the same commit. A shared helper or fixture two tasks edit is a shared file, like any other.

**A spec reaches the backend the way its suite does.** An integration spec mocks every request of the flow it drives, with the suite's own pattern (its mock API server, its fixtures, network interception such as Playwright `page.route` or Cypress `cy.intercept`, MSW handlers), and response shapes taken from the API types or clients in the code. An end-to-end spec talks to the real backend its suite targets, through the suite's own accounts, setup and helpers, and mocks nothing the suite does not mock. Never move a spec from one suite to the other to make it runnable. An end-to-end spec may need an environment, accounts or secrets the run does not have: it is still written, and the run that cannot execute it reports it `unverified` with the missing variable or environment as its blocker, never as passing. The task's `description` names, for an integration spec, the requests to mock and where their shapes come from, and for an end-to-end spec, the setup and accounts it relies on.

## Quality Self-Check (MANDATORY)

Before writing the file, validate:

- Unresolved product decisions are open questions, never invented requirements; identify which tasks they block
- Every acceptance criterion is covered: each registry id appears in the `criterion_ids` of at least one task, or `technical_notes` says why none serves it
- `criteria_revision` is the `revision` of the registry you read, and every `criterion_ids` entry exists in it
- Tasks are correctly ordered
- Dependencies are explicit
- Every task that changes a documented behaviour, adds a folder, a flag, a route or an architectural decision names its pages in `doc_paths`
- `test_strategy.integration_policy` and `test_strategy.e2e_policy` are filled from the repository's instructions and practice, and for each policy that is `expected`, every flow it covers has its spec in a task's `file_paths`
- Risks are identified
