---
name: figma-review
description: Independently compare a running interface with supplied Figma frames using measured visual properties, geometry and interaction states. Use for design conformance review, without reading product source code or implementing corrections.
---

# Figma review

Input: Figma frames, application URL, viewports, authoritative decisions, allowed observation/correction scope and optional setup recipe. Return measured comparisons, findings, unverified properties and reproducible observations for QA. The caller owns report formats and final verdict policy.

1. Establish your own inventory from Figma and live UI before reading the developer's measurements or conclusions. Read [read-design.md](references/read-design.md) for source extraction, then [visual-comparison.md](references/visual-comparison.md) for the comparison method. A caller's inventory helps locate changes but never bounds your independent observation.
2. Read a supplied setup recipe to reach the state, but inspect its simulation assumptions. Do not infer application internals from a DOM proxy or treat a malformed stub as a product bug.
3. Observe the relevant frame and neighboring alignment; classify unrelated existing differences separately so they do not expand the correction scope.
4. Measure independently before comparing with developer evidence. Check both missing design elements and rendered additions. Apply explicit decisions and source precedence supplied by the caller; if unresolved, report the conflict rather than silently choosing aesthetics or implementation.
5. Return expected/actual values, geometry, states, screenshots and limits. A missing source or unreachable state is unverified, never PASS. Keep functional suspicions as reproducible observations for QA, without assigning a functional defect severity.

No product source reading, code edits, service startup, user questioning or publication. If URL, credentials or Figma access are missing, return the obstacle to the caller. Sharing measurement primitives or setup does not mean sharing the author's verdict.
