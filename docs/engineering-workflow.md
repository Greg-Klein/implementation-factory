# Agents, skills and independent review

The harness separates the responsibilities of the agents, the reusable methods and the formats the console consumes. The `commands/`, `agents/`, `skills/` and `hooks/` directories stay at the root of the plugin.

The [architecture diagram](architecture.html) shows the path of a run, the workflow, run health, batch scheduling and the self-improvement loop. It is a standalone HTML page, to open in a browser.

The console's interface is in English. The language of what the workflow writes (reports, questions, merge request text) is chosen by the `IMPL_LANGUAGE` setting (`en` by default, `fr` for French). Section names and fixed phrases are quoted here.

## Who owns what

| Layer | Responsibility |
| --- | --- |
| `commands/implement.md` | Steps, delegations, user interaction, git, delivery and archiving. |
| `agents/` | Mission, scope, decisions, rights, methods to load and deliverables. |
| `skills/` | Invocable procedures, with their references loaded when needed. |
| `principles/engineering.md` | Evidence, proportionality, simplicity, constraints and handling of unknowns. |
| `principles/test-quality.md` | The shapes of a test that cannot fail for a defect. Read by the author and by the code reviewer, only when the diff touches test files. |
| `hooks/guard.mjs` | Rules a tool call's input or a file listing decides, refused before the call runs. |
| `hooks/gate.mjs` | The checks an editing agent's own files call for, run again when it stops. |
| `contracts/` | Output formats, specification policy, handoff and identity of evidence. |

The principles and contracts are read explicitly from the plugin path. The `CLAUDE.md` of this repository documents the development of the harness; it is not meant to be injected into the projects the plugin drives. No proprietary YAML field for loading the principles is introduced.

## Capabilities and triggers

| Skill | Trigger | Result |
| --- | --- | --- |
| `how` | A behaviour poorly understood before planning, modification or investigation. | Sourced current model, boundaries and unknowns. |
| `why` | The historical reason or current relevance of a constraint has to be established. | Documented motivation, chronology and limits. Requires `how`. |
| `clarify-spec` | A contradiction between sources or a missing product decision. | Established requirements, assumptions and questions to pass to the pilot. |
| `self-check` | The developer checks its own implementation. | Coverage of the modified behaviours, tests, results and limits. |
| `collect-evidence` | Running checks already chosen. | Reproducible observations, commands, context and obstacles. |
| `review-change` | Independent code review or QA. | Counterexamples, substantiated defects and limits of verification. |
| `figma-review` | Design review of a change visible in the interface, with or without Figma. | Inventory, measurements that cite their reference, coverage, observations for QA and unverified cells. |
| `document-change` | Documentation made obsolete by an authorised change. | Update of the existing documentation and of the necessary decisions. |
| `glab-gitlab-api` | A GitLab operation chosen and authorised by the caller. | Adapted recipe and check of the result. |
| `gh-github-api` | A GitHub operation chosen and authorised by the caller, when the ticket is a GitHub issue. | Adapted recipe and check of the result. |
| `unslop` | Any text read by a person: report, summary, question, MR description or comment, ticket, documentation, free field of a JSON artifact. | Sentences without AI tics, format and language of the contract unchanged. |

`gitlab-tickets` keeps its Synapse conventions. These conventions do not become universal engineering principles.

Skills are called under their qualified name in the plugin, for example `implementation-harness:how`. The technical agents have dynamic skill discovery. The designer, which has no `Skill` tool, preloads only `implementation-harness:figma-review` and reads the references that skill cites. If the preload is missing, it first reads the entry of the skill. This documentary reading does not allow it to read the product code.

The native `skills:` field preloads the body of the skill. Putting it on every capability would move the text without reducing the context. The other methods and their references stay conditional. The agent's rights still bound any method loaded.

## Who owns each engineering concern

| Concern | Owner and method |
| --- | --- |
| Flow, state, invariants and consumers | Planner, developer and reviewers through `how` if necessary. |
| Historical motivation and compatibility | `why`, with a check of current relevance. |
| Requirements and assumptions | Planner and pilot through `clarify-spec`; the pilot settles with the user. |
| Decomposition and dependencies | Planner; shared files sequenced by the pilot. |
| Simplicity and conventions | Common principles; applied within the scope of the role. |
| Root cause and regression | Developer through `self-check`, then independent counterexamples through `review-change`. |
| Security and data integrity | Planner, developer and senior at the modified boundaries; QA for observable behaviours. |
| Concurrency, cancellation and resources | Targeted analysis of the transitions and owners; separate orchestration of the resources shared between agents. |
| Performance, migrations and rollback | Analysis proportionate to the risk and to the real consumers, with no systematic audit. |
| Accessibility and selector contracts | Developer and QA, which tests the keyboard path, the focus and the accessible name when the change touches them. The designer measures contrast, keyboard path, visible focus, role and name, target size on the modified surface. |
| Fidelity to the design reference (`figma`, `ticket-mockup` or `live-neighbours`) and responsive behaviour | Designer through `figma-review`, when the pilot triggers the design review and the app is reachable, with observation of the frame and correction limited to the ticket. |
| Documentation and decisions | `document-change` within the authorised write scope. |
| Reproducible results | `collect-evidence`; interpretation separate for each role. |
| Freshness and traceability | Evidence contract, snapshots, immutable identifiers and supersession. |

