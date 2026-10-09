---
name: review-change
description: Independently challenge an implementation from its specification and diff, looking for counterexamples, regressions, untested consumers and tests that pass for the wrong reason. Use for code review or independent QA, not author self-checks. Returns findings without fixing code.
---

# Independent review

Input: authoritative requirements and decisions, diff or changed scope, current code, review depth, and permitted tools. Return an evidence-backed review. Do not modify product code, fix tests, publish comments or infer permission to do so.

## Establish an independent basis

Before reading developer conclusions, self-check reports, prior verdicts or an author-provided mental model, derive your own expected behavior and plausible failure cases from the specification, consumers and current code. Record this initial basis in the eventual review report. A planner's solution is not a specification. If the caller already disclosed the diagnosis, state that exposure and deliberately test an alternative explanation; do not claim a blind review.

Choose the applicable method: [code-review.md](references/code-review.md) for code review, [behavioral-qa.md](references/behavioral-qa.md) for independent QA. Do not run both by default.

After the initial analysis, consult author reports to reconcile omissions, reuse setup and check claimed results. Inspect their sources rather than treating their agreement as corroboration. Reusing a fixture does not require trusting its oracle; challenge stubs that predetermine the result.

You may use `how` for an unfamiliar behavior, or `why` before treating unusual compatibility as unnecessary. Their results explain behavior and history; they do not decide correctness. Independently check consequential anchors. Respect `why`'s required `how` dependency.

## Evidence and completion

Use `collect-evidence` only for execution mechanics after independently choosing checks. A passed author-selected suite is useful evidence, not a complete review. Do not use the author's `self-check` method as your review plan.

Each finding states the violated requirement or contract, concrete trigger, expected and actual behavior, affected consumer, evidence and impact. Distinguish reproduced defects from static findings and unknowns. Do not invent findings to meet a quota; no findings is a valid outcome.

Follow the caller's severity and output contract, and write findings with `implementation-factory:unslop`. Return initial review basis, findings, checks and limits. When the caller is a corrective reviewer, finish this diagnostic phase before it applies fixes under its own role. A correction requires fresh validation; it does not prove its own correctness.
