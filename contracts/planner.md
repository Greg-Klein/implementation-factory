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
    "e2e": ["string"]
  }
}
```

## Task summary and description

- `summary`: one or two sentences, 200 characters at most, saying what the task achieves, with no implementation detail. The console shows it to the person following the run.
- `description`: the detail a developer needs, in short paragraphs separated by a blank line. Put every file path, identifier and type between backticks.

## Criteria and documentation

- `criterion_ids` is the only link between a task and what it has to prove: the ids of the registry (`.claude/tasks/acceptance-criteria.json`). The plan restates no criterion text of its own.
- `doc_paths`: the documentation pages this task makes stale or has to create (README, architecture or feature page, index, configuration example, changelog), found by surveying what the repository documents. The task updates them in the same commit as the code. An empty list says you looked and found none. A page counts as a file the task writes, like a `file_paths` entry: two tasks that name the same page do not run together. A page that only makes sense once a later ticket lands is left to that ticket and named in `technical_notes`.

## Quality Self-Check (MANDATORY)

Before writing the file, validate:

- Unresolved product decisions are open questions, never invented requirements; identify which tasks they block
- Every acceptance criterion is covered: each registry id appears in the `criterion_ids` of at least one task, or `technical_notes` says why none serves it
- `criteria_revision` is the `revision` of the registry you read, and every `criterion_ids` entry exists in it
- Tasks are correctly ordered
- Dependencies are explicit
- Every task that changes a documented behaviour, adds a folder, a flag, a route or an architectural decision names its pages in `doc_paths`
- Risks are identified