Standalone impact analysis and dedicated bug diagnosis remain possible evolutions. Their principles are applied in the current roles; no new mandatory step is added for them.

## Independence of the review

The developer's self-check method is not the review plan. Reviewers start from the specification, the consumers and the code; they state their expectations and their counterexamples before looking at the author's conclusions. The senior records this initial baseline in its report. QA writes it in `qa-plan.md` and the designer in `design-inventory.md`, before opening the author's reports, which the brief passes only by path. They then compare their results with those reports.

`collect-evidence` can be shared: it describes how to run a check and keep the result, without choosing the scenarios or judging whether they are enough. Sharing a recipe for reaching a state does not mean sharing the expected result; stubs and fixtures stay open to challenge.

The senior remains corrective, in two phases: independent diagnosis, then justified fixes. QA checks the final code after those fixes. At tier 0, a fix by the senior triggers a focused QA check, or stays explicitly unverified if the review budget prevents it. At tier 1, a rework made after QA gets the same focused pass on the criteria it touches.

Reviewers receive the author's evidence (`developer-report.md`, `dev-evidence.json`, `browser-recipe.md`, captures) by path. The brief never copies their values. Once its plan is written, QA also reads the `## To be checked by QA` section of the design review and the `## Remaining risks` section of the senior, passed by path, and tests them as hypotheses. These hypotheses do not bound its coverage.

Independence does not guarantee the absence of bias. A diagnosis already present in the brief is declared as such, then a competing explanation is examined. Reworks necessarily expose the findings of the previous round. No quota of defects is imposed.

## Review tiers

The pilot picks the tier from the size of the diff (step 7 of `commands/implement.md`).

| Tier | Sequence | Reviewer model |
| --- | --- | --- |
| 0 | One pass of `senior-reviewer`, with no orchestrator and no rework loop. The pilot runs the general checks itself. | Sonnet, by override at the call. |
| 1 | `senior-reviewer`, then `designer-reviewer` if the pilot triggered the design review and the application is reachable, then `qa-reviewer`, once each. The pilot chains the agents and does for them what the orchestrator does at tier 2. | Sonnet, by override at the call. |
| 2 | `review-orchestrator` runs the full loop. | Opus, the default model of `senior-reviewer` and `qa-reviewer`. The orchestrator passes no override. |

`designer-reviewer` runs on Sonnet, its default model, at every tier: its work is mostly measurement.

The caller of the designer takes the code snapshot identifier before and after the review, then publishes `design-evidence.json`. When the diff adds or modifies test files, the caller of QA creates the disposable worktree and removes it when QA returns. At tier 2 the caller is the orchestrator, at tiers 0 and 1 the pilot. Creating and removing this worktree are the only git operations of the orchestrator. This disposable worktree is created outside the repository, in a temporary directory, never under `.claude/worktrees/`, and the caller removes only that one.

## Run worktree

Launched from the console, each run works in its own git worktree of the target repository. The console creates it before opening the session, in `<repository>/.claude/worktrees/<run id>`, detached at the HEAD of the main checkout, and starts Claude Code in it. Several tickets of the same repository can therefore run at the same time. A second launch on a ticket already running waits in the queue. If the worktree cannot be created, the run does not start.

The console passes these variables to the session:

| Variable | Value |
| --- | --- |
| `IMPL_RUN_WORKTREE` | The worktree of the run. |
| `IMPL_SOURCE_REPOSITORY` | The main checkout. |
| `IMPL_SOURCE_BRANCH` | The branch of the main checkout at launch. Absent on a detached HEAD. |
| `IMPL_WORKTREE_DEPENDENCIES` | `symlink` as soon as one dependency directory is a link, `clone` when all are copies. Absent when none was brought over. |
| `IMPL_WORKTREE_DEPENDENCIES_STALE` | The dependency directories, comma separated, whose install does not match the `package-lock.json` beside them: a top-level package missing or at another version. The pilot reinstalls them before the first agent. Absent when all match, and for a directory with no npm lockfile. |

