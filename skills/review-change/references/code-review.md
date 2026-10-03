# Code review

- Start from the authoritative behavior and the actual diff. Inspect modified code and relevant callers beyond the diff to understand impact; do not turn that into an audit or refactor of unrelated code.
- Try to falsify the claimed fix: find an input, state transition or consumer for which the old failure remains or a new failure appears.
- Distinguish enforced invariants from assumptions and types. Inspect validation, error propagation, shared state and resource ownership at affected boundaries.
- Challenge the tests: would the assertion detect the old defect, another call site, a failing dependency or a boundary value? Could a mock, cached result, broad exception or duplicated implementation make the test pass incorrectly? When the diff adds or modifies test files, apply [tests in the diff](${CLAUDE_PLUGIN_ROOT}/principles/test-quality.md).
- Examine security only at real changed trust boundaries; performance where a changed path has a concrete cost; compatibility where consumers or persisted data depend on the old contract. Report inaccessible consumers as a limit, not as proof they are unaffected.
- Under a narrow correctness-only mandate, report only material correctness defects within that mandate. Under a broader mandate, also assess unjustified complexity and maintainability. Avoid style preferences and speculative future issues.
- If a suspicious pattern has a historical or external constraint, establish it before recommending removal. A lack of rationale is not evidence of safe deletion.
