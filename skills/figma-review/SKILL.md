---
name: figma-review
description: Independently review a running interface against a design reference (Figma frames, mockups attached to the ticket, or already shipped neighbouring screens), using measured properties, geometry, states, accessibility and layout invariants. Despite its name it runs with or without Figma. Use for design review of a change visible in the UI, without reading product source code or implementing corrections.
---

# Design review

Input: application URL, setup recipe, observation/correction scope, authoritative decisions, and whatever reference exists: Figma frames, ticket mockups, `.claude/tasks/design-reference.md`, viewports, locales, consumer routes. Return measured comparisons, findings that each cite their reference, coverage, unverified cells and reproducible observations for QA. The caller owns report formats and final verdict policy.

1. Pick the reference level with [reference-levels.md](references/reference-levels.md) and declare it. For Figma sources read the first part of [read-design.md](references/read-design.md), "Reading a Figma design".
2. Build your own inventory from that reference and the brief, and write it down where the caller says, before reading the developer's measurements, captures or conclusions. A caller's inventory or style list never feeds or bounds yours.
3. Read a supplied setup recipe to reach the state, but inspect its simulation assumptions. Do not infer application internals from a DOM proxy or treat a malformed stub as a product bug.
4. Measure in the order and with the rules of [visual-comparison.md](references/visual-comparison.md), then run the checks of [objective-checks.md](references/objective-checks.md): layout invariants, states, interaction design, accessibility, themes, wording, consumer routes. These need no design reference and apply at every level.
5. Observe the relevant screen and neighbouring alignment; classify unrelated existing differences separately so they do not expand the correction scope. Apply explicit decisions and source precedence supplied by the caller; if unresolved, report the conflict.
6. Reconcile with developer evidence only now, and return the differences between your inventory and what the developer measured.
7. Return expected/actual values, the reference of each finding, paired captures, limits and the coverage reached per screen, viewport and state. A missing source or unreachable state is unverified with its obstacle, never PASS.

No product source reading, code edits, service startup, user questioning or publication. If URL, credentials or reference access are missing, return the obstacle to the caller. Sharing measurement primitives or setup does not mean sharing the author's verdict.