| Item | In the worktree |
| --- | --- |
| Ignored dependency directories (`node_modules` by default, setting `IMPL_WORKTREE_DEPENDENCY_DIRS`) | A copy of those of the main checkout, copy-on-write when the filesystem allows it: an install there stays in the worktree. A symbolic link only if the copy fails. |
| Ignored files `.env*` and `.claude/settings.local.json` (setting `IMPL_WORKTREE_COPY_FILES`) | Copied from the main checkout. |
| Ignored entries of a hooks path inside the repository (`core.hooksPath`, such as husky's `.husky/_`) | Copied from the main checkout, so the hooks the commits run find their helper. |
| Build outputs (`.next`, `dist`) | Nothing is provided. The first build happens in the worktree. |
| `.claude/tasks/` | Specific to the run, in the worktree. |

The `.claude/worktrees/` directory and the links are added to the repository's `.git/info/exclude` and never enter a commit.

Rules `commands/implement.md` applies in this mode (section "Run worktree"):

- The pilot stays in the worktree from start to end. It does not write, stash (`git stash`) or switch branches anywhere in the main checkout. It runs no `git stash` at all: the list of stashes is common to every worktree of the repository.
- The ticket's branch is created without going through the base: `git fetch origin`, then `git switch -c <branch> --no-track origin/<base>`. `git checkout <base>` fails in a linked worktree as soon as the main checkout holds that branch. When the base does not exist on the remote, the branch starts from the local reference.
- A ticket branch that already exists is never overwritten (`-B` and `--force` are forbidden). If it is checked out in another worktree, the pilot takes a suffixed name. If it exists only locally or on the remote, it asks the user whether to continue on it or take a suffixed name.
- A dependency directory that is a symbolic link is never modified through the link. `IMPL_WORKTREE_DEPENDENCIES` says whether there is a link, and `test -L node_modules` checks it when the variable is absent. If the task adds, removes or updates a dependency, or if the lockfile differs from the base, the developer first replaces the link with a real install in the worktree. Otherwise the install would modify the main checkout and the runs in parallel. The rule is in `agents/developer.md` and in `skills/collect-evidence/references/commands.md`, which those who run the checks read.
- Two runs of the same repository may fight over the port of the development server. The pilot starts the application on a free port and passes the real URL to the reviewers, who never use the default port on their own initiative.
- The pilot removes neither the worktree of the run nor the ticket's branch. The console removes the worktree after the session ends, when the run is over, the merge request exists and is not a draft, the workflow is not blocked, the archive sync has received its answer, the tree is clean and HEAD is on a branch of the remote. The archive sync therefore stays before the deletion of `.claude/tasks/`. In every other case, the console keeps the worktree with the reason and offers its removal to the user, with a confirmation when work would be lost. It never deletes the branch. On start, it applies the same rules to the worktrees of earlier runs.

Without `IMPL_RUN_WORKTREE`, that is when the plugin is used without the console, the sequence in the checkout is unchanged. One exception: a session already placed in a linked worktree (`git rev-parse --git-dir` and `--git-common-dir` differ) applies the same rules.

## Scheduling a batch of tickets

`commands/schedule.md` compares the tickets of a batch before they are launched. The console calls it when several ticket URLs are pasted in the form, once per repository and per batch.

The command runs with no terminal (`claude -p`, Sonnet), from the main checkout. It receives two absolute paths: an input file written by the console and the output file to write. The contract of both files and the validation rules are in `contracts/schedule.md`.

- The input lists the tickets to predict (`tickets`): the new ones, and those of the repository whose earlier analysis failed. It also lists the predictions already made for the tickets queued, running or waiting for their merge (`known`). The known predictions are used for the comparison and are not computed again.
- The `ticket-scheduler` agent (Sonnet) reads each new ticket with `glab` or `gh`, looks in the repository for what the ticket would touch, then writes for each one files, areas, a confidence and a one-sentence summary.
- It links with an edge two tickets that cannot run at the same time. `overlap` flags common files or a narrow common area. `depends_on` flags that one ticket needs the result of the other, from a GitLab "blocks" link or the text of the ticket, and gives the order. Two tickets of the same large module with no common file have no edge.
- The console also reads the blocking links itself, with one `glab api` or `gh api` call per ticket and no session (GitLab "blocks" / "is blocked by", GitHub "blocked by" / "blocking"). A link between two tickets it has in the same repository is a `depends_on` edge that replaces whatever the agent said of that pair, and holds when the analysis failed. A ticket started alone beside other tickets of its repository gets this reading and no session. Links that cannot be read change nothing.
- A `low` confidence means the ticket allows no prediction. The console then treats it as in conflict with every ticket of the repository.
- The agent modifies nothing in the repository: no edit, no branch switch, no install. The output file is the only file written, outside the repository and outside the plugin: Claude Code refuses a session any write in the directory of the plugin it loaded. The console therefore puts both files in a directory of the system's temporary directory, private to the user, or under `schedule/` when the data directory is outside the plugin (`IMPL_DATA_DIR`). Ticket content goes into no tracked file.
- An empty batch gives `{ "tickets": [], "edges": [] }` without starting the agent. An output that does not follow the contract after one retry is deleted, and the console reads a missing file as a failed scheduling.

### What the console does with the result

The detail of the modules is in `console/README.md`, section "Batch of tickets and scheduling".

- The console starts no analysis for a ticket alone in its repository when no prediction is known there. A ticket added beside tickets already predicted is analysed, even when launched alone.
- The analyses of one repository run one after the other and take none of the slots of `IMPL_MAX_CONCURRENT_RUNS`. The timeout is `IMPL_SCHEDULE_TIMEOUT_MINUTES` (5 minutes by default). Past it, the session is killed.
- The console does not read the exit code. It validates the output file as a whole and refuses it at the first rule of the contract that fails.
- A missing or refused file, an exceeded timeout or a stop of the console during the analysis mark the tickets as failed analysis. A ticket whose analysis failed, like a `low` ticket, conflicts with every ticket of its repository: they run one at a time. The next analysis of the repository takes the failed tickets still queued, running or waiting for their merge, and replaces their prediction if it succeeds. No analysis is started for them alone.
- Two tickets of different repositories never conflict, whatever the edges say. That rule is in the console, not in the agent.
- A ticket in conflict with a run in progress waits. When that run ends with a merge request, the ticket waits for it to be merged. A merge request closed without a merge, or a run ended without a merge request, releases the ticket.
- For a `depends_on` edge, the first ticket of `order` goes ahead of the second in the queue.
- A held ticket takes no slot. The tickets behind it that conflict with nothing start.

Watching the merge requests uses neither this command nor any agent. The Node server calls `glab api`, or `gh api` for a pull request, every 60 seconds (`IMPL_MERGE_POLL_MS`), only for the merge requests a queued ticket is waiting for. That call opens no Claude session and uses no tokens. A failed call gives an unknown state, which holds the ticket like an open merge request.

The user can override from the queue: a start from the base, which ignores the schedule, or a stacked start, described below. The user can also change the order of the queue or remove a ticket from it.

### Stacked start

A ticket held by another one can start before the first one's merge request is merged. It is a decision of the user, taken in the queue ("Stack on `<branch>`"), never a choice of the console. It is offered when the branch of the first ticket is known. The console then passes `IMPL_BASE_BRANCH`, the name of that branch.

- `commands/implement.md` does not ask the base branch question at step 2. The base is that branch.
- Step 3 creates the ticket's branch from `origin/<base>` after the fetch, or from the local reference, with the rules of the run worktree. The pilot never checks out the base branch and does not write to it. If it exists neither on the remote nor locally, it stops and says so.
- The merge request targets that branch. Its description says it is stacked and on which branch.
- The description carries `Closes #<iid>` despite the target. When the first merge request is merged and its branch deleted, GitLab retargets the second to the branch the first was merged into. It closes the ticket only when the commits reach the default branch. Any other target that is not the default branch keeps `Related to`.
- On GitHub the retargeting only happens when GitHub deletes the base branch itself, through "Delete branch" on the merged pull request or the repository setting that deletes head branches. A base branch deleted with `gh pr merge --delete-branch` or `git push --delete` closes the stacked pull request. Measured on a test repository on 2026-10-04.

Without `IMPL_BASE_BRANCH`, nothing changes.

### Base named by the watcher

A watcher can name the base of a ticket it found (`baseBranch` in `contracts/ticket-proposals.md`), usually the feature branch of its epic. The console passes it as `IMPL_TICKET_BASE_BRANCH`, unless the ticket is stacked.

- When the branch exists on the remote or locally, step 2 does not ask the base branch question and step 3 cuts the ticket's branch from it, with the same rules as any base.
- When it exists nowhere, step 2 asks the question and says so. The pilot never picks another base by itself.
- The merge request targets that branch like any base chosen at step 2: `Related to` when it is not the default branch, no stacked line.

## QA method

The contract is `contracts/qa.md`, the method `skills/review-change/references/behavioral-qa.md`. `qa-reviewer` declares its tools (`Bash`, `Read`, `Glob`, `Grep`, `Write`, `Skill` and Playwright) and has no `Edit`.

- QA writes `qa-plan.md` before opening an author's report. This plan holds the behaviour matrix per criterion, the classes of the risk grid the change triggers and the defect hypotheses, each with its trigger and the expected result.
- The risk grid has eight classes: user input, network call, persistent state, asynchronous work, data or migration, permissions, observable security, accessibility. The report says for each class whether it is tested, not applicable (with the reason) or not tested (with the obstacle).
- QA works in order of risk. The observations of the criteria and the break attempts come first, the general checks last. QA reuses a general check without running it again when the caller provides its result with the code snapshot identifier and that identifier is the one at the start of its session.
- Each criterion gets at least one executed break attempt. The attempts appear in the `## Break attempts` section of the report and in `qa-evidence.json`, as items with `"kind": "attempt"`. An attempt only read in the code does not count towards this minimum.
- A criterion is MET only on an observation QA executed in its session, on the delivered code. A reading of the code or the confirmation of a piece of the developer's evidence gives UNVERIFIED, unless the required check of the criterion has the `static_analysis` method.
- QA writes the report and the evidence after each block of work, so a stop leaves a usable result. Until the last block, the verdict written is `INCONCLUSIVE`.
- The `## Rapprochement` section says what the plan, the reports of the developer and the senior and the hypotheses passed on added or changed compared with `qa-plan.md`.
- A focused pass receives a mandate: criterion identifiers, or the behaviour a fix changed. The plan, the tables, the minimum of attempts and the verdict cover only that mandate. The other criteria are listed HORS MANDAT and `qa-evidence.json` cites the mandate in a `"mandate"` array at its root.

QA always receives from its caller the base reference and `git diff --stat <base>...HEAD`. It also receives a disposable git worktree when the diff adds or modifies test files, that is files the repository's test runner collects. There it reverts the fix or reinjects the defect to check that the new or modified tests turn red: a test that stays green discriminates nothing and becomes a P1. There it also replays a failing command on the base, the only way to show that a failure is pre-existing. Evidence on the delivered code is still taken in the delivered checkout, that is the worktree of the run when it has one. Without a worktree, the probe is not applicable: it is neither an obstacle, nor a missing scenario, nor a warning. The comparison with the base is then unavailable, and a failing check counts against the diff.

The QA verdicts are `PASS`, `PASS_WITH_WARNINGS`, `INCONCLUSIVE` and `FAIL`. The verdict is `INCONCLUSIVE` when a criterion is UNVERIFIED, or when a criterion is MET with no executed break attempt and no named obstacle. A criterion only a deployed environment can show (production logs, a reading after the release) is marked `afterDeployment` by the pilot in the registry, before any plan exists: QA records it blocked with what to read after the deployment, and the verdict is then `PASS_WITH_WARNINGS` at best. The pilot marks it from the source text, never because a local access is missing.

## Design method

The contract is `contracts/design.md`, the method `skills/figma-review/`. Despite its name, this skill applies with or without Figma. The designer does not read the product code.

The pilot decides on the design review while sizing the review, from the diff, and announces its decision with its reason in one line. With Figma frames, the review happens as soon as the change is visible in the interface. Without Figma (levels `ticket-mockup` and `live-neighbours`), it happens only when the diff modifies a shared interface component or creates a screen or a route. A shared component is an interface file imported by more than one screen or route, or stored in the repository's shared interface or design system directories. A review outside the trigger is not a failed review: it gives no "design not verified" line.

| Reference level | Source | Severity |
| --- | --- | --- |
| `figma` | Frames provided and readable. | Full scale. |
| `ticket-mockup` | Mockups or captures attached to the ticket. | A gap established on the image alone is P2 at most, noted "to confirm". It becomes P1 or P0 when an objective check fails on the same element. |
| `live-neighbours` | 2 or 3 screens already shipped, and `design-reference.md` when the pilot provides it. | A gap is P1 at most. Neighbouring screens that disagree give no reference. |

The designer uses the highest level the brief allows and declares it at the top of the report. A property that level leaves open is judged at the next level. The pilot writes `design-reference.md` when the repository has token files, a brand document or a component library, with their paths and the useful values, so the designer does not open the source code.

- The designer writes `design-inventory.md` from the reference and the brief, before opening any author's evidence. It then measures each line itself, then compares its results with the developer's measurements.
- The objective checks apply at every level, without a design reference (`skills/figma-review/references/objective-checks.md`). They cover the layout invariants, the state matrix, the interaction design measurable in the browser, accessibility, themes, labels and consumer routes.
- The layout invariants (no horizontal scroll of the page, no text overflowing without ellipsis or scroll, no child outside its parent, no unintended overlap) are measured at each required width: those of the brief, otherwise 360, 768 and 1280, plus the exact width of each frame provided. They are measured with normal content, then with the longest plausible value, an empty value, and zero, one and several items.
- The state matrix covers eight states per modified interactive element: rest, hover, keyboard focus, active, disabled, loading, empty, error.
- Accessibility is measured on the modified surface: contrast (4.5 for text, 3 for large text, the outline of controls and focus indicators), keyboard path, visible focus, role and accessible name, target size of at least 24 CSS px.
- The dark theme and reduced motion are replayed when the application supports them. Their absence is noted in the method without becoming a finding.
- Each label of the inventory is compared with the string of the reference, case and punctuation included.
- The brief lists 3 to 5 routes that consume the shared components the diff modifies. The designer opens each one and adds none.
- Each finding cites its reference: Figma node, mockup file, neighbouring screen and measured value, token of `design-reference.md`, WCAG threshold or named invariant. A remark with no reference goes into "Observations without a reference", a non-blocking section limited to three lines.

The report contains a coverage matrix, with one row per screen, viewport and required state or content case. A cell is measured only if the designer reached it in the application, read its values and kept the pair of captures. The verdict is `INCONCLUSIVE` when a required viewport or an explicitly required state is not reached, when the measured coverage is under 80%, or when no reference level could be established.

A design verdict of `INCONCLUSIVE`, or a review triggered but not started because the application was unreachable, does not block READY. The review summary writes it under `## Design not verified` with the reason. The pilot carries the words "design not verified" into the merge request description, the review comment and the final report.

## What a repository's reviews teach its next runs

When developers make the same kind of mistake on several tickets of a repository, the senior reviewer finds it and corrects it on each ticket, and each correction costs a review round. The console keeps the findings per repository and tells the next developer about the kinds that came back, before it writes code.

1. The senior reviewer writes its findings as data in `.claude/tasks/senior-findings.json`, beside `senior-review.md`, under `contracts/review-findings.md`. Each finding is filed under one key of a fixed list (`consumer-left-behind`, `ui-state`, `test-gap` and sixteen others). Two reviews word the same defect differently, so free labels could not be counted across runs.
2. The console adds them to `data/repositories/<checkout>-<digest>/review-findings.json`, beside the runtime recipe, with the run and its ticket.
3. At the next launch on that repository, a kind found on at least two tickets in the last 90 days goes into `.claude/tasks/recurring-findings.md`, with its three latest examples, five kinds at most. The pilot passes the path to every developer.

A ticket counts once, however many rework rounds or runs it took. `other` never counts. The file adds no requirement and widens no scope: a developer checks its own change against the kinds listed. Reviewers do not receive it, because they form their expectations from the specification and the code, and a list of earlier findings would steer them.

The "Runtime recipe" window of a repository shows, under the recipe, how many findings are kept, from how many tickets, and each kind that recurs with its examples. "Forget the findings" deletes them all, and the next run then receives no file. A finding is deleted after 180 days.

## Rules enforced by a mechanism

A rule that needs no judgment is enforced by `hooks/guard.mjs`, called by `hooks/emit.mjs` on every `PreToolUse`, and the prompt keeps one line about it. The guard speaks only during a run of the workflow (`IMPL_RUN_ID` is set, or `.claude/tasks/workflow-state.json` exists). It refuses six kinds of call and gives the agent the reason:

- an agent of the workflow invoked under its bare name;
- a `developer` invoked with a model override other than `opus`, the model its definition declares;
- a reviewer or the review orchestrator started while a task of `planner-output.json` has neither its `developer-report-<id>.md` nor a line naming it in the merged `developer-report.md`;
- a `git commit`, or a `glab` or `gh` publication on a merge request, a pull request or an issue, whose command carries a `Co-Authored-By` or `Claude-Session` trailer, a session link or a "Generated with" line;
- a publication that shows a credential: a `git commit`, a `glab` or `gh` publication, or a `glab api` or `gh api` call that writes (`POST`, `PUT`, `PATCH`), when its command or a file it sends (`key=@file`, `--body-file`, `-F`, `$(cat file)`) holds a GitHub, GitLab, Slack or AWS token, an API key, a JWT, a private key or a bearer token. The refusal names the kind, the file and the line, and never quotes the value. A signed address counts, since anyone who reads the page can open what it points to. The check reads shapes of 20 characters or more, so a sentence about a password or a placeholder such as `<token>` passes. Images and videos are not read;
- a git command that destroys work: `git reset --hard`, `git clean -f` without a dry run, a checkout, restore or switch that discards the whole tree, a forced push without `--force-with-lease`, `git worktree prune`, the removal of a worktree under `.claude/worktrees/`. In a linked worktree, which is every run the console starts, it also refuses a stash other than `list` or `show`, and a branch deleted or overwritten (`branch -D`, `checkout -B`, `switch -C`, `--ignore-other-worktrees`).

The git rules read the commands typed on the line, word by word. A forbidden command quoted in a commit message or passed to a script is not looked at.

A refused call is not forwarded to the console. A guard that cannot read what it checks lets the call through. `commands/improve.md` asks for a mechanism before a new sentence whenever one can carry the rule.

## The stop gate

A developer report says its checks pass, and nothing verified that sentence. When `developer` or `senior-reviewer` stops during a run of the workflow, `hooks/gate.mjs`, called by `hooks/emit.mjs`, runs the checks its edits call for and writes each verdict to `.claude/tasks/gate-log.jsonl`. The pilot and the review orchestrator take the verdict from that file.

The files an agent edited are noted from its `Edit` and `Write` calls, per agent, and read off the working tree: when a gated agent starts while no other one is at work, the gate fingerprints every path git sees as changed, and at its stop every path whose content moved since counts as edited. Agents write most of their code through the shell (`sed`, a heredoc, a code generator), which no tool input shows. Two agents in one tree cannot tell their changes apart, so the fingerprint is not taken while a peer works and is dropped when one starts; a commit made while the agent worked voids it too. Documentation and YAML files (`.md`, `.markdown`, `.txt`, `.rst`, `.yml`, `.yaml`) are left out: no check reads them, and an agent that only edited those runs no check at all. For each package the other files belong to (the nearest `package.json` that is more than repository tooling):

| Check | Covers | Command |
| --- | --- | --- |
| type-check | the package | its `typecheck` or `type-check` script, otherwise `tsc --noEmit` (`tsc -b` for a solution-style `tsconfig.json`) |
| lint | the edited files | the local `eslint`, when the package or the repository has a configuration |
| related tests | the edited files | `vitest related`, `jest --findRelatedTests` or the `react-scripts` equivalent |

Each line of the file carries `at`, `agent`, `agentId`, `files` (the first twenty the agent edited, which tell a reader which task the line is about), `root`, `step`, `command`, `retry`, `handedBack` (only when true), `ms` (how long the check took, on the lines of a check that was started) and a `result`:

| Result | Meaning |
| --- | --- |
| `pass` | the check ran and passed |
| `fail` | the check ran and failed. With `retry: false` the agent was sent back with the output; with `retry: true` it was let go with the failure still there; with `handedBack: true` it had already handed its report back and was let go at once |
| `inconclusive` | every type error is outside the agent's files, and another gated agent was editing. The errors come from the half-written code of a parallel batch. The pilot's repository-wide gates settle them once the batch is over |
| `skipped` | the check could not run: tool missing, ten minutes exceeded, or the twenty minutes of the whole gate spent |
| `none` | nothing to run: no edit recorded for this agent, only documentation or YAML edited, no package above its files, or a package with no check |

Choices worth knowing before changing it:

- **It blocks once.** The second stop is always let through and recorded as it stands, so no agent loops on it. The gate keeps its own note of having sent an agent back, because Claude Code documents `stop_hook_active` only for the stop of the session.
- **It does not hold an agent that already handed back.** A background agent ends its turn with a `SubagentHandback` call, which delivers its report before its stop fires; a block then lands in a transcript the agent never reads again, and the stop it held never reaches the console, which shows the agent abandoned. The gate reads the agent's transcript (`agent_transcript_path`, otherwise `<session>/subagents/agent-<id>.jsonl` beside the session's), and when its last turn is that call it records the checks with `handedBack: true` and lets the stop through. The pilot or the orchestrator relaunches the work. A transcript it cannot read leaves the block as it was.
- **It fails open.** An error in the gate, a check that cannot run and a session outside a run all let the agent go. `IMPL_STOP_GATE=off` in the console's environment turns it off.
- **It runs the tests related to the edited files.** A legacy suite is often red on the base branch, and an agent blocked on a failure it did not cause learns to ignore the gate. The pilot runs the whole suite, on a tree nobody is editing.
- **A blocked stop is not forwarded to the console**, like a call the guard refuses, because the agent is still working.
- **The message gives results.** The agent definitions say a `stop gate` message is the output of the agent's own checks. An agent that was not told so treats a hook reason as text from outside and declines to act on it.

