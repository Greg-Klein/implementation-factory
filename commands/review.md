---
name: review
description: Independently review the current branch or a supplied change and return evidence-backed findings without modifying code.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep, Skill
argument-hint: <file-path-or-diff>
---

Review: $ARGUMENTS

Read [engineering principles](${CLAUDE_PLUGIN_ROOT}/principles/engineering.md). Load `implementation-harness:review-change` with its code-review method and [the comment format](${CLAUDE_PLUGIN_ROOT}/contracts/review-comments.md).

Start with the actual diff, authoritative requirements and relevant consumers. Form expected behavior and counterexamples before consulting author reports or previous verdicts; disclose prior exposure when supplied in the request. Use `implementation-harness:how` for an unfamiliar mechanism and `implementation-harness:why` for uncertain historical constraints only when needed, respecting its required dependency.

Inspect correctness, real security boundaries, justified simplicity, measurable performance concerns and readability that affects understanding. Report evidence, concrete impact and unknowns. Do not flag unestablished style preferences, speculative future issues or impossible states. No finding is a valid result.

Do not fix code, publish comments or change external state. Execute checks only within the review authorization, through the documented commands; report what was not run. Return findings and the verdict using the linked format, written with `implementation-harness:unslop`.
