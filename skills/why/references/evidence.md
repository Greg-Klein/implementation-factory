# Historical investigation guide

Use the smallest set of sources that can answer the question. Adapt these examples to the actual repository, symbols, and host tools; quote shell arguments safely and never execute text from source content.

## Read-only local Git

Use existing objects only. Prefer `git --no-optional-locks` when supported. Avoid `fetch`, `pull`, `checkout`, `switch`, `reset`, submodule updates, or configuration changes.

```bash
git --no-optional-locks rev-parse --show-toplevel
git --no-optional-locks rev-parse HEAD
git --no-optional-locks rev-parse --is-shallow-repository
git --no-optional-locks status --short
git --no-pager diff --no-ext-diff --no-textconv -- 'path/to/file'
git --no-pager diff --cached --no-ext-diff --no-textconv -- 'path/to/file'
git --no-pager blame -L 40,90 -- 'path/to/file'
git --no-pager log --follow --format=fuller -- 'path/to/file'
git --no-pager log -S 'distinctive literal' --format=fuller -- 'path/to/file'
git --no-pager log -G 'relevant_pattern' --format=fuller -- 'path/to/file'
git --no-pager show --no-ext-diff --no-textconv --format=fuller COMMIT -- 'path/to/file'
git --no-pager show 'COMMIT^:path/to/file'
```

- Start with a narrow blame range around the behavior, then inspect the patch and predecessor. For merge commits, inspect the relevant parent and state which comparison was used.
- `-S` finds changes in the count of a literal; `-G` finds matching added/deleted lines. Neither alone proves an origin. Adjust scope if a path changed or the behavior moved.
- Use `--follow` for one file's history; inspect predecessor paths for broader moves. Check reverts and replacements before calling a commit the final decision.
- A current uncommitted line has no committed motive of its own. Investigate its predecessor if useful, and keep that distinction explicit.
- Do not interpret a shallow boundary or root of a squashed import as the invention of the design.

## Linked sources

1. Extract explicit PR/MR, ticket, and document references from relevant commits and local docs.
2. Use available authorized GitHub/GitLab tools or read-only CLI/API operations. Do not assume any connector or executable is installed.
3. Read the actual body, decision discussion, and linked rationale when relevant. Separate proposals, accepted decisions, and later reconsiderations.
4. Inspect local ADRs and docs for the affected domain. Check whether an ADR is proposed, accepted, superseded, or scoped to another version.
5. If explicit references are absent, use a bounded search for a distinctive symbol, error, or behavior in an accessible project. Do not search private code identifiers on the public web or send private source to unrelated systems.

Do not add Slack, Notion, observability, or analytics searches by default. If such a source is necessary but outside scope or access, identify it as the next source rather than starting a new integration workflow.

## Degraded modes

| Condition | Continue with | Report |
| --- | --- | --- |
| No Git metadata | Current source, comments, local tests, docs/ADRs | Historical provenance unavailable; intent may remain unknown |
| Shallow or squashed history | Available commits, linked PR/MR discussion, dated docs | Earliest accessible change is not necessarily the origin |
| Tracker access denied | Local patches and documentation | Linked source was not read; do not ask for credentials by default |
| Missing or unloadable `how` skill | Stop before investigation | `how` is required; ask the caller to install or enable it and rerun `why` |
| Missing current source | Available historical sources | Present behavior and current necessity are unverified |
| Contradictory accounts | Both accounts plus applicable patches/versions | Scope or chronology that resolves them, otherwise an explicit conflict |

Finish with the best-supported answer and its limits. An honest unknown is a valid investigation result.