The gate has three limits. During a parallel batch it only sees the edits made through `Edit` and `Write`. It checks Node packages only. While a gate runs for more than `IMPL_STALL_MINUTES`, the console shows a doubt on the run.

## Runtime recipe of a repository

How the app of a target repository is started, reached and driven is the same from one ticket to the next. The pilot writes it to `.claude/tasks/runtime-recipe.md` under `contracts/runtime-recipe.md` at the end of a run that drove the app. The console keeps every version under `repositories/<checkout>-<digest>/runtime-recipe.md` in its data directory, outside the target repository, and puts it back in the task directory of the next run of that repository. The pilot reads it at step 1, checks what it relies on, and corrects the lines it found false. The file holds no secret and nothing specific to one run; `browser-recipe.md` keeps the fixtures of the ticket. Without the console the file is lost with the task directory. The console shows the recipe of a repository from the "Repository" line of a run and from the launch form ("Runtime recipe"), with the date it was written, and "Forget the recipe" drops it: the next run of that repository starts from none and writes a new one, while a run already going keeps its copy.

## Questions the code or the app can answer

A question about what the system does today is a fact. The pilot answers it itself when it can be read or run without starting the app. When only the running app can show it, the question is asked at step 2, marked `observable`, and the step 6 measurement is compared with the answer; a contradiction goes back to the user before the review.

