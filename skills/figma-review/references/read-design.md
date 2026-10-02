## Reading a Figma design

**Default path: the Figma MCP tools directly.** In this order:

1. `get_metadata` on the file or frame URL, to locate the relevant nodes
2. `get_design_context` on each node, for structure, spacing, typography and layout
3. `get_design_context` on the **frame that contains** the node as well. The backdrop, scrim, overlay and page background belong to the frame, not to the component, and reading only the component silently drops them. This has already cost a missed defect
4. `get_screenshot` on each node, to keep a visual reference for the developer and the design review
5. `get_variable_defs` for the tokens actually used, so the code binds to design tokens instead of hardcoded values

When you return the extracted specs to the caller, make it an **exhaustive list of named values**, not a prose summary: colours with their opacity, blurs, radii, borders, shadows, font families, sizes, weights, line heights, paddings, gaps, dimensions, plus every interactive state the design provides. The design review builds its own inventory from Figma and uses your list only to reconcile afterwards, so a value you leave out is one you did not implement against, and the review will report it.

Use the available Figma tools directly. An additional design-to-code skill is optional; its absence does not replace a missing Figma source with a guess.

Read the design tokens before writing any style, and prefer the repository's existing tokens and components over reproducing raw values from Figma.

Record whether the design was fully read. A partially read design lowers the confidence of the design review and must be said out loud, never smoothed over.
