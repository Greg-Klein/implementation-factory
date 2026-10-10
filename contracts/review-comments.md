## Output format: Conventional Comments

Use the [conventional comments](https://conventionalcomments.org/) format for every finding. Each comment follows this structure:

```
**<label> (<decoration>):** `file:line` - <subject>

<discussion>
```

### Labels

| Label | Use for |
|---|---|
| `issue` | Bugs, security flaws, correctness problems: things that are broken or will break |
| `suggestion` | Improvements: simplify, rename, restructure. Always explain *what* and *why* |
| `nitpick` | Trivial preferences, always non-blocking |
| `question` | Something unclear or suspicious: you're not sure it's wrong but want to flag it |
| `todo` | Small necessary changes (missing cleanup, incomplete migration) |
| `praise` | Something genuinely well done. Be specific, not generic |
| `thought` | Ideas sparked by the review, non-blocking by nature |
| `chore` | Mechanical tasks before merge (update changelog, remove debug prints) |

### Decorations

- `(blocking)`: must be resolved before merge
- `(non-blocking)`: nice to have, author decides
- `(if-minor)`: resolve only if changes are trivial

### From a severity to a label

When the findings come from a review that grades them `P0`, `P1` or `P2`, the label and the decoration follow the severity:

| Severity | Label and decoration |
|---|---|
| `P0` | `issue (blocking)` |
| `P1` | `issue (blocking)` for a defect, `suggestion (blocking)` for a change that is needed without anything being broken, `todo (blocking)` for a small missing piece |
| `P2` | `suggestion (non-blocking)`, or `nitpick (non-blocking)` for a preference |

A finding that was dismissed or fixed during the review is not a comment: it goes in the section the caller's template gives it. `praise`, `question` and `thought` carry no severity.

### Examples

```
**issue (blocking):** `src/api/auth.py:42` - SQL query built with f-string

User input is interpolated directly into the query. Use parameterized queries instead.
```

```
**suggestion (non-blocking):** `src/services/processor.py:15-28` - This wrapper adds indirection without value

Inline the logic directly at the call site. Simpler to read and maintain.
```

```
**praise:** `src/utils/retry.py:10` - Clean exponential backoff with jitter

Simple, handles the real failure modes well.
```

## Verdict

The verdict follows what is left open: `needs rework` with a blocking comment, `minor changes` with only non-blocking ones, `ready to merge` with none or praise alone.

End with a **verdict**: `ready to merge` | `minor changes` | `needs rework`, with a 1-2 sentence summary and counts: `N blocking · N non-blocking · N nitpicks · N praise`.