The base branch follows the same rule. When the repository offers a single candidate (the checkout is on the default branch, there is no separate `develop` and no branch related to the ticket), the pilot takes it, records it in `open-questions.md` as a deduction and does not ask. With two candidates or more, or none, the question is asked at step 2.

## Defects and dismissed findings

A `fix` ticket is reproduced before it is fixed: the developer records the failing observation, then runs the same reproduction after the fix. A defect nobody reproduced leaves its criterion unverified.

Before a code finding enters rework, the orchestrator (the pilot at tiers 0 and 1) checks that it names the input, state or call site that reaches the defect. A finding without one goes back to its reviewer once, then under `## Dismissed findings` of the summary with its author and the reason. An unmet criterion, a failed check and a security finding at a changed trust boundary are never dismissed that way. At tier 0 the senior reviewer names the one fact the change is safe because of and establishes it by running code.

## Handoff and stability

`how` and `why` stay read-only and return their results to the caller. The pilot can keep them in `investigation-context.md`. It checks the question, the repository, the revision and the relevant local state before reuse; an identical revision is not enough if files have changed. Each skill keeps its own `references/epistemics.md` and `why` stops if `how` is unavailable.

The pilot owns the consolidated developer reports and the common browser recipe. Each developer writes under its suffix, including `browser-recipe-<suffix>.md`. Measurements on the application wait for the concurrent edits to end. A continuation of measurement keeps the implementation history and allocates new evidence identifiers with `supersedes`; the aggregation is idempotent per identifier.

