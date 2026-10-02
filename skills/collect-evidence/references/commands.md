# Command measurements

- Discover the documented commands from the target repository's instructions, scripts and CI. Run them through the project script or binary; do not substitute a convenient command that happens to pass.
- Record command, result and relevant output. If a wrapper truncates files, changes arguments or synthesizes a result, inspect the source with the host file reader and repeat the check through the project binary. An unestablished result is not a pass or a proven failure.
- Report a modified invocation separately from the documented one. A prefix, flag or environment change is part of the reproduction, not an invisible repair.
- Keep outcome and diagnosis separate. A failure remains a failure even if pre-existing; establish the same failure on a safe base checkout before attributing it to the base. Never switch or reset a shared working tree for this comparison. Use the disposable worktree the caller provides; without one, ask the caller for it and leave the cause unestablished.
- While peers edit a shared tree, scope checks to owned files where possible. Report cross-scope failures as non-conclusive, with affected paths; the pilot repeats repository-wide checks after the batch freezes. Do not diagnose another agent's half-written code.
- Record skipped commands and why. Do not claim coverage of an acceptance criterion merely because lint, typecheck or a whole suite passed.
