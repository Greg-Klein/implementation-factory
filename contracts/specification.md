## Specification precedence

When two sources of truth contradict each other, the higher one wins:

0. **The run instruction** (the command's second argument) and the answers the user gives in step 2. These are current decisions about this run, so they beat every document. Nothing overrides them
1. **PRD** (or any product specification document: Notion, Google Docs, Confluence, the epic description when it plays that role)
2. **Design** (Figma, and the mockups or screenshots attached to the ticket)
3. **Ticket** (description, acceptance criteria, comments)

A ticket that contradicts the design does not override it, and a design that contradicts the PRD does not override it either. The lower source is treated as outdated, not as a refinement.

Two exceptions, and only two:

- **An explicit later decision beats the order.** A ticket comment that says "the PRD is wrong on this point, do X" is a decision, not a contradiction. Same for an answer the user gives in step 2, and same for the run instruction. Record it as such.
- **A gap is not a contradiction.** Silence at a higher level is not a conflict: the design detailing what the PRD leaves open is normal, follow it.

Never resolve a contradiction silently. Say which sources disagree, on what, which one was applied and why: the pilot records it in `.claude/tasks/ticket-context.md`, and any other agent reports it to the pilot in its own output. Material decisions affecting delivery go into the merge request description; the full arbitration remains in the context and review reports. If applying the precedence order changes something user facing in a way that looks unintended (the PRD looks simply stale rather than authoritative), it becomes a blocking question for the user, asked by the pilot, instead of a decision taken alone.

---

## Never invent

A specification gap is never filled by imagination. Three ways out, in this order:

1. **Deduce, when it is genuinely obvious.** Standard interaction behaviour, an existing convention in the repository, a comparable screen already shipped, an explicit answer in the Figma file. A close button closes the modal, a cancel discards and closes, `Escape` closes an overlay, a spinner shows while loading. The translation of a string the ticket does provide, into the other languages the repository ships, also belongs here: translate faithfully, never ask. Implement it and write the deduction down in the report.
2. **Ask, when the answer is a decision.** A product rule, a user facing string, a limit or threshold, a data source, a permission, an error behaviour, a scope boundary, a state the ticket never mentions. These are nobody's to choose but the user's, whatever the cost in autonomy.
3. **Never guess in silence.** No plausible placeholder copy, no invented endpoint, no arbitrary limit, no `// TODO: confirm with product` buried in a diff.

Most gaps surface in step 1 and are asked in step 2. A gap that only surfaces later is the one legitimate reason to interrupt again: the pilot asks it, then resumes. A planner, a `developer` or a reviewer returns such a gap to the pilot rather than deciding it.

Record deductions and answers in the context and review reports. Include only material decisions affecting delivery in the merge request description.