The designer writes `design-inventory.md`, `designer-review.md` and `design-evidence.json.tmp`. Its caller adds the end snapshot actually observed, then publishes `design-evidence.json` atomically. A missing or unstable version is not presented as verified. The consumers in the console keep reading the same final files.

The full loop has an initial round and at most two reworks, QA last, within the existing time limit. A fix invalidates the evidence it affects: even a dimension that was green before may have to be replayed. A QA verdict of `INCONCLUSIVE` never exits as READY. The orchestrator lifts the named obstacle and starts QA again when the round limit allows it. Otherwise the review is BLOCKED and the MR is opened as a draft, with each unobserved criterion and its obstacle.

## Compatibility and validation

- The names of agents, commands, final files and JSON fields stay compatible with the console. It also reads `qa-plan.md`, `design-inventory.md`, the `kind` field of the evidence items and the `status` and `mandate` fields of `qa-evidence.json`.
- The brief of a task keeps its concrete path, for example `developer-report-T1.md`. The engine uses it to pair the delegation with the tracking card.
- Contract references stay distinct from reusable capabilities. Their schemas are not copied into each skill.
- The composition tests check the references, the preloads, the portability of the `how`/`why` references and the reading of the contract examples by the real parsers.
- Structure tests do not prove the behaviour of a model. Functional trials have to cover at least a small fix, an independent counterexample, a missing source, refreshed evidence, an outdated model and `why` deprived of `how`.
- A real run with Figma, Playwright and GitLab is still needed to validate the integrations end to end; the console's tests use a simulated engine.

