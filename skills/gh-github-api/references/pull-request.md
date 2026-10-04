The caller must authorize publication and supply the source and base branches, the ticket, the verdict, the artifacts and the delivery policy. This recipe does not authorize merging or unrelated ticket updates. References to step numbers below name the Harness caller stages, not additional automatic actions.

# Authorized pull request delivery

This is the GitHub counterpart of [the GitLab delivery recipe](../../glab-gitlab-api/references/merge-request.md). The content rules are the same on both forges and are written once, there. Read in that file, as they stand, with "pull request" for "merge request":

- the opening paragraphs on the acceptance summary;
- the description template, and the lists of what does not belong in a description (noise, session trace, the machine that ran the session);
- the review comment template and the rules for that comment.

**Every command in that file is GitLab's and none applies here.** The same goes for its paragraphs on uploading screenshots and on the ticket status. The commands, and what differs on GitHub, are below.

## Open the pull request

Write the description to `.claude/tasks/mr-description.md` first (the file keeps that name on both forges, the console reads it by it), applying `implementation-harness:unslop`, then push the branch and open the pull request, as a normal one targeting the base branch from step 2. Run both from the checkout the caller worked in, the run worktree when there is one. Never delete the local branch or remove a worktree after the push.

```bash
git push -u origin <branch>
gh pr create --base <base> --head <branch> \
  --title "feat: <english title>" \
  --body-file .claude/tasks/mr-description.md
```

- **The description comes from the file, never from the command line.** `--body-file` reads it as it is; `--body "$(cat …)"` passes it through the shell and loses on a backtick.
- **No filler content is ever published, not even for a second.** A pull request is public the instant it exists and notifies its subscribers. The description is written before the pull request, never patched in after.
- **No `--fill`, no `--web`, no interactive prompt.** With `--title` and `--body-file` both given, `gh pr create` asks nothing.
- For the blocked case, add `--draft`. The title takes no `Draft:` prefix: on GitHub the draft state is a flag, and the prefix would stay in the title after the pull request is marked ready.

The command prints the address of the pull request, `https://<host>/<owner>/<repo>/pull/<number>`, on its last line. Keep the address and the number; steps 9 and 10 need them, and `workflow-state.json` takes the address as `mergeRequestUrl`.

## Reviewer

Apply the caller's reviewer policy in a second call, and read it back:

```bash
gh api user --jq .login                              # only for the initiating-user policy
gh pr edit <number> --add-reviewer <login>
gh pr view <number> --json reviewRequests --jq '[.reviewRequests[].login]'
```

- **GitHub refuses the author of a pull request as its reviewer**, and `gh pr edit --add-reviewer` does not say so: it prints the address of the pull request and exits `0`, with no reviewer set. The API behind it answers `422 Review cannot be requested from pull request author`. With the initiating-user policy, the user who runs the session is the author, so compare the two logins first (`gh pr view <number> --json author --jq .author.login`): when they are the same, request nobody and record "no reviewer: the author cannot review their own pull request" for the final report. That is the expected outcome on a personal repository, not a failure.
- **Read it back, always.** The reviewer is set when you have read the login out of `reviewRequests`. One you could not read back is reported as not set.
- No assignee, no label, no milestone, no project.

## Link to the ticket

Both are required, and both go into the description file before the pull request is created:

- the full ticket URL on the first line of the description;
- the keyword: `Closes #<number>` when the base is the repository's default branch, `Related to #<number>` otherwise. GitHub only closes the issue when the commits reach the default branch, so `Closes` towards a feature branch would be a lie.

**The stacked pull request** is the one exception: when the caller says the base came from `IMPL_BASE_BRANCH`, write `Closes #<number>` although the base is another ticket's branch, and add this line under the keyword:

"Empilée sur `<base branch>` (#<number of its pull request> when known) : à merger après elle. GitHub la recible vers la branche où l'autre a été mergée, à condition que la branche de base soit supprimée par GitHub lui-même."

That condition is the trap, measured on a real repository:

- the base branch deleted by GitHub, through the "Delete branch" button of the merged pull request or the repository setting "Automatically delete head branches": the stacked pull request is retargeted to the branch the other was merged into, stays open, and closes its issue once merged there;
- the base branch deleted from outside, `gh pr merge --delete-branch` or `git push origin --delete <branch>`: the stacked pull request is **closed**, not retargeted, and its base no longer exists.

So never delete a base branch yourself, and never merge anything. The user merges. In the final report of a stacked delivery, tell the user to let GitHub delete the base branch when they merge the first pull request.

**"Livré" means deployed to production**, here as on GitLab. A ticket whose pull request is open, or merged into a feature branch, is not "livré": name the stage it reached ("PR ouverte", "mergé dans `<branch>`").

## The ticket status

Nothing is moved on GitHub, at step 3 or at step 8: an issue has no lifecycle status. See the skill's "The ticket status".

---

## Publish the consolidated review

Once the caller supplies the final verdict and review artifacts, publish the consolidated review as one comment on the pull request. This is mandatory, on a `READY` verdict as well as on a `BLOCKED` one.

Build it as the GitLab recipe says, from the sources step 7 named for your tier, write it to `.claude/tasks/mr-review-comment.md` with the template and the rules of that recipe, then post it:

```bash
gh pr comment <number> --body-file .claude/tasks/mr-review-comment.md
```

**Screenshots stay on this machine.** GitHub has no API to attach a file to a pull request or a comment, and committing captures to the repository to link them would put run evidence in the target project's history. So nothing is uploaded:

- omit the `### Captures` section;
- in `### Critères d'acceptation` and wherever a capture backs a claim, write "capture restée locale" with the name of what it shows, never a local path and never an image link;
- say once, in `### Validation`, that the captures of this run are kept in the console's archive and are not attached, because the forge offers no upload.

A claim whose only proof is a capture is still reported with the measurement it rests on (the value read, the request seen, the state observed), so the reader has more than a sentence to go on.

If `gh pr comment` fails, report the failure and the path of the comment file in the final report. Do not fall back to passing the text on the command line.
