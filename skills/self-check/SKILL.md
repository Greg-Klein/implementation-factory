---
name: self-check
description: Verify your own implementation before handing it to a reviewer. Derive checks from the assigned requirements, changed behavior and concrete edge cases, then report coverage and limits. For authors of changes, not independent reviewers.
---

# Implementation self-check

Input: assigned requirements, scope, implementation and repository verification conventions. Return checks, results, uncovered behavior and reproduction details. Use only the caller's authorized files and execution tools.

1. Map each assigned requirement to behavior the user or consumer can observe. Separate general quality gates from checks that establish a specific criterion.
2. For a bug, establish a reproduction and a regression test that fails for the pre-fix behavior. If safely running the base is unavailable, say which part of that claim remains unverified.
3. Add or update tests for changed behavior, including relevant boundaries and error states. Check that they can fail for the defect: avoid assertions that merely repeat the implementation or mocks that remove the behavior under test.
4. Examine the changed boundary's consumers and real edge cases. For UI changes include semantics, keyboard access, focus, and existing selector contracts; for asynchronous work consider cancellation, retries, ordering and cleanup where affected.
5. Execute the repository's checks and observe relevant runtime behavior. The separate `collect-evidence` skill can supply mechanics after you select the checks; it does not decide coverage for you. If unavailable, use documented project commands and report the limitation.
6. Report what passed, failed, was not executed or is non-conclusive. Identify remaining criteria and setup recipes. Never label your self-check an independent review.

If repeated attempts fail, stop patching on the same unproven premise. Isolate a smaller reproduction, compare competing causes and escalate a plan or product decision that the evidence disproves.