### Check of the reorganisation, 30 September 2026

Typecheck, build, 395 unit tests and 54 integration tests pass. The ten skills pass the structure validator. Claude Code discovers the six agents and the fourteen commands and skills of the plugin.

A real trial of `review-change` on an isolated fixture detects a `> 18` threshold contrary to the `>= 18` specification. The reviewer loads the method reference, establishes the counterexample before looking at the reassuring author's report, then distinguishes its static finding from an executed test. This trial uses the `auto` mode of the harness, with no hooks and no MCP connections.

In a restrictive mode such as `dontAsk`, a reference of the plugin located outside the target repository can be refused for lack of read permission. Loading the catalogue therefore does not prove on its own that the ancillary files are reachable. Respect the refusal and report the method as unavailable; the host's permissions still apply. See the [Claude Code permissions documentation](https://code.claude.com/docs/en/permissions).

### Check of the reviewer rework, 2 October 2026

Typecheck, build, 443 unit tests and 59 integration tests pass on the `feat/reviewer-detection` branch. The repository has eleven skills. No run on a real ticket has yet exercised the new QA and design review rules.

### Check of the scheduling command, 3 October 2026

A real trial of `/implementation-harness:schedule` with `claude -p` (Claude Code 2.1.288), from a disposable git repository, on an empty batch. The plugin's command is resolved in non-interactive mode, the output file contains `{ "tickets": [], "edges": [] }` and the process exits with code 0 in 9 to 12 seconds.

