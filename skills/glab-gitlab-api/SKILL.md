---
name: glab-gitlab-api
description: Recipes and traps for the `glab` CLI and the GitLab API - linking a ticket to an epic, passing a long description from a file, assigning an issue reliably, reading and writing a work item's native status. Use whenever a glab command fails silently or returns an unexpected error (404 on --epic, assignee_ids ignored, description filled with the literal text "@file.md", status absent from the REST API).
---

# glab / GitLab API - recipes and traps

## Linking a ticket to an epic

The `--epic <iid>` flag of `glab issue create` returns a `404 Not Found`. Do not rely on it.

The workflow that works, in three steps:

```bash
# 1. Create the ticket without --epic
glab issue create -R <group/project> -t "..." -d "..." -l ... -a ... -y

# 2. Fetch the ticket's INTERNAL id (not its displayed iid)
glab api "projects/<group%2Fproject>/issues/<iid>"   # the `id` field

# 3. Link it to the epic through the internal id
glab api --method POST "groups/<group>/epics/<epic_iid>/issues/<internal_id>"
```

Invented example: ticket `shop#412` (internal id `90001234`) linked to epic `acme&17`: `glab api --method POST "groups/acme/epics/17/issues/90001234"`.

**Group trap**: an epic's iid is scoped to its group, not global. `acme&6` and `acme/app&6` are two completely different epics that share the iid `6` by coincidence. Always reuse the EXACT group path written in the ticket ("Épique : acme/app&6"), never assume the root group applies. Check with `glab api "groups/<url-encoded-group-path>/epics/<iid>"` and compare the title before linking.

When the `gitlab-tickets` conventions apply, the group the epics live in is the one `IMPL_GITLAB_EPIC_GROUP` names, which may be a root group and not the subgroup of the project.

## Passing a long description from a file

For a multi-line markdown description with `glab api`: `--field "description=@file.md"`. The `@` prefix is only interpreted with `--field`.

- `--raw-field "description=@file.md"` sends the literal string `@file.md` (no interpretation).
- `--input file.json` returns HTTP 400 (wrong Content-Type for the GitLab API).

Epic creation example: `glab api "groups/<gid>/epics" -X POST --field "title=..." --field "description=@desc.md"`.

**Trap with `glab issue create` (not `glab api`)**: its `-d` / `--description` flag does NOT support the `@file` prefix. `-d "@file.md"` literally fills the description with the text `@file.md`. The correct workflow for a long description at creation time:

```bash
glab issue create -t "..." -d "placeholder" -l ... -a ...
glab api --method PUT "projects/<path>/issues/<iid>" --field "description=@file.md"
```

## Assigning an issue

Use `glab issue update <iid> --assignee <username> -R <project>`.

Do not go through `glab api projects/:id/issues -f "assignee_ids[]=<userid>"` (POST or PUT): the assignment is silently ignored (`assignees` stays empty) with no error. The dedicated `glab issue update` command works reliably with the username.

## Work item status

For native status reads and authorized updates, read [work-item-status.md](references/work-item-status.md). The caller chooses the transition; lifecycle names are project-specific.

## Merge request delivery

For an authorized MR creation or consolidated review publication, read [merge-request.md](references/merge-request.md). Do not publish merely because a report or URL is supplied. The caller provides the branch, target, exact content, reviewer policy and whether delivery is ready or draft.
