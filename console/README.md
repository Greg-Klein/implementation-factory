# Implementation Harness

Local interface for driving the `/implementation-harness:implement` command with the Claude Code executable installed on the machine. The harness does not use the Anthropic API directly and needs no API key. The [main README](../README.md#one-command-installation) covers installation and day-to-day use with `impl`.

The interface is in English. Labels and messages are quoted here as they appear on screen. The language of what the workflow writes (reports, questions, merge request text) is chosen by the `IMPL_LANGUAGE` setting (`en` by default, `fr` for French).

## Requirements

- Claude Code installed and logged in (`claude --version`)
- Node.js 22.12 or later
- `glab` installed and authenticated to reach GitLab tickets and merge requests, `gh` to reach GitHub issues and pull requests (one is enough)
- the MCP servers the workflow uses: Playwright for the developer's measurements, the design review and QA, Figma when a ticket provides frames

`node-pty` is a native module. On a new machine, installing it may need the system's build tools, for example the Xcode Command Line Tools on macOS.

## Start the console

From this directory:

```bash
npm install
npm run dev
```

Then open <http://127.0.0.1:3210>.

Enter the local path of the project and the ticket URL. Several URLs, one per line, start a batch (see [Batch of tickets and scheduling](#batch-of-tickets-and-scheduling)). The harness creates a git worktree of the project for the run (`<project>/.claude/worktrees/<run id>`, see the [main README](../README.md#one-worktree-per-run)) and starts Claude Code in it with the neighbouring plugin:

```bash
claude --plugin-dir /path/to/implementation-harness "/implementation-harness:implement <ticket>"
```

The command and the agents stay in the `implementation-harness` directory; nothing is installed in `~/.claude`.

## What the panels show

The conversation panel is read from the session transcript, and Claude Code writes a message there only once the action that followed it has returned. A paragraph can therefore arrive a minute later than in the terminal, which is the only live view. While the session produces output, the panel shows "Claude is writing…" to say that the last visible message is not the latest state of the run.

In a directory Claude Code has never opened, the session starts with its trust prompt, before any hook and any transcript. The console recognises it in the terminal output and shows it in the conversation as a decision: "Claude Code asks to trust this folder", the path, then "Trust and continue" or "Decline". It never answers for you, writes to no Claude Code configuration file and passes no flag that skips the question: it types into the terminal the answer you chose. The card disappears as soon as the prompt is no longer on screen, whether you answered here or in the Terminal tab. A refusal closes the session, and the run ends "Stopped" with its reason, with no incident. The detection is written for the wording of Claude Code 2.1.288 (`server/engine/trust-prompt.ts`): if a version rewords it, nothing shows and the answer is given in the Terminal tab, as before.

The activity feed keeps only the milestones of the workflow: agents, documents, branch, merge request, pending decisions. The detail of the commands stays in the terminal.

The harness asks for attention only when it is stopped: a pending decision, a permission request, an incident (no action in progress any more, a missing result, an interrupted session), the end or the failure of the run. Silence alone is only a doubt, flagged once.

## Who can move this run forward?

The health of a run is a projection separate from its status (`server/run-health.ts`, pure logic, injected clock). It reads only structured signals: the end of the pilot's turn (`Stop`), the start and end of subagents, tool calls paired by `tool_use_id` and attached to their agent (`agent_id`), the type of the notifications (`permission_prompt`, `elicitation_dialog`), background calls (`run_in_background`, `Monitor`), archived documents, and `workflow-state.json`, which the pilot writes at each transition to say what it is waiting for (contract in `commands/implement.md`, section "Workflow state"). Terminal output, a spinner included, is never progress.

| Situation observed | Health | What the console shows |
|---|---|---|
| A question, folder trust, a permission or an input is awaited | waiting | the question or trust panel, or "Open the terminal" |
| An agent, a command or a background task is working | healthy or waiting | nothing; past the silence threshold, a doubt |
| Prolonged silence (`IMPL_STALL_MINUTES`, 10 by default) | doubt | "No progress observed", without stopping or restarting anything |
| The pilot handed back, nothing runs, nothing is awaited, the workflow is unfinished | incident after 60 s | "Nothing in progress" |
| An agent ended without the file its contract requires, and nobody took over | incident after 30 s | "QA report expected", "QA test plan expected", "Design inventory expected", "Report of T3 expected"… |
| No remaining task can run (missing or circular dependency) | incident | "Plan blocked by its dependencies" |
| The session exited before a result, whatever its code | interruption | "Session interrupted" |

The required files are `planner-output.json` for `ticket-planner`, `qa-report.md`, `qa-evidence.json` and `qa-plan.md` for `qa-reviewer`, `designer-review.md`, `design-evidence.json` and `design-inventory.md` for `designer-reviewer`, `review-summary.md` for `review-orchestrator`.

A wait declared in `workflow-state.json` never hides a block for long: `await_agent` with no active agent is still an absence of next action, the other waits become a doubt at the silence threshold. A declared end is accepted only if it holds against the deliverable (merge request seen, or blockers written). Without this file (older prompts), the detector relies on the hooks alone and says so in its diagnosis. After the machine sleeps, every grace period restarts from the wake-up.

An incident is unique per stable cause (fingerprint), notified once, recorded in `run.json` and closed only on the event that lifts its cause: the pilot acts again, the file arrives, or the user dismisses it. The actions offered are only the ones that can run:

- **Ask to continue**: active session, pilot idle, no agent, tool, question or permission in progress. The console submits to the existing session an instruction asking it to read the context, the plan, the reports and the Git state again, to keep files and commits, and not to start over from step 1. The incident stays open, "continuation requested", until the resumption is observed.
- **Open the terminal**, **Stop**, **Dismiss as a false positive** (with a reason), and the collapsible diagnosis.

Each action is sent with the revision of the incident shown and a request identifier. The server checks everything again right before the effect, refuses an action decided on a state that has moved, and runs only once a request sent by two windows. The decision is written before the effect; after a stop between the two, it stays "outcome unknown" and is never replayed.

On restart, a run found in progress gets one interruption incident, once, and its question without a session is kept as context. Runs left with an open incident appear under "Interrupted", read-only, through separate routes (`/api/archive/…`). They have no session, no slot and hold no ticket. Dismissing them removes them from the list; their archive stays on disk. A run with no open incident whose worktree is still on disk appears separately, under "Kept worktrees" (see [Worktree of a run](#worktree-of-a-run)). `/?demo=incident` plays a run whose pilot hands back with nothing next, to see the detector and the continuation without a repository. `/?demo=batch` plays a batch of three invented tickets, two of them in conflict.

Limits: no resumption of a lost Claude Code session (the engine contract does not allow it yet), no LLM supervisor, no agent recreated automatically.

## Evidence per acceptance criterion

The Evidence tab shows what was verified, criterion by criterion. It starts from the register of criteria the pilot writes after clarification (`.claude/tasks/acceptance-criteria.json`), from the links between tasks and criteria in the plan (`criterion_ids` in `planner-output.json`) and from the evidence files (`dev-evidence*.json`, `qa-evidence*.json`, `design-evidence*.json`). The register is described in `commands/implement.md` ("Write the acceptance criteria registry"), the evidence files in `contracts/` (`evidence.md`, `qa.md`, `design.md`, `pilot-evidence.md`).

Each criterion takes a state computed by the server (`server/acceptance.ts`), in this order of priority:

| State | When |
|---|---|
| Failed | a required check has a negative result on the current code, or on an unknown version |
| Blocked | no failure, but a required check is prevented by a named obstacle (`blocker`) |
| Unverified | a check has no evidence, its evidence is old, of unknown version, inconclusive, confirms evidence that is absent, or an earlier failure was not explicitly replaced |
| Verified | every required check has a positive result taken on the current code, with no failure left beside it |

Rules that follow:

- A task marked "Completed" in Tracking means a report exists, never that a criterion is verified. A green lint or typecheck is a general check, attached to no criterion.
- A success replaces a failure only if it names it in `supersedes`, checks the same thing and was taken on the current code. Otherwise the failure stays shown and the criterion unverified.
- The version of the code is the identifier `hooks/code-snapshot.mjs` computes: the git tree of the working directory, untracked files included, ignored files and workflow documents excluded, computed in a throwaway index. Committing the measured state keeps the same identifier, any modification changes it. The workflow calls it through `IMPL_CODE_SNAPSHOT` and each call is logged in `snapshots.jsonl`; an identifier absent from that log is shown as "Unknown version". The server recomputes the current identifier at each new document and at most every 15 seconds when the tab asks for it.
- A result the developer reports on its own work carries the note "Reported result"; a confirmation is worth what it confirms, on the version where that evidence was taken.
- A break attempt is a QA evidence item marked `"kind": "attempt"`. When it finds a defect (`fail`), it counts against the criterion it cites. When it finds nothing, it is listed under that criterion with the note "No defect found", with no green colour and without counting as a verification. An attempt only read in the code is shown as "Read, not executed". An attempt that cites no criterion produces a warning in the diagnosis.
- The verdict QA declares in `qa-evidence.json` (`status`) appears in the summary of the tab: "Passed", "Passed with warnings", "Inconclusive" or "Failed", with the round and the mandate if there is one. The server compares this verdict with the evidence (`qaVerdictConsistency`). A `PASS` or `PASS_WITH_WARNINGS` written while a criterion has no observation executed by QA on the current code shows a warning that names those criteria. A confirmation, an attempt and replaced evidence do not count as an observation. A focused pass (`mandate` at the root of the file) answers only for the criteria of its mandate.
- The server records the first arrival of each document of the run (`artifactArrivals` in `run.json`). When `qa-plan.md` or `design-inventory.md` did not arrive before the corresponding report, the tab shows a remark: nothing shows that the plan was written first. This remark changes no verdict. These two files do not move the step rail, because a reviewer writes them before starting.
- A run without a register (an older run still on the old contract) shows "Traceability per criterion unavailable for this run" and keeps its reports readable. Criteria rebuilt from an old plan are flagged as such and stay unverified.

`server/evidence-archive.ts` archives each useful version of these files under an immutable path, with its hash and the date it was received, and copies into that version the captures it cites: a capture replaced in round 2 under the same name stays distinct from the one of round 1. The same evidence seen twice (a per-task file then a merged file, a `-roundN` copy) counts once thanks to its identifier. A file caught half written becomes a diagnosis and the last valid version stays in force. Before deleting `.claude/tasks/`, the workflow writes `archive-sync-request.json` and waits for `archive-sync-ack.json`: the server has then archived everything again.

The same computation produces `acceptance-summary.md` and `acceptance-summary.json`, which the server puts in `.claude/tasks/` for the merge request: a one-sentence summary and the unverified criteria for the description, the detailed table for the review comment. When the QA verdict contradicts the evidence, the summary contains a line "QA verdict to confirm" and the JSON a `qaWarning` field. The captures are named there by their local path and marked as such, because the workflow links them in GitLab only after upload.

Limits of this version: no command is yet correlated to its result by the engine's events, so every result is still declared by the agent that writes it; the server cannot check the content of a piece of evidence, only its consistency and its version.

## Worktree of a run

Each ticket run works in its own git worktree, `<project>/.claude/worktrees/<run id>`, which the server creates before opening the session. The [main README](../README.md#one-worktree-per-run) describes what the worktree takes from the main checkout. Demo mode creates none.

Several tickets of one repository run in parallel. The lock is on the pair repository and ticket: a second launch on a ticket already running goes to the queue with the reason "ticket already running", and starts when the run holding that ticket has given up its session. `IMPL_MAX_CONCURRENT_RUNS` still bounds the total number of sessions. Two tickets of a batch that the analysis judges in conflict do not run together (see [Batch of tickets and scheduling](#batch-of-tickets-and-scheduling)).

Two settings decide what the worktree takes from the main checkout:

| Variable | Effect | Default |
|---|---|---|
| `IMPL_WORKTREE_DEPENDENCY_DIRS` | names of the dependency directories Git ignores, taken at any depth: copied copy-on-write, linked with a symbolic link if the copy fails | `node_modules` |
| `IMPL_WORKTREE_COPY_FILES` | files copied: a name pattern such as `.env*` for files Git ignores, or a path from the root of the repository | `.env*,.claude/settings.local.json` |

The session receives `IMPL_RUN_WORKTREE`, `IMPL_SOURCE_REPOSITORY`, `IMPL_SOURCE_BRANCH` (absent when the main checkout is on a detached HEAD) and `IMPL_WORKTREE_DEPENDENCIES`: `symlink` as soon as one dependency directory is linked, `clone` when all are copied, absent when none was brought over.

A `node_modules` brought over is compared with the `package-lock.json` beside it, as the worktree checked it out: a top-level package missing or installed at another version, optional ones aside, means the main checkout was not reinstalled after a lockfile change. The activity of the run then shows "Dependencies behind the lockfile" with the first packages concerned, and the session receives `IMPL_WORKTREE_DEPENDENCIES_STALE` with the directories, which the workflow reinstalls before its first agent. Other package managers are not checked, and a lockfile that cannot be read is reported as "Dependencies not checked against the lockfile".

Once the session is closed, the server decides what happens to the worktree (`worktreeRemoval` in `server/domain.ts`, pure logic). It removes it on its own when the run is over, the merge request exists and is not a draft, the workflow is not blocked, the evidence archive has been confirmed, the tree is clean and HEAD is on a branch of the remote. Otherwise the state of the run becomes "Worktree kept" with the reason. The branch is never deleted.

A kept worktree is removed from the run view, with the **Remove the worktree** button, as soon as the session is closed. The page sends `worktree.remove` and receives `worktree.result`: `removed`, `refused` with the reason, or `confirm` with what would be lost (uncommitted changes, unpushed changes). The removal then happens only after confirmation. The server only removes a path directly under `.claude/worktrees/`.

A run closed or read back after a restart stays listed under "Kept worktrees" while its worktree is on disk. On start, before listing the archives, the server applies the same rules to the worktrees of earlier runs. A worktree whose session was cut by the console stopping is marked kept at the stop, and decided on at the next start.

## Batch of tickets and scheduling

The [main README](../README.md#launch-several-tickets-at-once) describes the use: pasting a batch, reading the queue, forcing a start. This section describes what the server does.

### Batch intake

As soon as the ticket field holds two URLs, the form sends `batch.submit` (`issueUrls`, `instruction`). `lib/ticket-urls.ts` reads the paste the same way in the form and on the server. `server/ticket-source.ts` resolves each URL to its main checkout. It is the only module that knows the batch was pasted, and the place where a retrieval by label or assignee would plug in later. An invalid URL refuses the whole batch. A ticket with no checkout queues nothing: the server answers `batch.unresolved` with the tickets concerned, the form asks for the repositories their merge requests go to, and sends the batch again with `targets` (ticket URL to checkout paths).

A ticket filed in a project that holds no code goes to the repositories the user chooses: one run per repository, each in its own worktree. For a single ticket the form shows the choice as soon as the detection finds no checkout; one repository starts with `run.start`, several go through `batch.submit`. The watcher can name them in `repositories` (`contracts/ticket-proposals.md`), and a watcher ticket refused for lack of a checkout can be sent from the list with `proposal.launch` (`issueUrl`, `repositories`). When the run's repository is not the ticket's project, or there are several, the session gets `IMPL_DELIVERY_PROJECTS` (`deliveryProjects` in `server/domain.ts`): the merge request names the ticket by its full reference, and with several projects none of them closes it.

The registry receives a list of resolved tickets (`enqueueBatch`). It drops the ones it already has, on the key repository and ticket, the others enter the queue under one `batchId`, and the page receives `batch.result` (`accepted`, `duplicates`).

Tickets an outside watcher found take the same path as soon as they are read: `server/ticket-proposals.ts` reads the watcher's file, `registry.launchProposals` resolves each ticket on its own (`resolveProposedTickets`) and calls `enqueueBatch` (format in `contracts/ticket-proposals.md`).

### Analysis

For each repository that has at least two new tickets, or one new ticket beside predictions already known, `server/schedule-analysis.ts` writes `input.json` in the analysis directory (`scheduleRoot`, see below) and asks the engine for a session with no terminal (`startSchedule`):

```bash
claude -p --plugin-dir <plugin> --model sonnet --permission-mode dontAsk \
  --allowedTools "<closed list, read-only>" -- "/implementation-harness:schedule <input> <output>"
```

The full list of arguments is in `scheduleArguments` (`server/engine/claude-code.ts`). The session runs in the main checkout, without the hook variables, so it reports nothing to the console. Its exit code is not read. The server judges the result on `output.json`, validated as a whole against `contracts/schedule.md` (`validateSchedule` in `server/domain.ts`). The analyses of one repository run one after the other, outside `IMPL_MAX_CONCURRENT_RUNS`.

| Outcome of the analysis | Effect |
|---|---|
| Valid file | the predictions and the edges are kept, the analysis directory is deleted |
| File missing, unreadable or refused | tickets marked "Analysis failed", in conflict with every ticket of their repository |
| Timeout exceeded (`IMPL_SCHEDULE_TIMEOUT_MINUTES`, 5 by default) | session killed, same fallback |
| Console stopped during the analysis | same fallback at the next start |
| `low` confidence on a ticket | "Unreliable prediction", this ticket runs alone on its repository |

Tickets whose analysis failed and that are still queued, running or waiting for their merge go into the next analysis of their repository, as tickets to predict and not as `known`. Their prediction is replaced if it succeeds, and they stay failed otherwise. No analysis is opened for them alone.

Each analysis has its `<id>/` directory under `scheduleRoot` (`server/config.ts`). When the data directory is inside the plugin, `scheduleRoot` is `implementation-harness-<user>/schedule/` under the system's temporary directory, private to the user: Claude Code refuses a session any write in the directory of the plugin it loaded. A data directory outside the plugin (`IMPL_DATA_DIR`) keeps them under `schedule/`. After a failure, the analysis directory stays with `session.log`, the end of the session's output. `scheduleRoot` is emptied at each start. These files hold ticket content.

### Reasons for waiting

`describeQueue` (`server/domain.ts`, pure logic) gives each queue entry its reason, in this order:

| `reason` | Row shown | When |
|---|---|---|
| `ticket` | "Waiting, ticket already running" | a run holds the same ticket |
| `slot` | "Forced start, as soon as a slot is free" or "Stacked start on …" | the entry was forced |
| `analysis` | "Analysis in progress" | the analysis session has not answered |
| `conflict` | "Waiting, conflict with #217 running" | a run in progress conflicts |
| `merge` | "Waits for MR !12 to be merged (#217)" | the merge request of a finished run is open |
| `merge_unknown` | "State of MR !12 unknown (#217)" | The forge could not be asked ("PR #12" on GitHub) |
| `dependency` | "Depends on #217, still queued" | a `depends_on` edge to an entry ahead of it |
| `order` | "Runs after #217" | another conflict with an entry ahead of it |
| `slot` | "Waiting, every slot is taken" | nothing else holds it |

`cause` says why two tickets are kept apart: `overlap`, `depends_on`, `analysis_failed` or `low_confidence`. `detail` carries the agent's sentence, or the server's for the last two causes, which says whether the failed analysis or the unreliable prediction belongs to the ticket that waits or to the other one. Only `slot` entries start (`startableEntries`), within the free slots. A held entry takes no slot and the ones after it go ahead.

### Merge request watch

When a scheduled run ends with a merge request, the registry keeps a watch (`MergeWatch`) and the tickets in conflict wait for the merge. `server/merge-watch.ts` asks GitLab with `fetchMergeRequestStatus` (`server/ticket.ts`):

```bash
glab api --hostname <host> projects/<project>/merge_requests/<iid>
gh api --hostname <host> repos/<owner>/<repo>/pulls/<number>
```

It is a call made by the Node server. **It opens no Claude session and uses no tokens.** It goes out every `IMPL_MERGE_POLL_MS` milliseconds (60,000 by default, an environment variable outside `impl config`), once per merge request and per interval, and only for the watches that hold a queue entry. With no ticket waiting, there is no timer and no call.

| Answer | Effect |
|---|---|
| `merged` | the watch is lifted, the held tickets go, banner "Merge request merged" |
| `closed` | same release, banner "Merge request closed without being merged" |
| `opened`, `locked` | the ticket keeps waiting |
| `glab` or `gh` failure (network, token, missing binary) | unknown state, the ticket stays held and the row turns orange |

A run that ends without a merge request releases at once the tickets that were waiting for it. A watch nothing waits on any more is forgotten after a week.

### Actions on the queue

| Message | Effect |
|---|---|
| `queue.force`, `mode: "base"` | the entry ignores the schedule and starts from the base branch as soon as a slot is free |
| `queue.force`, `mode: "stacked"` | the entry starts from the branch of the ticket it waits for; the session receives `IMPL_BASE_BRANCH` and its merge request targets that branch. Refused while that branch is not known |
| `queue.move` | puts the entry before another one, or at the end of the queue (`before: null`). A dependency always goes before the ticket that needs it |
| `queue.cancel` | removes the entry |

A forced entry is still subject to the per-ticket lock and to the number of slots.

### Persistence

`data/queue.json` holds `{ version: 2, queue, tickets, edges, watches }`. It is written whole, then renamed. The old format, a plain array of launches, still loads. On start, the entries that were only waiting for a slot go, the ones waiting for a merge request keep waiting for it. Nothing from demo mode is written there.

### Limits

The unit tests inject the answers, and the integration suite replaces `claude`, `glab` and `gh` with the stand-ins of `tests/fake-claude/`. One real trial took place, on three tickets of a small test repository (see `docs/engineering-workflow.md`): the analysis, the `glab api` call of the watch and the release after a merge ran against a real GitLab. The stacked start and the forced start from the base only ran against the stand-ins, and no conflict has yet been found for real between two tickets both analysed without failure.

## Server architecture

| Module | Role |
|---|---|
| `server/index.ts` | HTTP and WebSocket server, lifecycle of the run |
| `server/registry.ts` | runs held, queue, per-ticket lock and number of sessions, state of the schedule |
| `server/ticket-source.ts` | where a batch comes from: today pasted URLs, resolved to their checkout |
| `server/ticket-proposals.ts` | tickets an outside watcher found, read from its file and queued as soon as they are read; the refused ones are kept with their reason |
| `server/schedule-analysis.ts` | one analysis session per repository, judged on its output file |
| `server/merge-watch.ts` | timer that reads the state of the awaited merge requests, with no Claude session |
| `server/ticket.ts` | `glab api` and `gh api` calls, by the forge of the address: title of a ticket, state of a merge request or pull request |
| `server/run-worktrees.ts` | worktree of a run, from its creation to its removal, and reconciliation on start |
| `server/worktree.ts` | git calls: run worktrees and self-improvement worktrees |
| `server/engine/` | **the only part that knows which agent is driven** (see its README) |
| `server/hooks.ts` | applies the engine's events to the state of the run |
| `server/session-prompt.ts` | the folder trust prompt: shown, answered, gone on its own, refused |
| `server/transcript.ts` | follows the dialogue file of the session |
| `server/artifacts.ts` | archives the documents produced before they are cleaned up |
| `server/acceptance.ts` | coverage of the acceptance criteria, consistency of the QA verdict, pure logic, and merge request summary |
| `server/evidence-archive.ts` | immutable versions of the registers, plans, evidence and captures of a run |
| `server/acceptance-runtime.ts` | ingestion, identification of the code, recomputation and summary handed to the workflow |
| `server/run-health.ts` | who can move a run forward: signals, detection matrix, pure logic |
| `server/run-incidents.ts` | life of an incident, validation of the actions, reading of the archives, pure logic |
| `server/run-monitor.ts` | single scheduler of the health of live runs |
| `server/run-archive.ts` | runs of an earlier process left with an incident or a worktree on disk, read-only, apart from removing the worktree |
| `server/workflow-state.ts` | reading of `workflow-state.json` and check of a declared end |
| `server/self-improvement.ts` | feedback, self-audit and improvement loop |
| `server/domain.ts` | pure logic, with no agent and no filesystem |

`server/domain.ts` and `server/engine/` are the two places testable without starting anything, and most of the logic is there.

## Copying to another machine

Copy or clone the whole `implementation-harness` directory, then run the install commands above in `implementation-harness/console`. The path of the repository to work on is chosen in the interface, so it can differ on each machine.

## Local data

Each run is kept in `console/data/runs/<run-id>/`:

- `run.json` holds the state, the agents and the activity log;
- `terminal.log` holds the raw output of the terminal;
- `artifacts/` receives a copy of the documents produced in `.claude/tasks/` before they are cleaned up. Only readable documents are copied there: the captures and the downloaded assets stay in the worktree of the run, under `.claude/tasks/assets/`, except the ones an evidence file cites;
- `evidence/` keeps each version of the register, the plan and the evidence files (`<file>/v<n>.json`), the captures of each version (`<file>/v<n>/assets/…`) and their index (`index.json`);
- `acceptance/` holds the latest coverage summary, in Markdown and in JSON;
- `snapshots.jsonl` logs each code identifier taken by the session.

`run.json` is written whole then renamed, one write after the other. A read therefore never sees a half-written file, and the last state published is the one that stays.

`data/queue.json` keeps the queue and its schedule. The files of a batch analysis in progress or failed are outside the plugin, in the analysis directory described above.

The `data/` directory is ignored by Git.

On start, the server closes every run left on a non-terminal status (`starting`, `running`, `attention`). The registry starts empty at each launch, so a run the previous process could not close itself (a hard stop, `impl restart`) would otherwise stay marked `running`. The server reclassifies it `failed` with a message that explains it, distinct from a failure of the agent.
