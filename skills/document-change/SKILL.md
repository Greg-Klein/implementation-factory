---
name: document-change
description: Update repository documentation made stale by an authorized code change, covering decisions, contracts, configuration and the behavior actually shipped. Use when a change affects existing documentation or introduces a mechanism that needs a documented home.
---

# Document a change

Input: actual change, repository documentation and permitted file scope. Output: targeted documentation updates, or a list for the caller when writing is not authorized.

1. Find the existing home: README, architecture and feature pages, indexes, configuration examples or changelog. Read neighboring documentation before choosing format and depth.
2. Identify statements the change makes false or incomplete: state ownership, lifecycle, contracts, routes, settings, installation or operation. Update existing pages before creating a new one.
3. Explain consequential decisions and non-obvious constraints. Describe only what has shipped; distinguish a partial feature from future work. Link to code for implementation details instead of copying code that will drift.
4. Match the repository's language, structure and level of detail. Write the prose with `implementation-harness:unslop`. When a new page is necessary, connect it to an existing index. Keep changes within the caller's file ownership; return missing scope to the planner or pilot.
5. Check references and examples against the changed code. Do not claim commands or examples were executed unless they were. Exclude secrets, runtime ticket content and private session links.

Inline comments are for a non-obvious reason a competent reader could otherwise get wrong. Prefer clear code over comments describing what it already says; follow the repository's documentation conventions.
