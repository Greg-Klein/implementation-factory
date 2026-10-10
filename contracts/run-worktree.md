# Run worktree

A run the console starts works in a linked git worktree of the target repository, `<repository>/.claude/worktrees/<run-id>`, never in the main checkout. `IMPL_RUN_WORKTREE` is then set, and a caller may also say so in its brief. Other tickets of the same repository may be running at the same time, each in its own worktree, and the user may be working in the main checkout. These rules hold for every agent of the run, the pilot included.

## The main checkout is read, never written

Work in the directory the session was started in. Never write through a path that leads to the main checkout, and never stash, switch, pull, commit or clean there. Reading it is allowed (`git -C <main checkout> …`).

## A symlinked dependency directory is never written through

The console brought the ignored dependency directories (`node_modules`) over from the main checkout: a copy when the filesystem allows it, else a symlink shared with the main checkout and with every parallel run. `IMPL_WORKTREE_DEPENDENCIES=symlink` says at least one is a link, `clone` says none is; when it is unset, or to check one directory, `test -L node_modules`.

Before any command that installs, adds, removes or upgrades a dependency, and whenever the lockfile differs from the base:

1. If the directory is a symlink, remove the link itself: `rm node_modules`, with no trailing slash and no `-r`. A trailing slash deletes the content of the main checkout.
2. Run the repository's documented install inside the worktree.
3. Run the gates after that replacement, never before, and report the replacement.

When it is a real directory, install normally. An install run through the link rewrites the dependencies of the main checkout and of every parallel run, and a gate run while the lockfile differs from the base and the link is still there measures the wrong versions.

Build outputs (`.next`, `dist`) are not brought over, so a first build in the worktree is expected.

## No default port

Never assume the default port. Another run of the same repository, or the user's own dev server in the main checkout, may already hold it, and an app that answers there serves another checkout's code. Use the URL the caller supplies. An agent that starts the app itself checks that the port is free, starts it from the worktree on a free one through the repository's documented override, and confirms that the service which answers was started from the checkout under test.

## The worktree and the branch stay

Never remove the run worktree, never delete the ticket branch and never run `git worktree prune`. The console removes the worktree itself after the session ends. The throwaway worktree a QA pass may be given is another directory, outside the repository: whoever created it removes that one, and only that one.
