# Implementation Factory brand book

This document describes the visual identity and the tone of the application: web console and icon. It describes what exists in the code. When a screen departs from it, fix the screen or update this document in the same commit, never one without the other.

The interface is in English. Labels and messages are quoted here as they appear on screen.

![Sheet of colours and styles, light theme](brand-sheet.png)

![Sheet of colours and styles, dark theme](brand-sheet-dark.png)

Both sheets are generated from the tokens of `globals.css` and the Tailwind palette: after a style change, run `node scripts/render-brand-sheet.mjs` again from `console/` (source: `brand/sheet.html`).

The sources of truth stay in the code:

- colour tokens and shared classes: `console/app/globals.css`
- fonts: `console/app/layout.tsx`
- icon: `brand/icon.svg`

## Intent

The interface stays calm. The application watches long sessions that take decisions in someone's code: it has to inspire trust, read fast and draw attention only when a human decision is expected.

- **Paper and ink.** Slightly warm backgrounds, near-black text, a single accent colour.
- **Green means it is moving**, amber means it is your turn, red means it broke. No other colour carries meaning.
- **Dense but airy.** A lot of information in small sizes, balanced by generous margins and thin separators.
- **Nothing decorative.** No gradient, no illustration, no emoji in the interface.
- **Two themes, one identity.** The console follows the system preference (`prefers-color-scheme`) until the theme button is clicked; after that it keeps that choice (`impl.theme` in local storage). The theme is set as a `data-theme` attribute on `<html>` before the first paint, so the light theme never flashes. The dark theme keeps the same identity: very dark green backgrounds, light ink, an accent lightened to stay readable. No component picks its colour from the theme, only the tokens change.

## Icon

A very dark green rounded square, a command prompt chevron followed by a cursor, and a light green dot at the top right: the terminal, and a signal that says something is running.

| Element | Value |
|---|---|
| Background | `#1c3029`, radius 194 out of 864 (about 22%) |
| Chevron and cursor | `#e9eee5`, stroke 64, rounded caps and joins |
| Status dot | `#88ad8e` |

In the application, the mark is a `size-8` square with an `--ink` background and the Phosphor `Code` icon in `--on-ink`, `bold` weight: a dark square in the light theme, a light one in the dark theme. Do not recolour the icon, do not put a frame around it, do not use it on a green background.

## Colours

### Tokens

Always go through the CSS variables (`bg-[var(--accent)]`), never through a copied value: no `bg-white`, no `text-white` and no hex code in a component, otherwise it stays light in the dark theme.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#f3f4ef` | `#101412` | Page background, side columns, window footers |
| `--surface` | `#fafbf7` | `#151917` | Main content area, cards set on `--paper` |
| `--raised` | `#ffffff` | `#1c211e` | Input fields, secondary buttons, cards, selected row, document window |
| `--sunken` | `#f1f3ee` | `#121614` | Recessed areas: code blocks, composer, tab rail, queue |
| `--backdrop` | `#eceee8` | `#0d100f` | Background behind the launch form |
| `--tint` | `#f7f8f4` | `#181c1a` | Agents column, light hover |
| `--ink` | `#1c211f` | `#e2e7e2` | Text, mark, dark buttons (light in the dark theme) |
| `--ink-hover` | `#2a322e` | `#c5ccc6` | Hover of an `--ink` button |
| `--on-ink` | `#ffffff` | `#111513` | Text and icon set on `--ink` |
| `--tab-selected` | `#1c211f` | `#2a4639` | Pill of the active tab (run view) |
| `--on-tab-selected` | `#ffffff` | `#d6eadd` | Label of the active tab |
| `--callout` | `#eef2ec` | `#1f2824` | Question card set in the conversation, lighter than the background in the dark theme to stand out |
| `--callout-line` | `#d8dcd5` | `#3a4640` | Border of that card |
| `--muted` | `#707873` | `#949c97` | Secondary text, help, inactive labels |
| `--faint` | `#7c847f` | `#737b76` | Background mentions (signature, action in progress of a message) |
| `--line` | `#d8dcd5` | `#2a312d` | Borders, separators, track of a step not reached |
| `--line-strong` | `#b9bfb8` | `#46504a` | Circle of a task to do, hover of an option, switch turned off |
| `--accent` | `#477a62` | `#7fb096` | Main action, progress, focus, link |
| `--on-accent` | `#ffffff` | `#0f1512` | Text and icon set on `--accent` |
| `--accent-soft` | `#dce9e0` | `#1e3028` | Background of a selected element, focus halo, "running" pill |
| `--accent-strong` | `#2f5546` | `#b3d3c1` | Text set on `--accent-soft` (notification banner) |
| `--doc` | `#3f6d8a` | `#85afc9` | Everything that names a document produced by the workflow |
| `--selection` | `#b8d3c3` | `#2e4a3c` | Text selection |
| `--highlight` | white at 80% | white at 4% | Inner highlight at the top of the launch form |
| `--terminal` | `#191d1b` | `#191d1b` | Terminal background, the same in both themes |

