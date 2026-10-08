# Code review

- Start from the authoritative behavior and the actual diff. Inspect modified code and relevant callers beyond the diff to understand impact; do not turn that into an audit or refactor of unrelated code.
- Try to falsify the claimed fix: find an input, state transition or consumer for which the old failure remains or a new failure appears.
- Distinguish enforced invariants from assumptions and types. Inspect validation, error propagation, shared state and resource ownership at affected boundaries.
- Challenge the tests: would the assertion detect the old defect, another call site, a failing dependency or a boundary value? Could a mock, cached result, broad exception or duplicated implementation make the test pass incorrectly? When the diff adds or modifies test files, apply [tests in the diff](${CLAUDE_PLUGIN_ROOT}/principles/test-quality.md).
- Examine security only at real changed trust boundaries, with the [adversarial reading](#adversarial-reading) below; performance where a changed path has a concrete cost; compatibility where consumers or persisted data depend on the old contract. Report inaccessible consumers as a limit, not as proof they are unaffected.
- Under a narrow correctness-only mandate, report only material correctness defects within that mandate. Under a broader mandate, also assess unjustified complexity and maintainability. Avoid style preferences and speculative future issues.
- If a suspicious pattern has a historical or external constraint, establish it before recommending removal. A lack of rationale is not evidence of safe deletion.

## Adversarial reading

Run this second reading when the diff adds or changes code at a trust boundary: a request handler or route, a database query, a shell command or spawned process, a file path, an upload or a parser of outside content, a permission or ownership check, a token, session or cookie, rendered HTML, an outbound URL, a log line, a dependency. A diff that touches none of these gets no such reading: say so in one line of the review basis and move on.

Read the same lines as a caller who wants to do harm, whatever the mandate. An exploitable path is a correctness defect, so a narrow correctness-only mandate reports it too.

- List every value in the diff that someone outside the code controls: a request field, a header, a file name, file content, a stored value another user wrote, a forge or third-party answer.
- Follow each one to where it is used: query, command, path, markup, URL, log, deserialization. Read the callers and helpers on the way, not only the changed lines.
- At each arrival, name what stops the value from being turned against the system (a parameterized query, an allow-list, an escape, a resolved path checked against its root), or state that nothing does. A type, a client-side check or a comment stops nothing.
- For each resource the changed code reads or writes, check that access is decided against the caller, not only against the resource existing. Look at the neighbouring endpoints for the check this one should carry.
- Check what leaves: a secret, a token or personal data in a log, an error message, a response or a URL.
- For an added or upgraded dependency, state what it is given access to and whether the diff needs it.

A finding names the value the attacker controls, the path it takes through the current code and what the attacker obtains. Without all three it is not a finding: drop it, or record it as an unknown when a consumer you could not read decides it. Do not recite a checklist, and do not report a hardening that no reachable path calls for. Pre-existing weaknesses outside the changed path are a limit to mention, not a finding of this change.
