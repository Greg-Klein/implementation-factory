# Visual comparison

## Four failure modes that make this review worthless

All four have happened. Read them before starting.

### 1. Judging by eye instead of measuring

"Visually consistent with the reference" is not a review, it is an impression. A backdrop was once passed that way while being white at 70% opacity where the design said mid-grey at 55%.

- **Every visual claim is a measured value against a reference value.** Read the actual value from the live DOM with `getComputedStyle` through `browser_evaluate`, and the expected value from the reference level (at `figma`, `get_design_context` / `get_variable_defs`). Report both side by side.
- **Never conclude PASS because you lack a reference value.** At `figma` a missing value means you have not finished reading the frame, parent frame included. At the other levels the row is unverified.
- **Values are not positions.** Matching every colour, radius, padding and font metric proves nothing about where elements land. Also compare the rendered geometry: alignment between neighbours, vertical centring within a row, baselines, equal gaps, and what changes between the required viewports. A pass once matched every declared value on a modal whose checkbox sat at the top of a row the design centres.
- **The backdrop, overlay, scrim and shadow belong to the frame around the component, not to the component node.** Read the parent frame too.
- Any brief or summary handed to you is a convenience, never the source of truth. The reference is.

### 2. Reviewing behaviour instead of design

You inspect through the browser, so you can observe behaviour, but you have **no access to the code and no way to know what state the app is really in**. A review once filed three blocking findings claiming an interception was broken; every one was false, because the indicator it probed disappears earlier than the state it stood for.

- **You never file a finding with a severity about functional correctness.** That is QA's job, and QA has the code. Your severities cover visual deviations and the interaction design defined in [objective-checks.md](objective-checks.md).
- A behaviour that looks wrong goes under "À vérifier par la QA", as an observation with the exact steps you ran.
- Before writing even an observation, say what you used as a proxy for the app's state. A DOM element taken as a proxy for an internal state is a guess.
- **Reach the state through `.claude/tasks/browser-recipe.md`, never through a stub of your own making.** The recipe says how to get there, not what you should see, so it costs you no independence. Without a recipe, say so in your method and treat anything odd you then see as an artefact of your setup: a review once filed an observation on a crash its own malformed payload had caused, and QA spent a round proving it.

### 3. Reviewing the ticket's diff instead of the screen

A composer review once measured the two new chips to the pixel and wrote the send button, the question field and the header off as "pre-existing, out of scope". The designer then filed eleven comments on that same screen, none of which had been measured.

- **The observation scope is the whole screen the reference shows; the correction scope remains the authorized change.** Every element the frame draws gets an inventory row, the ones the ticket touches and the ones it does not.
- A deviation on an element the ticket does not touch is still a finding. It goes into "Écarts préexistants" with its severity, so it is reported without being routed to this ticket's developer.
- **Elements that sit on one row are measured against each other**: height, radius, icon size and stroke. A difference the reference does not draw is a finding citing the sibling as reference; one the reference draws is conforming.

### 4. Accepting a deviation on the design's behalf

The same run kept a 36×36 remove cross where the frame drew 24×24, called it an accepted touch target, and the next round used that decision to excuse a truncated filename. A 40 px frame height measured at 36.89 px was downgraded to P2 because the component set disagreed with the frame.

- **You never accept, excuse or rationalise a deviation.** A repository idiom, a component set that disagrees, "the mockup understates it": none of these turns a measured difference into a pass. Report the fail and state the argument next to it. A deviation is waived only by an explicit authoritative decision supplied by the caller.
- An accessibility threshold does not excuse a deviation either, and a reference does not excuse a failed threshold. When the two disagree, report both values under "Conflits à arbitrer".
- **When two Figma sources disagree, the instance in the frame wins** over the component set, and the gap between them goes under "Conflits à arbitrer".
- A finding you reported in an earlier round stays open until it is fixed or waived by name.

## Order of the pass

The caller stops a review that runs long. Work by decreasing risk, and after each step overwrite the report and the staged evidence with everything measured so far, so a stop leaves a usable result.

1. Whole composition at each required viewport: a live capture at the exact width beside the reference capture, checking the vertical distribution of every block before any single value.
2. Elements the ticket touches, in every required state.
3. Layout invariants, accessibility, wording, themes and consumer routes ([objective-checks.md](objective-checks.md)).
4. Pre-existing neighbours on the same screen, with the remaining budget.

## Building the inventory at `figma`

- **Inventory every node the frame draws** with `get_metadata` before extracting anything. A node with no row means the review is not finished. When a frame is too large for one call, read its children node by node; never substitute the component set for a frame you could not read.
- For every node record: box (width, height), radius, insets to the four inner edges of its container and gaps to neighbours, text position and string, icon glyph, frame size and stroke weight, the visible footprint of a control at rest and on hover, and every state the design provides.
- Repeat for **each supplied frame width**: paddings, heights and layout are read from the frame of that width, never inferred from another one.
- Pull tokens with `get_variable_defs`, so you compare against token values rather than approximations.
- What the design does not specify is recorded as "not specified in the design" and judged at the next reference level, never passed.

The other levels build their inventory as [reference-levels.md](reference-levels.md) says.

## Measuring

- **Batch.** One `browser_evaluate` per screen, viewport and state returns the whole table (computed styles and `getBoundingClientRect` of every inventory row, relative to its container). Not one call per property.
- A capture comparison alone never closes a property. Colours and opacities in particular are unreliable by eye against a pale background.
- **Icon strokes are measured.** The rendered stroke of an SVG icon is its `stroke-width` times the rendered size divided by the `viewBox` size (a 24 viewBox at 2 drawn at 16 px gives 1.33 px). An icon of the right size and colour with a thinner stroke is a fail.
- **Paired captures.** For every screen, viewport and state you measure, keep one live capture and one reference capture (Figma `get_screenshot`, the mockup file, or the neighbour screen). Without the pair the cell is not measured.
- Name findings by screen and visual location, never by file path or component name.

## Severity

- P0: blocking. A major visual or interaction-design mismatch with the reference, or an objective check that makes the screen unusable (content unreachable, control not operable by keyboard).
- P1: important. A deviation a person can see side by side: a size, radius, inset, gap or padding off by 2 px or more, a stroke weight off, a different glyph or string, a text block in the wrong column or at the wrong height, a sibling of a different height, a failed objective check.
- P2: minor. What cannot be seen at 1× without a measurement: sub-pixel differences from font metrics, a 1 px border counted inside or outside the box.

P2 findings are dropped from the rework brief and never fixed, so a P2 is a deviation you accept to ship. Every design P2 of past runs came back as a designer comment.

- The 2 px rule applies to values the reference fixes. A dimension that derives from content or viewport (an auto width or height, a fluid container, a text box sized by its font) is compared only when the reference fixes it; otherwise judge the paddings, gaps and alignment around it.
- The caps of the reference level apply: an image alone gives P2, a neighbour value gives P1 at most.
- A deviation on an element the ticket does not touch gets the same severity and goes into "Écarts préexistants".
