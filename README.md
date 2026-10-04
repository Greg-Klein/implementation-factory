![Implementation Harness](docs/cover.png)

Implementation Harness is a local interface for driving Claude Code while it implements a GitLab ticket. You paste the ticket URL, the harness finds the matching checkout, creates a git worktree for the run, opens a Claude Code terminal in it and shows the progress, the agents, the tools and the deliverables. You can also paste several tickets at once: the harness queues them and holds back the ones that would touch the same code.

The repository contains a Claude Code plugin whose `/implementation-harness:implement` command orchestrates the work: reading the ticket, clarification questions, planning, implementation, tests, specialised reviews and preparing the merge request. The harness is the visual layer of that command. It uses the Claude Code login already present on the machine and makes no direct call to the Anthropic API.

The interface opens in the browser with the `impl` command, which serves the compiled version of the checkout. There is no desktop application. The harness runs from its own repository, so the self-improvement loop can modify the code that is running.

The console's interface is in French. Labels and messages are quoted here as they appear on screen.

## How agents and skills are organised

Agents define responsibilities and deliverables. Skills hold the methods, loaded when needed. The developer's self-check and the adversarial review follow separate methods and share evidence collection. The formats the console reads stay in dedicated contracts.

Six agents carry a run:

| Agent | Role |
|---|---|
| `ticket-planner` | turns the ticket and the current code into a task plan, with assumptions, dependencies, risks and verification steps |
| `developer` | implements a task and checks its own work |
| `senior-reviewer` | independent code review, then justified fixes within the allowed scope |
| `designer-reviewer` | design review of a change visible in the interface, with or without Figma, without reading the product code |
| `qa-reviewer` | independent validation of the final behaviour, without modifying the delivered code |
| `review-orchestrator` | chains the reviews, routes the fixes and writes the review summary |

