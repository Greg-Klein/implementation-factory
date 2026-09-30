---
name: collect-evidence
description: Collect reproducible results for checks already selected by a caller, using documented commands or a running application. Use to execute checks reliably and distinguish observations, failures, unavailable checks and stale results. Does not choose a test strategy, independently review a change, fix code or declare acceptance.
---

# Collect evidence

Input: selected checks, their expected observations and sources, repository or app, and permitted execution scope. Return observations with reproduction details and limitations. The caller owns any output files and verdict.

1. Establish what is being measured: code version, relevant local changes, command or route, environment and expected result. Do not expose credentials.
2. For command execution, read [commands.md](references/commands.md). For browser observations, read [browser.md](references/browser.md). Load only the applicable reference.
3. Execute only authorized checks. Record actual results, not what the command or code was supposed to do. Never weaken an assertion or change the implementation to obtain a passing measurement.
4. Check that the source and environment stayed stable during measurement. If they moved, return a non-conclusive observation for remeasurement on stable code.
5. Return one result per selected check: method, exact command or reproduction steps, expected and actual, version, attachments when useful, and a concrete obstacle if blocked. Distinguish fresh execution from inspecting another person's evidence.

This skill supplies measurement mechanics only. The developer, code reviewer and QA choose their own checks under their separate methods. Do not turn a list supplied by the author into a claim of complete coverage.