```bash
claude -p --setting-sources project,local --plugin-dir <plugin> --add-dir <plugin> --add-dir <output directory> \
  --model sonnet --permission-mode dontAsk --permission-prompts none \
  --allowedTools "Read,Write,Glob,Grep,Agent,Skill,Bash(glab issue view *),Bash(glab api *),Bash(gh issue view *),Bash(gh api *),Bash(git log *),Bash(git show *),Bash(git grep *),Bash(git ls-files *),Bash(git rev-parse *),Bash(ls *),Bash(rm <output directory>/*)" \
  --output-format json -- "/implementation-harness:schedule <input> <output>"
```

- `--permission-mode auto` works too, with no tool list.
- `--setting-sources project,local` was added on 4 October 2026. With the user's settings loaded, a personal `PreToolUse` hook that put a wrapper in front of `gh issue view` turned it into a command the list does not allow: the session answered `schedule failed: shell denied`, the batch ran one ticket at a time and in the pasted order. Without them, the same batch of two GitHub issues came back with its two predictions and the `depends_on` edge read from GitHub's "blocked by".
- `--allowedTools` accepts several values. Written as separate arguments, it swallows the prompt and `claude -p` exits with code 1 ("Input must be provided"). The list goes in a single argument separated by commas, and `--` comes before the prompt.
- In `dontAsk` without `Write` in the list, the write is refused and the process still exits with code 0. The exit code therefore says nothing about the result: the console reads the output file.
- A second trial with an invented ticket URL exercised the agent: it is started from the non-interactive session, `glab` passes the tool list, and the unreadable ticket comes out as `low`. No real ticket was read, so the quality of the predictions is not verified.

### Check of batch scheduling, 3 October 2026

Typecheck and build pass, as do 627 unit tests. The integration suite gives 68 tests passed and 1 failure, `terminal.spec.ts:12`, already failing before this change and unrelated to batches.

These tests replace `claude` and `glab` with the stand-ins of `console/tests/fake-claude/`. At that date the scheduling had not run on a real GitLab instance: neither the reading of a real ticket by the agent, nor the `glab api` call of the merge request watch, nor a stacked start.

### Real trial of batch scheduling, 3 October 2026

Three tickets of a small test repository, with the real Claude Code and a real GitLab project.

- Each run worked in its own worktree and left the main checkout untouched. Two runs ran in parallel on the same repository.
- The analysis session answered in about 30 seconds. The conflict of this trial came from an analysis that failed, so the tickets of the repository ran one at a time: no conflict between two tickets both analysed without failure has been observed yet.
- The merge request watch released the held ticket about 10 seconds after the merge on GitLab, and the ticket that started then contained the merged code.
- The queue and the watch were restored after a restart of the console.

Not tried for real: the stacked start, the forced start from the base, the new analysis of a ticket whose analysis failed, a ticket with a QA or design review, and Linux.
