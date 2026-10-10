---
name: gitlab-tickets
description: House conventions for creating or hand-writing a GitLab epic or ticket (titles, estimation, labels, structure, assignment, the French exception, no cross-referencing). Use whenever a GitLab ticket or epic is written or reviewed, and whenever a merge request is about to reference a ticket.
---

# GitLab ticket conventions

These are the conventions of the team this factory was first written for. The identifiers they need are settings, never written here.

## Settings

Read them from the environment (`printenv IMPL_GITLAB_TICKET_PROJECT`, and so on). The console passes to its sessions what the `.env` at the root of the plugin holds; outside a console session, read that file (`${CLAUDE_PLUGIN_ROOT}/.env`). A setting that is still missing is asked to the user once, never guessed.

| Setting | What it names | Example |
|---|---|---|
| `IMPL_GITLAB_TICKET_PROJECT` | path of the project the tickets are created in | `acme/app/shop` |
| `IMPL_GITLAB_EPIC_GROUP` | path of the group the epics live in | `acme` |
| `IMPL_GITLAB_ASSIGNEE` | username the tickets are assigned to | `jdoe` |

A project or a group is named by its URL-encoded path in an API call (`projects/acme%2Fapp%2Fshop`, `groups/acme`), so no numeric id is needed.

## Titles

Commit format `feat: xxx`, **in English** by default.

**French exception, for the title only**: the description is in French in every case (see "Ticket structure"). The user occasionally asks for a French title too, `fix: ...` titles included. Write the title in English by default. If they ask for French on a ticket, rewrite its title, and do not carry that over to the next ticket without a new request. On a series of tickets created in the same run, apply French titles to the whole series as soon as they ask for it on any one of them.

## Estimation

Estimates are in points, in the GitLab `weight` field:

```bash
glab api -X PUT "projects/<url-encoded-project-path>/issues/<iid>?weight=N"
```

Fibonacci scale `1,2,3,5`: `1` = trivial (a translation, a CSS colour), `5` = complex feature, most average tickets = `2-3`. Slightly overestimate. One developer's capacity is roughly **30 points / 10 days** (20-40 depending on the kind of tickets).

**Do not raise the weight just because the functional scope widens.** The weight reflects real complexity and effort, not the number of bullets in the description: repetitive, mechanical work on an already solved pattern does not necessarily increase the estimate.

## Labels

By default carry over the epic's labels. If the user explicitly asks for specific labels, set them as given.

## Ticket structure

- Functional description, edge cases, a targeted Figma link, and when asked the **full API contract** (endpoints, schemas, error codes) so the ticket is self-sufficient.
- **Always write ticket description in French**
- Write the title and description with `implementation-factory:unslop`.
- **Do not list the source files to modify.**
- **A ticket is a technical specification, not a digest of PRD quotes**: states and transitions, the consumed API contract, client-side validation, interface strings, responsive rules, written in the imperative and in your own words. No PRD blockquote, no Notion section name, no "extracts that justify the ticket". Verbatim is reserved for strings shown to the user and for numeric values. The reader is a front-end developer implementing without opening the PRD.
- Split a plan into tickets attached to an epic, each independently shippable. Calibrate on the sprint size (for example ~10 days).

## Assignment

Assign the user `IMPL_GITLAB_ASSIGNEE` names on the tickets: `glab issue update <iid> --assignee <username> -R <project>` (see the `glab-gitlab-api` skill for the `assignee_ids[]` trap).

## Do not mention another team without real impact

As with any writing, no gratuitous blame towards another team in a ticket (delay, dependency) without a concrete impact on what is being described.

## Never link a ticket to a merge request that does not implement it

A merge request carries a reference to a ticket only when it implements it. An adjacent topic discovered along the way justifies neither a `fix-<iid>-...` branch name nor a `#<iid>` in the commit message or the merge request description.

**Why**: GitLab turns those mentions into system notes on the ticket ("mentioned in merge request !X", "mentioned in commit Y") which remain even after the merge request is closed, and the branch name makes the merge request read as the ticket's delivery. Those system notes are irreversible once posted.

**How to apply**: before naming the branch, ask whether the merge request closes the ticket. If not, no reference anywhere, and the context goes into the merge request description without a number.

## Creation workflow

1. Create the epic: `glab api --method POST "groups/<url-encoded-group-path>/epics"`
2. Create the issues with `glab issue create` / `glab issue update` for reliable title, assignee and label (see `glab-gitlab-api`)
3. Attach to the epic: `glab api --method POST "groups/<url-encoded-group-path>/epics/<iid>/issues/<issue_id>"` (see `glab-gitlab-api` for the internal id required)

**Issue URLs** on some projects are `/-/work_items/<iid>` and not `/-/issues/<iid>`: to capture the iid after `glab issue create`, grep for `work_items/[0-9]+`, not only for `issues/`.
