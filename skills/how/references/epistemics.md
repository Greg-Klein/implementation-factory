# Evidence discipline

Use these rules for every `how` investigation. This file belongs to this skill; no shared resource or companion skill is required.

## Claim labels

| Label | Meaning | Example |
| --- | --- | --- |
| `OBSERVED` | Directly supported by a source actually inspected. State what kind of source it is. | The function deletes the cache entry in its `finally` block (source inspection). |
| `INFERRED` | A conclusion derived from observations rather than directly established. Give the reasoning and its limit. | The cleanup appears to prevent stale entries; authorial intent was not investigated. |
| `UNKNOWN` | Available evidence cannot answer the question. State the missing source or discriminating check. | Whether production enables the flag is unknown because deployed configuration is unavailable. |

Do not use confidence percentages. If a claim mixes observation and inference, split it.

## What each source establishes

- Source code establishes the inspected implementation, not that a path ran in production or is reachable under an unseen configuration.
- Types establish declared contracts, not runtime validation. Verify guards and callers before claiming enforcement.
- A test body establishes a test expectation, not a passing result. A test report establishes only the result for its recorded command, revision, environment, and time.
- Logs or traces establish recorded events within their coverage. They do not establish universal ordering or absence of other events.
- Documentation and comments establish a written claim. Resolve conflicts with the applicable implementation; report meaningful contradictions instead of silently selecting one.
- A search with no matches establishes only that the query found nothing in the inspected scope. It does not prove that a behavior or consumer does not exist.
- A name such as `safe`, `legacy`, or `validated` is a search hint, not evidence of safety, obsolescence, or validation.

## Cite precisely

- Cite the inspected relative path, symbol, and line or range if the host supports it. Record the repository and revision once; mark references into uncommitted code as working-tree references.
- Place evidence next to the claim it supports. An inline source ID is acceptable if a compact evidence list resolves it to an exact source.
- Cite both ends of a consequential runtime edge when the connection is not evident in a single location.
- For remote sources, retain the exact source URL or identifier and enough location information to retrieve the evidence. Do not manufacture links, line numbers, or source IDs.
- Use the host's native citation format when available. When line numbers are unavailable, cite an exact symbol and path and say so.

## Report limits honestly

- Prefer a partial model with a named boundary to a complete-looking invented trace.
- Distinguish an enforced invariant from an assumption, a desired property, and a test expectation.
- Never attribute design intent solely from current structure. Report it as an inference or leave it to a historical investigation.
- Preserve contradictory evidence and explain which conditions or revisions each source describes.
- Do not claim tests passed, the application was launched, or a bug was reproduced without corresponding execution evidence. This skill does not run tests or application code.