A seventh agent, `ticket-scheduler`, takes part in no run. The console calls it before a batch starts, to predict what each ticket would touch (see [Launch several tickets at once](#launch-several-tickets-at-once)).

The pilot picks a review tier from the size of the diff:

- tier 0: a single pass of `senior-reviewer`, with no orchestrator and no rework loop, while the pilot runs the general checks itself (lint, typecheck, tests);
- tier 1: `senior-reviewer`, then `designer-reviewer` if the pilot triggered the design review and the application is reachable, then `qa-reviewer`, once each;
- tier 2: `review-orchestrator` runs the full loop. `senior-reviewer` and `qa-reviewer` keep their default model there, Opus. At tiers 0 and 1, the pilot calls them with Sonnet. `designer-reviewer` runs on Sonnet at every tier.

QA writes its test plan to `qa-plan.md` before opening the author's reports, then tries to make each criterion fail. It declares a criterion met only on an observation it ran itself. When a criterion has no observation, the verdict is `INCONCLUSIVE` and the merge request is opened as a draft, with those criteria named.

The design review works without Figma. With Figma frames, it runs as soon as the change is visible in the interface. Without Figma, the pilot triggers it only if the diff modifies a shared interface component or creates a screen or a route. It judges the change against the best reference available: the Figma frames (`figma`), the mockups attached to the ticket (`ticket-mockup`) or the screens the application already ships (`live-neighbours`). It writes its inventory to `design-inventory.md` before reading the developer's measurements. A design verdict of `INCONCLUSIVE` does not block delivery. The merge request, the review comment and the final report flag it with the words "design non vérifié" (design not verified), with the reason.

See [Agents, skills and independent review](docs/engineering-workflow.md) for the capabilities, the triggers, how context is passed, the review methods and the checks. The [architecture diagram](docs/architecture.html) shows on one page the path of a run, the workflow, run health, batch scheduling and the self-improvement loop. It is a standalone HTML file, to open in a browser from the checkout.

## One-command installation

Requirements:

- macOS or Linux;
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and logged in;
- Node.js 22.12 or later;
- `git`, and [`glab`](https://gitlab.com/gitlab-org/cli) installed and authenticated.

Run:

```bash
curl -fsSL https://raw.githubusercontent.com/Greg-Klein/implementation-harness/main/install-remote.sh | bash
```

The same command updates an existing installation with a `git pull --ff-only`. The installation compiles the Next.js interface, then `impl` starts that production build.

The installer downloads the dependencies and creates two commands in `~/.local/bin`:

- `impl`, the short alias;
- `implementation-harness`, the explicit name.

If `~/.local/bin` is not in `PATH` yet, the installer prints the line to add to your shell configuration.

## Usage

```bash
impl
```

| Command | Effect |
|---|---|
| `impl` | starts the interface and opens the browser |
| `impl demo` | starts the interface on a simulated scenario |
| `impl restart` | stops the running server, then starts the compiled version again |
| `impl stop` | stops the running server |
| `impl status` | says whether a server is listening and whether it serves the build on disk |
| `impl config` | reads and changes the local configuration |
| `impl improve` | processes the self-improvement feedback with Claude Code |
| `impl help` | prints the help |

An unknown command is refused with the help and a non-zero exit code, and the server does not start silently.

`impl status` queries `/api/runs`, then asks the server for every `/_next/static/` resource the page references. A server still running on an earlier build answers with a manifest whose files the rebuild deleted, which gives an unstyled page. Its exit codes: `0` listening and consistent, `1` listening but inconsistent, `3` stopped.

```console
$ impl status
Serveur   : en écoute sur http://127.0.0.1:3210 (PID 76579)
Build     : caiz9bak8t_BsOXSZHCmN sur disque
API       : répond
Runs      : 2/3 places occupées, 3 affiché(s), 1 en file
Ressources: 11 servies, build à jour
```

To explore the interface with no ticket and no call to Claude Code:

```bash
impl demo
```

This command opens a simulated local scenario with progress, agents, generated documents and interactive decisions. Each step lasts five seconds. The first review asks for fixes and sends the work back to the implementation agent, then a second review approves the changes. The Preuves (evidence) tab shows five criteria in every possible state, including a first-round failure replaced in the second round and kept in the history with its capture. The demo modifies no repository, does not contact GitLab and does not feed the self-improvement loop. Two other scenarios open from the address, on a server that is already running: `/?demo=incident` plays a run whose pilot hands back with nothing next, and `/?demo=batch` plays a batch of three invented tickets, two of which touch the same code. Demo mode adds no control to the normal interface: the improvement approval and the feedback field are shown as in real use, marked `démo`, and their actions stay simulated.

To restart a server that is already running:

```bash
impl restart
```

`impl` detects a harness that is already listening and only opens the browser. After the interface is rebuilt, the running server still serves the old Next.js manifest, the stylesheets return an error and the page shows without styles. `impl restart` stops the server on the current port, waits for the port to be free and starts the compiled version again. It combines with demo mode (`impl restart demo`) and stops nothing if its argument is invalid.

The browser opens on <http://127.0.0.1:3210>.

## Driving runs

In the console:

1. paste the URL of the GitLab ticket, or several URLs, one per line (see [Launch several tickets at once](#launch-several-tickets-at-once));
2. check the detected project or enter its path;
3. add an instruction specific to this run if needed;
4. start the workflow, then answer the decisions in the dedicated panel or talk freely in the terminal.

### Several runs in parallel

The harness holds several runs at once. The left column lists them, newest first, and the selected run shows on the right. Each row gives the repository and the ticket, the step reached, what the agent is doing right now, and an orange badge when a decision is waiting for an answer. The **+** button at the top of the list goes back to the launch form without interrupting the runs in progress.

Several tickets of the same repository can run at the same time, because each run works in its own worktree (see [One worktree per run](#one-worktree-per-run)). Two limits bound the parallelism, and batch scheduling adds a third, described below:

- **one run per ticket of a repository.** Two sessions on the same ticket would fight over its branch and its merge request;
- **`IMPL_MAX_CONCURRENT_RUNS` sessions in total** (3 by default). Each one is a real Claude Code session, with its own quota and CPU.

A launch that hits either limit goes to the queue, shown under the list with the reason it waits, "ticket déjà en cours" (ticket already running) or "toutes les places sont prises" (every slot is taken). It starts on its own as soon as the ticket or a slot is free. The queue is saved in `queue.json`, under the [data directory](#configuration), with the schedule that holds it, and survives a restart. The requests that were only waiting for a slot start as soon as the server listens again, without anyone launching them again. The ones waiting for a merge request keep waiting for it. A cross removes a request from the queue.

A finished run whose session is still open keeps its slot and its ticket. The **Libérer la place** (free the slot) button closes that session and lets the queue move. When a queued launch is waiting for that ticket or that slot, the harness closes the session itself. Once the session is closed, the bin icon on its row, or the **Fermer** (close) button of the view, removes the run from the list. Its documents, its conversation and its log stay archived in `runs/<id>/`, under the data directory.

The notifications, the tab title and the tab icon cover every run at once, because the run that needs an answer is rarely the one you are looking at. Messages that concern no run in particular (a request put in the queue, an improvement rebased) show in a banner under the header.

The **Suivi** (tracking) tab shows the tasks of the plan (`planner-output.json`) in three columns, To Do, In Progress and Done. A task moves to in progress when the orchestrator gives it to a `developer` agent, and to done when its report `developer-report-<id>.md` is written. Each agent of a run gets a first name and a photo, in the order it starts, and the card shows the agent that holds the task, as "Tom · Dev". The same name appears in the agents panel.

The **Documents générés** (generated documents) button opens a built-in reader for the ticket context, the plans, the test reports, the reviews and the MR descriptions kept during the run.

The reader does not interrupt the run. If Claude Code asks a question while you are reading, a banner flags the pending decision and the **Répondre** (answer) button closes the reader to show the clarification card.

The progress panel sums up the deliverable of the run: the ticket, the working branch as soon as the workflow creates it, and the merge request as soon as it is opened. The ticket and the merge request are clickable, the branch is there to be read back. The merge request is read from the output of the command that opens it, so it appears without the workflow having to declare it.

A run takes a long time and does not need watching. The tab title and its icon follow the state of the runs, and the browser sends a system notification when a decision is waiting for an answer, when the session needs attention and when the run ends. The browser permission is asked on the first launch, and a notification is sent only if the page is not in the foreground.

The speaker button in the header adds a sound to the same three moments: a two-note rise when something is expected from you, a three-note resolution when the run is over. It is **off by default** and the setting is remembered in the browser. Turning it on plays the sound at once, to check the setting without waiting for a run.

The interface plays the sound at the moment the question becomes blocking. A sound requested from the model arrived early and could be forgotten. Two caveats: a browser forbids a page to play sound before an interaction, so the very first signal of a session opened without a click stays silent, and two tabs open on the harness sound twice.

The harness runs Claude Code in the worktree of the run with the plugin of this repository. No plugin file is copied to `~/.claude`.

### Launch several tickets at once

The **Ticket GitLab** field accepts several URLs, one per line. URLs separated by spaces, commas or semicolons on one line are read too. Under the field, the form gives the number of tickets recognised, the duplicates ignored and the lines that are not a ticket URL. While a line is invalid, the batch does not start.

From two tickets on, the directory field disappears: the repository of each ticket is detected from its URL, in the roots of `IMPL_SEARCH_ROOTS`. The specific instruction applies to every ticket of the batch. The button becomes **Lancer les N tickets** (launch the N tickets).

The batch is accepted or refused as a whole. If a single ticket has no checkout, nothing is queued and the banner says which one. A ticket the harness already has, queued, running or behind a merge request it watches, is left out, and the banner gives the count.

#### Batch analysis

Before starting, the harness compares the tickets of one repository. To do so it opens a Claude Code session with no terminal (`claude -p`, Sonnet model) in the main checkout, on the `/implementation-harness:schedule` command. The `ticket-scheduler` agent reads each ticket with `glab`, looks in the repository for the files the ticket would touch and links the tickets that cannot run together: those that would modify the same files, and those where one needs the result of the other. This session modifies nothing in the repository.

- There is one session per repository and per batch. It does not count against `IMPL_MAX_CONCURRENT_RUNS`.
- A ticket alone in its repository, with no other known ticket to compare with, starts without analysis.
- A ticket added later is compared with the predictions already made for the tickets queued, running or waiting for their merge. Those are not computed again.
- Two tickets of different repositories never hold each other.
- The analysis has `IMPL_SCHEDULE_TIMEOUT_MINUTES` minutes (5 by default). If it fails, runs past that time or returns an invalid file, the tickets concerned run one at a time on their repository and the queue shows "Analyse en échec" (analysis failed). A restart of the console during the analysis has the same effect. The next analysis of the same repository takes these tickets again with the new ones, as long as they are queued, running or waiting for their merge. No analysis is started for them alone.
- A ticket too vague to predict is marked "Prédiction peu fiable" (unreliable prediction) and runs alone on its repository.

#### What the queue shows

The queue shows under the runs in progress, by batch ("Lot de 14:32 · 3 tickets en file"), then by repository. Each row says what the ticket is waiting for:

| Row | What the ticket is waiting for |
|---|---|
| "Analyse en cours" | the answer of the analysis session |
| "En attente, conflit avec #217 en cours" | #217 is running and touches the same code |
| "Attend que la MR !12 soit mergée (#217)" | the run of #217 is over, its merge request is not merged yet |
| "État de la MR !12 inconnu (#217)" | GitLab does not answer; the ticket stays held until the state is known |
| "Dépend de #217, encore en file" | #217 has to go first, and has not started |
| "Passe après #217" | the two tickets conflict, #217 is ahead in the queue |
| "En attente, ticket déjà en cours" | a run already holds this ticket |
| "En attente, toutes les places sont prises" | a slot |

A ticket held by the schedule takes no slot, and the tickets behind it that conflict with nothing go ahead. The **Pourquoi il attend** (why it waits) disclosure gives the reason the agent wrote and the summary of the ticket. The arrows change the order of the tickets of one repository, the cross removes a ticket from the queue. A ticket another one depends on stays ahead of it, whatever order is chosen.

A ticket in conflict waits for the other ticket's merge request to be merged, not only for its run to end: it then starts from the updated base. If that merge request is closed without being merged, or if the run ends without opening one, the ticket is released and the banner says so.

#### Start anyway

The disclosure offers two forced starts. A forced ticket still waits for a free slot, and does not start while a run holds the same ticket.

- **Lancer depuis la base** (start from the base). The ticket starts from the base branch without waiting for the other one. Both tickets touch the same code, so the second merge request will probably have to be reworked by hand. Also offered during the analysis: nothing says yet whether the ticket conflicts.
- **Empiler sur `<branche>`** (stack on a branch). The ticket starts from the other ticket's branch, and its merge request targets that branch. It can only be merged after the other one. When the other one is merged and its branch deleted, GitLab retargets the second. Offered only when the other ticket's branch already exists.

#### What it costs

- **The analysis** is a Claude Code session on Sonnet, per repository and per batch. It uses the quota of the logged-in account, as a run does, and the analysis timeout bounds it.
- **Watching the merge requests uses no tokens.** The Node server calls `glab api` to read the state of the merge request, without opening a Claude session. The call happens every 60 seconds, only for the merge requests a queued ticket is waiting for. When nothing waits any more, the server stops asking GitLab. `IMPL_MERGE_POLL_MS`, set in the launch environment, changes this interval.

#### Limits

- The scheduling ran once on a real GitLab project: three tickets of a small test repository, with the real Claude Code. The analysis took about 30 seconds, the tickets held behind a merge request were released within seconds of the merge, and the ticket started after it contained the merged code. One trial does not measure the quality of the predictions. Never tried for real: the stacked start, the forced start from the base, and a conflict found between two tickets that were both analysed without failure. The automated tests replace `claude` and `glab` with stand-ins.
- A prediction is an estimate made before the code is written. Two tickets judged independent can still conflict at merge time.
- The harness does not pull tickets from GitLab by label or assignee itself: you paste the URLs, or an outside watcher proposes them (next section).

### Tickets proposed by a watcher

The harness can show tickets found by an outside tool, for example a script that asks GitLab for a label, an assignee and a status. That tool writes the list of tickets it found to `console/data/ticket-proposals.json`, and the harness reads the file again every five seconds. The two share nothing else: either can be stopped without affecting the other, and without the file the harness works as before.

The tickets appear in the left list, under **Proposés** (proposed). Nothing starts on its own:

- **Lancer** (launch) queues the ticket like a pasted URL. **Tout lancer** (launch all) sends them as one batch, so the tickets of one repository are compared before they start.
- **Ignorer** (dismiss) removes the ticket from the list.

A ticket launched or dismissed is not proposed again while it stays in the file. If it leaves the file and comes back, it is proposed again. A ticket already queued, running or waiting for its merge is not proposed.

`IMPL_TICKET_PROPOSALS_FILE`, set in the launch environment, names another file by its absolute path. The expected format is described in [contracts/ticket-proposals.md](contracts/ticket-proposals.md).

### One worktree per run

Before opening the session, the harness creates a git worktree of the project in `<project>/.claude/worktrees/<run id>`, detached at the current commit of the main checkout. Claude Code starts in that directory and does all its work there: the ticket's branch, the commits, the `.claude/tasks` directory and the development server. The main checkout is not touched. Its branch, its uncommitted changes and its stash stay as they are, and you can keep working in it during the run.

What the worktree takes from the main checkout:

- the dependency directories Git ignores, at any depth (`node_modules` by default, setting `IMPL_WORKTREE_DEPENDENCY_DIRS`). They are copied, copy-on-write when the filesystem allows it: the copy then takes no disk space until one side changes, and an install in the worktree stays there. If the copy fails, the directory is linked with a symbolic link;
- the `.env*` files Git ignores and the `.claude/settings.local.json` file (setting `IMPL_WORKTREE_COPY_FILES`), copied.

The `.claude/worktrees/` directory and the links are written to the repository's `.git/info/exclude`. They do not show in `git status` and enter no commit, and the tracked `.gitignore` is not modified. Build outputs (`.next`, `dist`) are not provided, so the first build of a run is a full one. When a ticket changes the dependencies and `node_modules` is a link, the workflow first replaces it with a real install in the worktree, so it modifies neither the main checkout nor the other runs.

If the worktree cannot be created, the run does not start: the harness never falls back on the main checkout. If the dependencies cannot be brought over, the run starts and the activity feed says so.

Two runs of the same project may want the same port for their development server. The workflow starts its own on a free port.

Once the session is closed, the harness removes the worktree itself when all these conditions hold:

- the run is over and the workflow is not blocked;
- the merge request exists and is not a draft;
- the evidence archive has been confirmed;
- the tree is clean;
- the last commit is on a branch of the remote, according to the local references.

The ticket's branch is never deleted, and the merge request stays.

In every other case the worktree is kept, so the work can be resumed, and the activity feed gives the reason, for example "aucune merge request" (no merge request) or "changements non poussés" (unpushed changes). As soon as its session is closed, the run view offers the **Supprimer le worktree** (remove the worktree) button. If the worktree holds uncommitted or unpushed work, the harness says what would be lost and asks for confirmation. What is not committed is then lost, the branch and its commits stay in the repository.

A run removed from the list with **Fermer**, or left by a stop of the console, stays reachable while its worktree is on disk: it appears in the **Worktrees conservés** (kept worktrees) group of the left column, or under **Interrompus** (interrupted) if it also carries an open incident. On start, the harness applies the same rules to the worktrees of earlier runs: it removes the ones that meet the conditions, forgets the ones whose directory is gone and keeps the others with their reason.

Launched without the console, the plugin works as before, directly in the checkout.

When Claude Code uses `AskUserQuestion`, the harness shows the decisions in a dedicated panel: the suggested choices can fill in the answer, which stays editable in a text field before it is sent. The answer goes back to Claude Code through the waiting hook. The built-in terminal stays visible and interactive during the whole run, for free exchanges and for the commands that do not go through this panel.

## Configuration

The repository's configuration is set with:

```bash
impl config
```

The assistant goes through each setting, shows the current value between brackets, keeps that value if you press Enter, refuses an invalid entry and offers to restart the server when a change requires it. It writes a local `.env`, ignored by Git.

For quick or scripted use:

| Command | Effect |
|---|---|
| `impl config list` | effective value of each setting and where it comes from |
| `impl config get KEY` | a single value, on standard output |
| `impl config set KEY=VALUE` | writes a setting without going through the assistant |
| `impl config path` | path of the `.env` |
| `impl config edit` | opens the `.env` in `$EDITOR`, then checks it |
| `impl config check` | checks the configuration, exits with 1 if it is broken |

The available settings:

| Variable | Effect | Default |
|---|---|---|
| `IMPL_SEARCH_ROOTS` | roots where checkouts are looked for, separated by commas | `~/workspace` |
| `IMPL_PERMISSION_MODE` | permission mode of each run: `manual`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions` | `auto` |
| `IMPL_SELF_IMPROVEMENT_AUTORUN` | self-audit at the end of each run | `true` |
| `IMPL_REMOTE_CONTROL` | Remote Control on the terminal of a run | `true` |
| `IMPL_PORT` | listening port | `3210` |
| `IMPL_HOST` | listening interface; outside the loopback, the console is reachable from the network and says so on start | `127.0.0.1` |
| `IMPL_NO_OPEN` | `1` to start without opening the browser | `0` |
| `IMPL_MAX_CONCURRENT_RUNS` | number of runs held in parallel, from 1 to 10; beyond it, launches wait in the queue | `3` |
| `IMPL_SCHEDULE_TIMEOUT_MINUTES` | minutes given to the analysis of a batch of tickets, per repository, from 1 to 60; past it, the tickets of that repository run one at a time | `5` |
| `IMPL_WORKTREE_DEPENDENCY_DIRS` | names of the dependency directories Git ignores that the worktree of a run takes from the main checkout, at any depth, separated by commas; no build outputs | `node_modules` |
| `IMPL_WORKTREE_COPY_FILES` | files copied from the main checkout to the worktree of a run, separated by commas: a name pattern such as `.env*` for files Git ignores, or a path from the root of the repository | `.env*,.claude/settings.local.json` |
| `IMPL_STALL_MINUTES` | minutes without progress before the console raises a doubt about a run in progress (a doubt only: nothing is stopped or restarted) | `10` |
| `IMPL_DEMO_STEP_MS` | duration of a step in demo mode | `5000` |

A variable set in the shell wins over the `.env`, which wins over the default. A one-off setting therefore needs no write:

```bash
IMPL_PORT=4321 impl
IMPL_NO_OPEN=1 impl
```

The runs, the queue and the feedback are kept in `console/data/`. `IMPL_ENV_FILE` and `IMPL_DATA_DIR`, set in the launch environment, choose other absolute paths, and `IMPL_PLUGIN_ROOT` names a checkout of the harness other than the one serving the console.

### Session permissions

A run has to reach its end unattended. It therefore starts with an explicit permission mode instead of the one configured on the machine that opens it. The default is `auto`, the same as the background sessions of the harness. `manual` hands control back before each tool, at the cost of a run that stops at the first question. `bypassPermissions` checks nothing any more. The `plan` mode is not offered, because it answers with a plan and never opens a merge request.

### Terminal reachable remotely

A run starts with Remote Control on. The session shows its `claude.ai/code/session_…` link from the first second, and the terminal can be picked up from a phone or another machine without waiting for the harness to offer anything. The session stays tied to the account already authenticated in Claude Code and is not exposed to a third party. `IMPL_REMOTE_CONTROL=false` starts it without. The self-improvement session is never concerned, because it runs in the background and is not interactive.

### Project detection

The harness walks the search roots two levels deep, reads the `.git/config` of each directory and derives the GitLab project from it. After a ticket is pasted, the detected path fills the project field if it is empty. The field stays editable and suggests the checkouts found while you type. For a repository located elsewhere, add its parent directory to `IMPL_SEARCH_ROOTS`.

## Self-improvement loop

At the end of a run, the right panel lets you record concrete feedback. It is kept locally with the run's identifier and its generated documents, then processed with:

```bash
impl improve
```

This command starts Claude Code on `/implementation-harness:improve`. It groups the pending feedback, checks the evidence of the run, creates a `self-improvement-*` branch, applies the smallest lasting improvement, runs the checks and creates a local commit. It pushes nothing and merges nothing, so the result stays inspectable and reversible.

Its worktree is cut from the last pushed commit, and the loop never pushes. The iteration therefore begins by bringing its own branch up to the harness, with `--ff-only`, so it does not diagnose a tree that lacks the improvements already accepted. A branch that already carries a commit makes the command refuse and does not move.

Before choosing what to fix, it also reads the `self-improvement-*` branches the user has not yet accepted or dismissed, and the worktrees in progress. When a pending branch already contains a fix, it does not implement it again and names that branch in its report. Since several iterations can run in parallel, its diagnosis and its report carry the name of its own branch, `improvement-plan-<slug>.md` and `improvement-report-<slug>.md`, so no iteration overwrites the work of another.

The tickets, logs and raw feedback stay under `console/data/` and are never added to the improvement commit.

The harness can also criticise itself without human feedback. At the end of each workflow, including after a failure or a manual stop, it records a self-audit covering the failures, interventions, review loops, missing documents and incomplete checks. In autonomous mode, Claude Code processes this evidence in an isolated worktree. A self-generated signal has to appear on at least two runs, except for a deterministic bug or a security defect. The decision is taken once per run, and only if the run left something to analyse: a delegated agent, a document produced or an unexpected exit. A session stopped before that is dismissed, with a line in the activity feed.

The policy is set with `impl config`, or directly:

```bash
impl config set IMPL_SELF_IMPROVEMENT_AUTORUN=false
```

It starts the analysis in the background at the end of the run. The option is on by default; setting it to `false` turns the loop off.

The agent works in an isolated worktree and always leaves its commit on its `self-improvement-*` branch. Nothing is merged automatically and nothing is pushed to GitHub. The right panel shows the diff, and its merge button is the only way to promote it. A merge lands in the checkout that serves the console. Each new session reads the commands, agents, skills and hooks again, so they apply from the next run, with no restart. When the merge touches `console/` or `bin/`, the banner says so and asks for an `impl restart`. The harness does not restart itself, because sessions may be running under it.

**One improvement is in progress at a time.** While a `self-improvement-*` worktree exists, the end of a run does not open a second one. The activity feed names the one that blocks and the self-audit stays in `pending/`, where the next iteration will read it. The harness destroys nothing to free the slot, only the user's decision frees the loop. The rule comes from a measurement: the loop opened eleven branches in one day, four of them in conflict with each other, and none was promoted through the button. They were all reworked by hand. A branch nobody has decided on is also the one the next branch diagnoses itself against.

The review is offered only once an improvement commit is on the worktree's branch. The launcher returns as soon as the work detaches, so its exit code only tells about the start. For its part, `/implementation-harness:improve` leaves its branch uncommitted when its own validation fails, a state that must never be offered for merge. With no commit after an hour and a half, the activity feed points to the worktree to inspect by hand and does not open the buttons, and says the loop stays paused while it exists.

When it opens the buttons, the harness simulates the merge with `git merge-tree --write-tree`, which only writes to the object database. The panel warns before the click when the branch no longer merges, so the user does not find the conflict by clicking.

### Automatic rebase

The improvement branches all start from the same base and are merged one after the other. The first promotion leaves all the following ones behind the harness, and the gap grows with each merge. The harness therefore replays the pending branches onto its own `HEAD` every time it moves, that is when the console starts and after each merge. A branch one commit behind almost always replays on its own; the same branch ten commits behind never does.

The harness leaves three states untouched: a branch with no commit, because an agent may still be writing there, a branch already contained in the harness, which has nothing left to replay, and a worktree with uncommitted changes, which holds the diagnosis left by a failed validation and which a rebase would take away.

When git stops on a conflict, the harness aborts the rebase and the branch stays where it was. In autonomous mode (`IMPL_SELF_IMPROVEMENT_AUTORUN=true`), the harness then hands the rebase to a background agent started in the worktree of the branch, on `/implementation-harness:rebase`. That agent replays, resolves by keeping both intentions instead of one side, runs the checks again and merges nothing. Promotion still goes through the user's button. Outside autonomous mode, the panel flags the conflict, to be handled by hand.

The harness announces the merge only if it moved its branch. Git answers "Already up to date" with a zero exit code, and a conflict leaves the repository half merged. In that second case, the harness aborts the merge and keeps the worktree. When git brings nothing, the harness tells apart two situations the exit code does not distinguish:

- **the commits of the branch are already contained in the harness**, because the work was redone by hand. The worktree is no longer of use. The harness removes it with its branch and logs "Améliorations déjà présentes" (improvements already present). Refusing this case left no exact way out, since "Fusionner" (merge) said nothing had been merged and "Ignorer" (dismiss) recorded as dismissed work that had in fact been kept;
- **the branch carries no commit**, and the agent may still be writing. The worktree is kept. The cleanup happens only if the worktree also has nothing uncommitted, because the diagnosis a failed validation leaves there exists nowhere else.

## How it works

Claude Code remains the engine of the workflow. The harness adds:

- a run registry (`console/server/registry.ts`) that starts, queues and releases the sessions, each isolated in its `RunSession` with its state, its terminal, its file watchers and its pending question;
- batch scheduling: an analysis session per repository predicts what each ticket would touch, the server holds back the tickets in conflict and reads the state of the awaited merge requests with `glab`, with no Claude session (see `console/README.md`);
- an interactive pseudo-terminal per run, connected to the interface over WebSocket. Each page subscribes to the run it shows and receives only its terminal and its state, while the list of runs is sent to every page;
- Claude Code hooks to follow the agents and the tools, then show and resolve the structured questions in the interface;
- an evidence record per acceptance criterion: the pilot writes a register of identified criteria, each piece of evidence cites them with the version of the code it checked, and the server computes for each criterion whether it is verified, failed, blocked or unverified, in the Preuves tab as in the merge request summary. A QA break attempt that finds no defect is shown under its criterion without counting as a verification. The server flags a QA verdict of `PASS` or `PASS_WITH_WARNINGS` written while a criterion has no QA observation on the current code (see `console/README.md`);
- detection of runs with no next action: the server tells who can move a run forward (the user, an agent, a background task, nobody), opens an explicit incident when the pilot handed back with nothing next or when the session was lost, and offers only the actions that are possible, including a request to continue sent to the session still active (see `console/README.md`);
- a watch on `.claude/tasks/` to follow the steps and keep the reports before they are cleaned up. That directory belongs to the target repository and an interrupted run had no time to clean it: only the files written since the run started are attached to it, those left by an earlier run are ignored and do not move the step rail. The watch is set on `.claude/` and restricted to `tasks/`, because the workflow deletes and recreates that directory during a run, and a watch set on it would not wake up afterwards.

### The engine layer

Everything specific to Claude Code, the executable, the hook vocabulary, the transcript format, how an instruction is submitted, lives in `console/server/engine/`. The rest of the server reasons in runs, phases, agents and documents, without knowing which agent runs underneath.

There is a single implementation today, `claude-code`, and that is deliberate. The boundary exists so that a second implementation means writing one file, without rewriting the server. The most specific mechanism of the harness, the question that blocks the agent until the user answers, was proven portable before this layer was written.

`console/server/engine/README.md` documents the contract member by member, the full path of a blocking question, and what stays coupled outside the server.

The queue and its schedule are in `queue.json`. The files of a batch analysis are not in that directory while it sits inside the plugin, because Claude Code refuses a session any write in the directory of the plugin it loaded: they go to `implementation-harness-<user>/schedule/<id>/`, under the system's temporary directory, private to your user. With a data directory outside the plugin (`IMPL_DATA_DIR`), they stay in `schedule/<id>/`. They are deleted once the answer is read, kept after a failure for the diagnosis, and wiped on the next start.

The data of a run is archived in `runs/<run-id>/`, under the [data directory](#configuration) (`console/data/` from the repository):

- `run.json` holds the state, the agents and the activity;
- `terminal.log` holds the raw output of the terminal;
- `artifacts/` holds the documents generated during the run: plans, QA reports, reviews and captures;
- `evidence/` and `acceptance/` keep each version of the evidence, their captures and the coverage summary.

This directory is local and ignored by Git. It can contain confidential information from the tickets processed and must not be shared.

A run the server could not close itself (a hard stop, a restart) is reclassified `failed` on the next start, and does not stay marked `running`. See `console/README.md`.

## Tests

From the `console/` directory:

```bash
npm run test:unit
npm run test:integration
```

The unit tests use Jest. They are split by responsibility in `tests/unit/` and follow the convention `describe(...)` then `it("should ...")`.

The integration tests are split by journey in `tests/integration/`. They use Playwright with Google Chrome and start an isolated server on port `3211`. To watch them run:

```bash
npm run test:integration:headed
```

GitHub Actions runs the TypeScript check, the unit tests, the production build and the integration tests on each pull request and each push to `main`.

## Development

```bash
cd console
npm install
npm run dev
```

Frontend changes are reloaded. A change to the server needs `npm run dev` started again, and an `impl` already running has to be restarted with `impl restart` to serve the new build.

Checks:

```bash
npm run typecheck
npm run build
```

The frontend uses Next.js, React, TypeScript, Tailwind CSS and xterm.js. The local server uses `node-pty`, WebSocket and the Claude Code hooks.

## Repository contents

```text
agents/       Claude Code subagents
commands/     the commands /implementation-harness:implement, /implementation-harness:review, /implementation-harness:improve, /implementation-harness:rebase and /implementation-harness:schedule
hooks/        events sent to the local harness, and the guard that refuses a few tool calls during a run
bin/          the impl launcher and the impl config command
console/      Next.js interface and PTY server
console/server/engine/  the layer that isolates the driven agent, one implementation: claude-code
contracts/    output formats of the agents and evidence rules
principles/   decision rules common to the agents
skills/       methods loaded when needed
docs/         how agents, skills and review are organised, architecture diagram (architecture.html)
install.sh    installation and creation of the global commands
install-remote.sh  clone or update from the curl command
```

`/implementation-harness:implement` uses two MCP servers. Playwright is used by the developer to measure its work in the browser, then by the design review and QA. Figma is used only if the ticket provides frames. Without Figma, the design review compares the change with the mockups attached to the ticket or with the screens already shipped. A missing MCP reduces the corresponding checks but does not prevent the harness from starting.

A typical run opens several browser sessions: the developer agent measures its own work, then the design review and QA go over it again. Declaring the Playwright MCP server with `--headless` keeps a Chrome window from taking the foreground each time. It also rules out a measurement error: in windowed mode, the browser silently clips a requested viewport wider than the screen, and the measurement is reported against the requested width instead of the width obtained.

```json
"playwright": { "type": "stdio", "command": "npx",
                "args": ["@playwright/mcp@latest", "--headless"] }
```

The only case that needs the opposite is a journey where the user has to act in the browser, typically a login done by hand. Removing `--headless` brings the window back.

## License

Implementation Harness is distributed under the [MIT license](LICENSE). Copyright © 2026 Gregory Klein.
