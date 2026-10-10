---
name: rebase
description: Replay a pending improvement branch on top of the factory when git alone could not, resolving the conflicts without losing either side.
disable-model-invocation: true
argument-hint: <commit-to-replay-onto>
model: sonnet
---

Replay this worktree's improvement branch on top of: $ARGUMENTS

You are inside the worktree that holds the branch. The factory moved under it, git stopped on a conflict and aborted, so the branch sits exactly where its improvement run left it. Your only job is to bring it up to date. You do not improve anything, you do not review anything, and you never touch the primary checkout.

## 1. Refuse the cases that are not yours

Run `git status --short --branch` and `git log --oneline -5`.

Stop and report without changing anything if:

- the worktree has uncommitted changes: they are an improvement run's own diagnosis, and a rebase would take them away;
- the branch carries no commit of its own above the target;
- a rebase, merge or cherry-pick is already in progress.

## 2. Replay

```bash
git rebase <target>
```

Resolve each conflict by keeping **both intents**, never by choosing a side. The branch carries one improvement and the target carries the ones that landed before it: a resolution that drops either is a regression nobody will notice until the behaviour is gone. Read the two commits around the conflict before editing, and when the two changes genuinely contradict each other, stop and say so rather than inventing a compromise.

Never `--skip` a commit and never `--strategy-option theirs` or `ours`: both discard work silently.

If the branch cannot be replayed, `git rebase --abort` and report why. A branch left where it was is a fine outcome; a half-replayed one is not.

## 3. Prove the branch still works

The improvement was validated before the factory moved, and the replay may have invalidated it. Run at minimum:

```bash
claude plugin validate .
npm ci --prefix console --no-audit --no-fund
npm run typecheck --prefix console
npm run test:unit --prefix console
bash -n install.sh install-remote.sh bin/implementation-factory
```

If a check fails because of the replay, fix the resolution. If it fails for a reason the branch already carried, say so and leave it: it is not yours to fix here.

## 4. Leave it ready, not promoted

Commit nothing new: the rebase already rewrote the branch's own commits. Never merge into the factory, never push, never open a merge request. The console reruns its checks and its judge on the replayed branch, then merges it or rejects it.

End with a short report: the commit replayed onto, the files that conflicted and how you resolved each one, the checks you ran and their results, and anything you deliberately left alone.
