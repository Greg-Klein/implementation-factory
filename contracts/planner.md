# Planner output

## Language

Every free-text field's content is written in French: `summary`, `assumptions`, `open_questions`, `requirements.*`, `acceptance_criteria`, `tasks[].title`/`description`, `technical_notes`, `risks[].description`/`mitigation`, `test_strategy.*`. Field names and enum-like values (`complexity: S|M|L`, `impact: low|medium|high`) stay in English exactly as specified below — other agents and the console read them as data, not as prose.

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
  "acceptance_criteria": ["string"],
  "tasks": [
    {
      "id": "T1",
      "title": "string",
      "description": "string",
      "file_paths": ["string"],
      "inputs": ["string"],
      "outputs": ["string"],
      "dependencies": ["T0"],
      "acceptance_criteria": ["string"],
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

## Quality Self-Check (MANDATORY)

Before writing the file, validate:

- Unresolved product decisions are open questions, never invented requirements; identify which tasks they block
- Every acceptance criterion is covered: each registry id appears in the `criterion_ids` of at least one task, or `technical_notes` says why none serves it
- `criteria_revision` is the `revision` of the registry you read, and every `criterion_ids` entry exists in it
- Tasks are correctly ordered
- Dependencies are explicit
- Risks are identified