`--raised` is the lightest surface in the light theme and the highest in the dark theme: it is what makes a field or a secondary button stand out from the paper.

### Statuses

The statuses use the Tailwind palette, always as a pair of light background and dark text. In the dark theme, `globals.css` inverts the shades used (`amber-50` becomes a dark amber background, `amber-800` a light amber text, the same for `red` and `emerald`): the pairs stay the same classes and stay readable. A new shade used in a component has to be added to this inversion.

| Meaning | Background | Text | Border | Examples |
|---|---|---|---|---|
| Progress, success | `--accent-soft` or `emerald-50` | `--accent` or `emerald-700` | | "Running", step done, "Completed" |
| Decision expected | `amber-50` / `amber-100` | `amber-800` / `amber-900` | `amber-200` | "Your turn" (only for a question or an input expected in the terminal), "No next step" (the run has no next action, and no question was asked), warning |
| Error | `red-50` | `red-700` / `red-800` | `red-200` | Launch refused, invalid field, "Error", "Interrupted" (lost session, distinct from a workflow error) |
| Neutral, stopped | `--line` | `--muted` | | "Stopped" |

A status colour never stands alone: it comes with a label and, for attention and error, an icon (`Warning`, `WarningCircle`).

## Typography

| Role | Font | Size and weight |
|---|---|---|
| Page title | Geist Sans | `text-2xl`, `font-semibold`, `tracking-tight` |
| Field label, section title | Geist Sans | `text-sm`, `font-medium` |
| Body text, help, button | Geist Sans | `text-xs` (12 px), help in `--muted` with `leading-relaxed` |
| Metadata, counters, pills | Geist Sans or Mono | `text-[11px]`, `text-[10px]`, `text-[9px]` |
| Overline | Geist Sans | `text-[10px]`, `uppercase`, `tracking-[.16em]`, `--muted` |
| Paths, commands, identifiers, prompts, numbers | Geist Mono | `font-mono`, `text-xs` |

The hierarchy relies on weight and colour more than on size: panels stay between 9 and 15 px, `text-2xl` is reserved for the title of a window. Everything that gets copied into a terminal (path, branch, URL, command) is in mono.

## Shapes, spacing and depth

- **Radii.** `rounded-lg` for buttons, alerts and navigation items; 10 px for fields (`.field`); 11 px for the run action buttons; `rounded-full` for pills, counters and switches; `rounded-md` for small icon targets.
- **Borders.** 1 px `--line`. An `--accent` border signals focus or selection, never decoration.
- **Spacing.** Tailwind 4 px grid. Sections separated by `border-t` `--line` and `pt-6`, window margins `px-7 py-8`.
- **Shadows.** Rare, long and diffuse, tinted with dark green (`rgba(30,42,35,…)`) with a negative vertical offset. They are for floating elements (dialog, overlaid panel), not for cards.

## Components

