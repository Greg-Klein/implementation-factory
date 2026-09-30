# Independent QA

- Derive a behavior matrix from authoritative criteria before reading developer or senior verdicts: relevant input classes, transitions, boundaries, negative cases and observable effects. Choose a small discriminating set, not an exhaustive inventory.
- Inspect the implementation and tests for missing scenarios independently of the author's coverage map. General gates and acceptance checks answer different questions.
- Verify the final code after corrections have stopped. Run the documented checks, then selected behavioral experiments. Add counterexample checks through permitted temporary scaffolding; do not edit product code or committed tests when the QA role forbids it.
- Reuse a validated setup recipe to reach the state, but inspect whether its fixtures mask behavior or impose the answer. Distinguish real integration from simulation and product failures from malformed test setup.
- Confirm author evidence only after checking what it actually establishes, its version and its scope. Label confirmation separately from fresh execution, and retain an independent counterexample search even when the author reports all green.
- Keep failure cause separate from result. A pre-existing failure requires a safe comparison, not an assertion from another report. Where fresh execution is impossible, report the exact gap and evidence still available.
- Return a result per criterion and the independently selected scenarios that were tested, unsupported or blocked. A convincing explanation does not close an unverified check.
