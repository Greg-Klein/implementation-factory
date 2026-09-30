# Evidence discipline

Use these rules for every `why` investigation. This file belongs to this skill and has no shared-resource dependency. The `why` workflow separately requires the `how` skill for its current-code anchor.

## Claim labels

| Label | Meaning | Example |
| --- | --- | --- |
| `OBSERVED` | Directly supported by a source actually inspected; attribute the source's claim. | The introducing commit states that this branch supports protocol v1. |
| `INFERRED` | A conclusion derived from observations without direct confirmation. Give supporting evidence and the limitation. | The branch likely also prevents duplicate delivery, based on the ordering of updates; the author did not state that motive. |
| `UNKNOWN` | The inspected evidence does not establish the answer. Identify the missing source. | Whether any v1 clients remain in production is unknown without a supported-client policy or deployment evidence. |

Do not convert plausibility into intent. Split claims that mix observation and inference; avoid confidence percentages.

## Historical reasoning

- A diff establishes what changed. It does not establish why the author chose it.
- A commit message, ADR, or discussion establishes a stated rationale. Attribute it; a participant's statement is not automatically a complete or accurate organizational decision.
- A later document may be a retrospective explanation. Distinguish it from evidence recorded when the decision was made.
- Blame identifies the most recent attributed change, not necessarily the origin. Formatting, moves, squash commits, and generated code can obscure provenance.
- Tests encode expectations for their version. They may corroborate a constraint but do not prove its historical motive or present deployment necessity.
- A closed incident or completed migration does not by itself prove all compatibility obligations disappeared.
- An empty search establishes only that those terms were not found in the accessible scope. Missing rationale is not evidence that a choice was accidental or unjustified.
- Preserve contradictions. Different branches, release policies, time periods, and scopes can explain disagreements; identify which interpretation is supported.

## Current relevance

Treat these as separate questions:

1. What did the introducing change do?
2. What rationale was stated at that time?
3. What current evidence supports, supersedes, or leaves unresolved that constraint?

Never answer the third solely from the first two. Report current behavior from inspected source and configuration, not an old `how` result. Do not infer deployment adoption from a repository's default setting alone.

## Cite precisely

- Cite current code with repository, revision, path, symbol, and line/range if available. Mark uncommitted code as working-tree evidence.
- Cite history with an inspected commit ID, path/hunk when useful, and an accurate date if used. State when a referenced source is unavailable rather than implying it was read.
- Cite PRs/MRs, tickets, and documents with exact URLs or identifiers and a relevant comment/section. Never manufacture a link from a guessed issue number or Git host.
- Put evidence near each consequential claim. Use the host's native citation format if supplied; otherwise provide retrievable source locations.
- Record coverage limits such as shallow history, inaccessible trackers, missing predecessor paths, or an unavailable current checkout.
- Report test bodies as inspected, not executed. This skill does not run tests or application code.
