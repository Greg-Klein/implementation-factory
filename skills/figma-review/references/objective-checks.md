# Objective checks

These checks need no design reference and run at every level, on the surface the ticket modifies. Each has a measurable pass condition, so a failure cites the check itself and can be P1. Collect each check in one `browser_evaluate` that returns the whole table.

## Viewports and content

- Required widths: the ones the brief names, else 360, 768 and 1280, plus the exact width of every supplied frame.
- Stressed content, for each text zone or list the change touches: the longest plausible value, an empty value, and zero, one and many items. Produce it through the recipe. When the recipe gives no way to produce the data, the cell is not reached, with that obstacle. Never build a stub of your own to force it.

## Layout invariants

At every required width, with normal then stressed content:

- no horizontal page scroll (`document.documentElement.scrollWidth` equals `clientWidth`)
- no text container with `scrollWidth > clientWidth` or `scrollHeight > clientHeight` unless it shows an ellipsis or a scroll affordance, and a truncated text keeps its full value reachable
- no child rect outside its parent's rect, no element outside the viewport without a scroll that reaches it
- no overlapping rects between siblings that are not layered on purpose

## State matrix

For each interactive element the ticket modifies: rest, hover, keyboard focus, active, disabled, loading, empty, error. Each cell is `conforme`, `différent`, `absent de l'implémentation`, `non atteint` with its obstacle, or `sans objet` with the reason the element cannot take that state.

- Reach hover with `browser_hover`, focus with `browser_press_key` Tab, the others through the recipe.
- Read the computed style at rest and in the state. A hover, focus or active state whose computed style and geometry equal rest gives no visual feedback: that is a finding at any level.
- With a reference, compare the state with what it draws. Without one, compare with the same state of the same kind of element on a neighbour screen.

## Interaction design

You own what is measurable in the browser, with severity:

- visual feedback after an action (the control or the screen changes within the interaction)
- focus kept on a sensible element after an action, and restored to the trigger when an overlay closes (`document.activeElement`)
- layout stability on load: rects of the visible elements read at first paint and after loading do not shift

Whether the action did the right thing is functional correctness and belongs to QA: write it under "À vérifier par la QA" with the exact steps, no severity.

## Accessibility

Measured, on the modified surface only:

- Contrast: compute the ratio from the computed text and effective background colours. 4.5 for text, 3 for large text (24 px, or 18.66 px bold) and for the boundary of controls and focus indicators (WCAG AA).
- Keyboard: Tab from before the surface until focus leaves it. Every interactive element is reached, in reading order, with no trap. Each stop shows a focus indicator, measured as a computed difference (outline, box-shadow, border or background) from the unfocused style.
- Semantics: in `browser_snapshot`, every interactive element has a role matching its behaviour and a non-empty accessible name; images that carry meaning have a name.
- Target size: at least 24 by 24 CSS px, measured on the clickable rect.

When the reference itself draws a value under a threshold, the implementation that follows it is not a developer defect. Report it under "Conflits à arbitrer" with both values; the caller's specification policy decides.

## Themes and motion

Detect support before testing: with `browser_emulate_media`, switch `colorScheme` to dark and compare the computed page background and text colour with light; in the same `browser_evaluate`, look for `prefers-color-scheme` and `prefers-reduced-motion` media rules in the readable `document.styleSheets`. A theme toggle named by the brief also counts.

- Dark theme supported: replay contrast and the paired captures at the smallest and largest required widths.
- Reduced motion supported: with `reducedMotion` set to reduce, a modified element that still animates or transitions is a finding.
- Not supported: say so in the method section. It is not a finding.

## Wording

For each text node of the inventory, compare the reference string with the rendered `textContent`: strict equality after trimming, case and punctuation included. At `live-neighbours` there is no reference string; check only the items below.

- For each delivered locale the brief names, switch to it and check that every string of the surface is in that language and none is left untranslated or shows a raw key.
- A string the reference does not give is unverified, not a pass.

## Consumer routes

When the brief lists routes that consume shared components the diff modifies, open each one, capture it at the smallest and largest required widths, run the layout invariants and check the shared component against the reference level. The list bounds this check: add no route of your own. Without a list, record the check as not requested.
