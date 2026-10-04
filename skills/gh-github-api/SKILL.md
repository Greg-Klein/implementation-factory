---
name: gh-github-api
description: Recipes and traps for the `gh` CLI and the GitHub API when the ticket is a GitHub issue - reading an issue with its comments, attachments, sub-issues and dependencies, opening a pull request from a description file, requesting a reviewer and reading it back, publishing the consolidated review. Use whenever the ticket URL is a GitHub one (`/<owner>/<repo>/issues/<n>`), and whenever a gh command returns without error but changed nothing (reviewer not set, stacked pull request closed).
---

# gh / GitHub API - recipes and traps

Everything GitHub goes through `gh`, never WebFetch. The ticket URL gives the host, the owner, the repository and the number: `https://<host>/<owner>/<repo>/issues/<number>`.

Inside the checkout of the ticket's repository, `gh` takes the repository from `origin`, and `gh api` replaces `{owner}` and `{repo}` in a path. Elsewhere, name it: `--repo <owner>/<repo>` (`--repo <host>/<owner>/<repo>` on a host other than github.com) for a subcommand, the full path and `--hostname <host>` for `gh api`.

`gh api` has `--jq`, which `glab api` has not: filter the answer on the command line instead of reading a whole JSON body.

## Reading a ticket

```bash
gh issue view <number> --comments
gh api "repos/{owner}/{repo}/issues/<number>" --jq '{title, state, labels: [.labels[].name], body}'
```

The first is the readable form, description then comments. The second is for a field the first does not print.

**Sub-issues and parent.** GitHub has no epic. A ticket may have a parent issue and sub-issues:

```bash
gh api "repos/{owner}/{repo}/issues/<number>/sub_issues" --jq '.[] | {number, title, state}'
gh api "repos/{owner}/{repo}/issues/<number>/parent" --jq '{number, title, state}'
```

The second answers `404` when the issue has no parent: that is an answer, not a failure.

**Dependencies.** "Blocked by" and "blocking" are a native relation, read from both sides:

```bash
gh api "repos/{owner}/{repo}/issues/<number>/dependencies/blocked_by" --jq '.[] | {number, title, state}'
gh api "repos/{owner}/{repo}/issues/<number>/dependencies/blocking" --jq '.[] | {number, title, state}'
```

An empty array means no relation. A plain mention of another issue in the text (`#12`) is not a dependency, only a reason to read that issue.

**Linked pull requests.** `gh issue view <number> --json closedByPullRequestsReferences` lists the pull requests that declare they close the ticket.

**Images and files attached to the issue.** They are links in the body (`https://github.com/user-attachments/assets/<id>`, or `https://github.com/<owner>/<repo>/assets/...`). On a private repository those links need a signed address, which the HTML form of the body carries:

```bash
gh api "repos/{owner}/{repo}/issues/<number>" -H "Accept: application/vnd.github.full+json" --jq .body_html
```

Take each image address out of that HTML (`private-user-images.githubusercontent.com/...` with its `jwt` parameter, valid a few minutes) and download it at once with `curl -sSL "<address>" -o .claude/tasks/assets/<name>`. The comments have the same form under `repos/{owner}/{repo}/issues/<number>/comments`. Then `Read` each file to actually look at it, and name it after what it shows. A file that could not be downloaded is recorded as unreachable in the ticket context, never silently dropped. Never print a token, and never put one on a command line.

## The ticket status

A GitHub issue has no lifecycle status: only open and closed, and the pull request closes it at merge time through its `Closes` keyword. **Move nothing.** No label, no project field, no assignment, no closing by hand. The caller says in its final report that the status was left alone because the forge has none.

## Writing on another ticket

When the caller authorized a correction or a remark on another issue:

```bash
gh issue comment <number> --body-file <file>
gh issue edit <number> --body-file <file>
```

Both read the text from a file, so backticks and quotes survive. An edit replaces the whole body: read the current one first, change the sentence concerned in the file, and read the result back with `gh issue view`.

## Pull request delivery

For an authorized pull request creation or consolidated review publication, read [pull-request.md](references/pull-request.md). Do not publish merely because a report or URL is supplied. The caller provides the branch, the base, the exact content, the reviewer policy and whether delivery is ready or draft.