- **Field.** Class `.field`. `--raised` background, `--line` border, 12 × 14 px of inner padding; on focus, `--accent` border and a 2 px `--accent-soft` halo. Disabled: `opacity-60`.
- **Secondary button.** `--raised` background, `--line` border, `text-xs font-medium`, `px-3.5 py-2`, `--paper` on hover.
- **Primary button.** `--accent` background and border, `--on-accent` text. One per action area, always on the right.
- **Run action button.** `--ink` background, `--on-ink` text, 11 px radius. Reserved for the gestures that move a run forward: launching it, answering a question, sending an instruction.
- **Header buttons.** At the top right, `size-7` squares, `rounded-lg`, `--line` border, 14 px icon. The theme (icon of the theme it switches to: `Moon` in light, `Sun` in dark, `--muted`) then the sound (`--accent` on, `--muted` off). Each is a `role="switch"` with an accessible label and a tooltip that says the state and the effect of the click.
- **Switch.** 44 × 24 px track, `--accent` on, `--line-strong` off, white knob.
- **Alert.** `rounded-lg`, border and background of the status colour, icon on the left, recovery action underlined under the text.
- **Status pill.** `rounded-full`, `px-2 py-1`, `text-[10px] font-semibold`, background and text pair of the status.
- **Side navigation.** Active item with `--accent-soft` background and `--accent` text, inactive in `--muted` with `--raised` at 60% on hover.
- **Agent.** Round photo (`public/avatars/`, `object-cover`) tied to its first name, followed by "First name · Role", the first name in `--ink`, the separator and the role in `--muted`. Without a photo, the initial on an `--accent-soft` background. These are the only images of people in the interface: they tell apart the agents of one run, they do not decorate.
- **Task card (Tracking).** `--raised` background, `--line` border, `rounded-lg`, set on a `--paper` column. Empty circle to do, amber ring in progress, `--on-accent` check on `--accent` done; complexity and identifier in mono `--muted`.
- **Task detail (Tracking).** A click on a card opens a window of 560 px at most, `--surface` background on the dialog veil. At the top, the status mark, the title, then identifier, status, complexity and agent in `text-[10px]`. The body stays short: the summary of the task (the `summary` of the plan, or failing that the first sentence of its description), then, folded under "Detail for the developer" on a `--paper` background, the full description in short paragraphs, the files in mono, the criteria covered and the dependencies as `--paper` pills. Paths and identifiers are in code (`--accent-soft`, mono), even when the plan wrote them without backticks. The verification steps and the text of the criteria stay in the plan. Escape, the backdrop or "Close" close it, and the focus returns to the card.
- **Acceptance criterion (Evidence).** Expandable row, identifier in mono `--muted`, text in `--ink`, state pill on the right. Verified in `emerald`, failed in `red`, blocked in `amber` (someone has to act), unverified with a `--line` background and `--ink` text instead of `--muted`, to stay readable: an unverified criterion is never green. Reservations about a piece of evidence ("Old evidence", "Unknown version", "Inconclusive measurement") are small `amber-50` pills, neutral mentions ("Reported result", "Confirmation", "Break attempt") are `--paper` pills. Under the evidence of a criterion, the break attempts that found no defect are listed separately, after a help sentence in `text-[11px]` `--muted` saying they do not count as a verification. Their pill is neutral, `--paper` background and `--muted` text: "No defect found", "Read, not executed" or "Not executed". An attempt that passes is never green. Only "Defect found" takes a colour, `red`.
- **QA verdict (Evidence).** Status pill in the summary of the tab, after "QA verdict", the round and the mandate if there is one, and next to the title of the report in "Reports by source". "Passed" in `emerald`, "Passed with warnings" in `amber`, "Inconclusive" with a `--line` background and `--ink` text, "Failed" in `red`. A status the contract does not know is shown as is, in mono `text-[10px]` `--muted`. When the verdict contradicts the evidence, a warning follows: `rounded-lg`, `amber-200` border, `amber-50` background, `amber-900` text in `text-[11px]`, `WarningCircle` `fill` icon on the left. The remarks on the order of the review plans are plain `text-[11px]` `--muted` lines under the summary, with no background and no border.
- **Incident banner (run view).** Under the tabs, full width, background and bottom border of the status colour: `amber` for a wait, a doubt or an incident that can still be handled, `red` for an interrupted session. `fill` icon on the left (`Warning`, `WarningCircle`, `HourglassMedium` for a doubt), factual title in `font-semibold`, cause in one sentence, "Next action expected", then only the possible actions: "Ask to continue" as a run action button, the others as secondary buttons. The diagnosis stays folded. In the list of runs, the same information fits in the third line of the row, icon and label in the status colour. The text of the error is not repeated in the right column when the banner already says it. An archived run has no session any more: its duration stops at its last known event, and its empty conversation does not point to the terminal.
- **Worktree (run view).** Under the progress, two lines "Repository" and "Worktree": label in `text-[10px] font-semibold` `--muted`, value in mono `text-[10px]`. The active worktree shows its path from the repository in `--ink`; once the session is gone, the line says why it stays ("Worktree kept: unpushed changes") or "Worktree removed", in `--muted`. The "Remove the worktree" action is a header button of the run, `FolderDashed` icon, `--muted` text, offered only when the worktree is still on disk and its session closed. If work is neither committed nor pushed, an `amber` banner shaped like the incident banner says what would be lost and offers "Remove anyway" and "Cancel"; the branch is never deleted, and the text says so. In the list, these runs without a session are grouped under "Kept worktrees", with the `FolderDashed` icon and the reason in `--muted`.
- **Row of the list of runs.** On the left, a dot in the status colour, which breathes while the run is running. A finished run replaces this dot with a `CheckCircle` `fill` check in `--accent`, and its third line says "Completed" in `--accent` in place of the last action: green alone also means a run in progress, the shape is what tells them apart.
- **Coverage in the list of runs.** At the end of the third line, "verified/total AC" in mono `text-[9px] font-semibold`, text only, in the colour of the worst remaining state (`red-700` for a failure, `amber-800` for a block, `--accent` when everything is verified, `--muted` otherwise). The detail goes in the accessible label and the tooltip. Nothing without a register of criteria.
- **Tokens of a run.** In the list, at the end of the third line and before the coverage, the total in mono `text-[9px]` `--muted` ("3.36 M", "412 k"), the exact number in the tooltip. In the progress of the run, under the duration: label "Tokens" in `text-[10px] font-semibold` `--muted`, total in mono `text-[10px]` `--ink`, then a `--muted` line that gives the pilot's share, its number of calls and the number of agents. The figure moves during the run, with no animation and no announcement: it is there to be read, not to alert. The tokens count the cache, read and written.
- **Runtime recipe.** A text link "Runtime recipe" in `--muted`, underlined in `--line`, `--ink` on hover: under the "Repository" value of a run (`text-[10px]`) and under the directory field of the launch form once it holds an absolute path (`text-[11px]`). It opens a window of 760 px at most on the dialog veil: title and repository path in mono `text-[10px]` `--muted`, the recipe as mono `text-[11px]` on `--raised`, and a footer with one help sentence on the left and the secondary button "Forget the recipe" (`Trash`) on the right, shown only when a recipe exists. Without one the body says so in one sentence. Under the recipe, after a `--line` rule, the review findings kept for the repository: the overline "Review findings", a `text-[11px]` `--muted` sentence with the count of findings and tickets, and the secondary button "Forget the findings" (`Trash`) on its right, shown only when some are kept. Then each kind that recurs: its label in `text-xs font-semibold`, its key and counts in mono `text-[10px]` `--muted`, and up to three examples in `text-[11px]`, severity and file in mono `--muted` before the sentence. The demonstration has no link.
- **Metrics.** Header button of the list of runs, `ChartBar` icon, to the left of "New run"; active, it takes the `--accent-soft` background and the `--accent` text. The view replaces the run view: a section title, a help sentence, then four medians (overline, value in mono `text-sm`) that appear only from three delivered runs. Below, a table, no chart: one row per run, headers in `text-[10px]` `--muted` with a tooltip that defines the column, numbers in mono `text-[10px]` aligned right, an empty cell when the data is missing. The number of reworks turns `amber-800` `font-semibold` as soon as it is not zero. The outcome is a status pill: `emerald` for a delivered run, `red` for an error, neutral for a stop, `--accent-soft` while it runs. The `CaretRight` chevron opens the detail on a `--sunken` background: tokens per session, time per wait and per phase, review.
- **Tickets field (launch).** `.field` text area that grows from one to eight lines, one URL per line. As soon as there are several lines, or a line that is not recognised, the count shows below in `text-[11px]`: "3 tickets recognised" in `--accent`, the duplicates ignored in `--muted`, then one `red-700` line per refused entry ("Line 2: … is not a GitLab or GitHub ticket URL."), the faulty text in mono. From two tickets on, the directory choice gives way to a `--muted` help sentence, the label of the instruction says it applies to the whole batch, and the run action button says "Start 3 tickets". It stays disabled while a line is refused.
- **Queue (list of runs).** Under the runs in progress, before the archives, on a `--sunken` background. A batch has its title ("Batch of 14:32 · 3 tickets queued", `text-[10px] font-semibold`), then the name of each repository in mono `text-[9px]` `--muted`, then its tickets, named by their number. A lone launch keeps a single row, with no title. The hollow dot of the row breathes during "Analysis in progress". The second line says what the ticket is waiting for, in `--muted`: "Waiting, conflict with #217 running", "Waits for MR !12 to be merged (#217)", "Depends on #217, still queued", "Runs after #217". "State of MR !12 unknown (#217)" turns `amber-800` with the `Warning` `fill` icon, like the mentions "Analysis failed" and "Unreliable prediction". "Why it waits" is a disclosure closed by default (`CaretRight` chevron that rotates): the reason given by the agent in `--ink`, the summary of the ticket in `--muted`, then the two forced starts. They are full-width secondary buttons, "Start from the base" and "Stack on `branch`" (the branch in mono), each followed by a `text-[10px]` `--muted` sentence that says what the gesture costs. "Stack" is offered only if the other ticket's branch exists. Move up, move down and remove are `size-5` icon buttons to the right of the number, with an accessible label that names the ticket. A row that can be reordered is dragged (`cursor-grab`) and shows the `DotsSixVertical` grip, `--muted`, before its buttons; while dragged it drops to 40% opacity, and the row under the pointer draws a 2px `--ink` line on the edge the ticket would land on.
- **Tickets from the watcher (list of runs).** Under the queue, on the plain background of the list, only for the tickets of the watcher's file that are not queued. The overline "From the watcher · 2" in mono `text-[9px]` `--muted`. One row per ticket: its title in `text-[11px] font-medium` `--ink`, or the project and number when the watcher gave no title, then a link "project #247" in `text-[10px]` `--muted` that opens the ticket, the base branch "from feat-87" in mono `text-[10px]` `--muted` when the watcher named one, and the state in `text-[10px]`: "Starting…" in `--muted` while the console queues it, "Not started: <reason>" in `red-700` when it could not. A refused row has a `size-5` icon button with a cross on the right, labelled "Dismiss". There is no start button: the console queues every ticket it reads.
- **Terminal.** `--terminal` background, thin scrollbar `#47504b`. In the light theme, it is the only dark surface of the application; in the dark theme, it keeps the same background and the same ANSI colours.

