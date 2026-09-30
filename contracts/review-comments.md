## Output format — Conventional Comments

Use the [conventional comments](https://conventionalcomments.org/) format for every finding. Each comment follows this structure:

```
**<label> (<decoration>):** `file:line` — <subject>

<discussion>
```

### Labels

| Label | Use for |
|---|---|
| `issue` | Bugs, security flaws, correctness problems — things that are broken or will break |
| `suggestion` | Improvements: simplify, rename, restructure. Always explain *what* and *why* |
| `nitpick` | Trivial preferences — always non-blocking |
| `question` | Something unclear or suspicious — you're not sure it's wrong but want to flag it |
| `todo` | Small necessary changes (missing cleanup, incomplete migration) |
| `praise` | Something genuinely well done — be specific, not generic |
| `thought` | Ideas sparked by the review — non-blocking by nature |
| `chore` | Mechanical tasks before merge (update changelog, remove debug prints) |

### Decorations

- `(blocking)` — must be resolved before merge
- `(non-blocking)` — nice to have, author decides
- `(if-minor)` — resolve only if changes are trivial

### Examples

```
**issue (blocking):** `src/api/auth.py:42` — SQL query built with f-string

User input is interpolated directly into the query. Use parameterized queries instead.
```

```
**suggestion (non-blocking):** `src/services/processor.py:15-28` — This wrapper adds indirection without value

Inline the logic directly at the call site. Simpler to read and maintain.
```

```
**praise:** `src/utils/retry.py:10` — Clean exponential backoff with jitter

Simple, handles the real failure modes well.
```

## Verdict

End with a **verdict**: `ship it` | `minor changes` | `needs rework` — with a 1-2 sentence summary and counts: `N blocking · N non-blocking · N nitpicks · N praise`.
