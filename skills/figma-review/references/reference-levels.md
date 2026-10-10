# Reference levels

A finding without a reference is taste. Use the highest level the brief supports, name it at the top of the report and build the inventory from it. Levels combine downwards: a property the higher level leaves open is judged at the next one, and the row says which. With a mockup (`figma` or `ticket-mockup`) the caller starts this review on any change visible in the UI. With no mockup at all it starts it only when the diff modifies a shared UI component or creates a screen or route.

## `figma`

Frames are supplied and readable. Read them with [read-design.md](read-design.md) and compare with [visual-comparison.md](visual-comparison.md). Full severity scale.

## `ticket-mockup`

No Figma, but mockups or captures attached to the ticket (paths under `.claude/tasks/assets/`). An image carries no numbers.

- Inventory: every element, text string and state the image shows, with its position in the composition.
- Compare composition at the image's width: presence, order, grouping, alignment, relative proportions, wording.
- A difference established from the image alone is P2 at most and is reported as "à confirmer". It becomes P1 or P0 only when a check of [objective-checks.md](objective-checks.md) also fails on the same element, and it then cites that check.
- Never read a pixel value off an image and report it as measured.

## `live-neighbours`

No design at all, or properties the design leaves open. The reference is what the application already ships.

- Read `.claude/tasks/design-reference.md` when the pilot supplies it (tokens, brand rules, component library). It is the only access you have to the repository's conventions; never open source to complete it.
- Pick 2 or 3 already shipped screens that use the same kind of elements (the brief's suggestions first, else the closest in navigation). Never use a screen the ticket modifies as its own reference.
- In one `browser_evaluate` per screen, read the custom properties on `:root` and, for each kind of element the change uses (button, field, heading, body text, card, list row), its computed font, sizes, radius, padding, gaps, colours and border.
- Inventory: every element of the changed surface, with the neighbour value or token it should match.
- A value is a reference only when the supplied document states it or the measured neighbours agree on it. A deviation from it is P1 at most. Neighbours that disagree with each other give no reference: the row is unverified, and what you noticed goes to "Observations sans référence".

## Citing the reference

Every finding names what it was judged against: a Figma node, a mockup file, the neighbour screen and value measured, a token of `design-reference.md`, a WCAG threshold or a named invariant. A remark you cannot tie to one of these goes to "Observations sans référence", which is non blocking and holds three lines at most.