Every interactive element has a visible focus: `outline-2`, 2 px offset, `--accent` colour. Pressed actions move down one pixel (`active:translate-y-px`).

## Icons

One library: [Phosphor](https://phosphoricons.com), the `…Icon` components of `@phosphor-icons/react`.

- `regular` weight by default, `bold` for a check or the mark, `fill` for a status indicator.
- Sizes from 12 to 16 px in the panels, 17 to 18 px in the navigation. The icon takes the colour of the text next to it.
- An icon on its own always carries an `aria-label`.

## Motion

- One curve: `cubic-bezier(.16, 1, .3, 1)`, fast at the start, gentle at the end.
- Durations: 0.25 s for a state change (focus, hover), 0.45 s for a block appearing (`.reveal`, 8 px slide), 2.2 s for the breathing of a live status (`.status-breathe`).
- Motion signals a change, it does not decorate. Everything is turned off under `prefers-reduced-motion`.

## Tone and wording

The interface is in English, like the code and its comments. The rules below apply to the text of the interface. The language of what the workflow writes (reports, questions, merge request text) is chosen by the `IMPL_LANGUAGE` setting (`en` by default, `fr` for French).

- **Short, concrete sentences.** Say what is happening and what can be done. "This run no longer exists." instead of "An error occurred".
- **Address the user as "you".** Statuses, help and error messages speak to the user directly ("Your turn", "Reload them before saving"), in the imperative for an action to take.
- **An error message says what to do.** "Reload them before saving", "Check the access rights of the data directory".
- **Typography.** Sentence case, straight apostrophe and straight quotes, ellipsis `…` for an action that opens a window ("Settings…"), no em dash and no en dash.
- **Vocabulary.** A *run* is one execution of the workflow on a ticket, a *session* is the Claude Code process that carries it. *Delivered* means deployed to production; a merge request that was merged is *merged*, never "delivered".
- No emoji, no exclamation mark.

## Accessibility

- AA contrast targeted for all text (4.5:1). Known gap: `--muted` reaches 4.1:1 on `--paper` and 4.4:1 on `--surface`, under the threshold; white text on `--accent` is at 5:1. In the dark theme, `--muted` is above 6:1 on `--surface` and `--accent` above 7:1. Until `--muted` is darkened, do not use it for information the user cannot do without.
- Meaning never goes through colour alone (a label, an icon or a shape in addition).
- The areas that change during a run (save status, counters) are announced with `role="status"` and `aria-live="polite"`, errors with `role="alert"`.
- Each field has an associated `label` and its help linked through `aria-describedby`.
