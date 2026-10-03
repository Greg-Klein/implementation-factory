# Tests in the diff

Read this only when the diff adds or modifies test files.

For each added or changed test, ask one question: would it still pass if every function it imports returned `undefined`? A test that would observes no behavior and cannot fail for a defect. Five shapes answer yes:

- **Weak assertion.** No assertion at all, or only that a value exists, is truthy, has a type, is greater than zero, or that nothing was thrown.
- **Mock or absence only.** Only that a mock was called or not called, or that a result is empty or undefined.
- **Self-referential.** The expected value comes from the code under test: `expect(f(a)).toBe(f(a))`, an expected URL built with the helper being tested.
- **Constant pin.** The assertion restates a hand-maintained constant, a default, a table row or a string the code contains.
- **Fixture asserts fixture.** The assertion reads data the test built itself, and the subject never runs in the test body.

What a sound test does instead: call the subject in the test body with one concrete input, and assert the literal output or the observable effect. For an absence, the same test also asserts the presence on the other input. For a mock, assert the payload it received or the state after the call. For a constant, test the mechanism that reads it.

A relation checked across the rows of a table (a key present in two tables, a parent that exists) and a compile-time type test are sound as they are.

As an author, rewrite the assertion, or delete the test when no such assertion exists. As a reviewer, a new test in one of the five shapes that is the only cover of an acceptance criterion or of the fixed defect is a `P1`; elsewhere it is a `P2`.
