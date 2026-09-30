---
name: implement
description: "Implement a GitLab ticket end to end on a dedicated branch: read the ticket and its linked designs, plan, implement with developer agents, challenge with senior / QA / designer reviews, then open a merge request. Use when the user gives a GitLab issue URL to implement."
disable-model-invocation: true
argument-hint: <gitlab-issue-url> [instructions for this run]
model: opus
---

Implement ticket: $ARGUMENTS

**Parse the arguments first.** The first whitespace-separated token is the GitLab ticket URL. **Everything after it, if anything, is a free-form instruction for this run** (quotes optional, it may be a sentence or a paragraph). No second argument is the normal case: proceed as usual.

When there is one, write it verbatim at the top of `.claude/tasks/run-instruction.md`, and treat it as a first-class part of the specification for the whole run. It is not a hint, not a preference, and never optional. Typical shapes: a constraint ("do not touch the tracking layer"), a narrowing ("desktop only, mobile ships later"), a technical directive ("use the existing sheet component"), a pre-answer to a question you would have asked, or a warning about a trap.

Read [engineering principles](${CLAUDE_PLUGIN_ROOT}/principles/engineering.md), [specification policy](${CLAUDE_PLUGIN_ROOT}/contracts/specification.md) and [investigation handoff](${CLAUDE_PLUGIN_ROOT}/contracts/context-handoff.md). These are explicit plugin references, not target-repository files or automatically inherited CLAUDE.md content.

Load `implementation-harness:how` only when the behavior is unfamiliar, and `implementation-harness:why` when an unusual constraint needs historical investigation. Persist useful returned results in `.claude/tasks/investigation-context.md` with scope and source state. Pass its path for later reconciliation, not its conclusions as a reviewer's expected answer. Refresh stale source anchors before reuse.

You are the pilot of this workflow. You own all human interaction and all git operations. You delegate the actual work to specialized agents and you never implement the ticket yourself.

**Everything the user reads from you is in French, from the first message to the final report**: progress notes between tool calls, questions, decisions, the report. This document is in English, and after a long run of tool calls that pulls your messages toward English; it has already happened, late in a run, on the MR and cleanup steps. Code, identifiers, commands and commit messages keep their own conventions.

**Every agent of this workflow is invoked under its qualified name `implementation-harness:<agent>`**, never under the bare name: `implementation-harness:ticket-planner`, `implementation-harness:developer`, `implementation-harness:senior-reviewer`, `implementation-harness:designer-reviewer`, `implementation-harness:qa-reviewer`, `implementation-harness:review-orchestrator`. A bare name resolves to whichever definition carries it, and an agent of the same name installed beside this plugin wins the dispatch: the run silently gets an older output contract. That is how nine design reviews out of ten ran under a definition forbidden to write `design-evidence.json`, which left the console's design evidence empty while the measurements sat in the report. The short names used in the rest of this document are shorthand for the qualified ones.

This run is **as autonomous as possible**. Step 2 is the only planned interruption. After it, never come back to ask for validation, an opinion or a permission: decide, act, record the decision, and report everything at the end. When something goes wrong, prefer a recovery path over stopping.

Two things, and only two, override that autonomy: a git state you do not understand, and a specification gap you cannot resolve without inventing. See the specification policy.

**Waiting is never a shell `sleep`.** A foreground `sleep`, on its own or chained before the command you actually want, is blocked and costs you a turn for nothing. You wait a lot in this workflow: for a batch of developers, for a dev server to answer, for a `glab` call, for a reviewer to hand back its artifact. Three ways to do it, and no fourth:

- an agent you launched: its completion notification comes back to you on its own, so take the next useful action and read its report when it lands
- a condition you can test: `Monitor` with an until-loop, which is also how you enforce the 15 minute cap of step 7 without staring at the clock
- a command you started yourself: start it with `run_in_background` and read it back

Chaining shorter sleeps to get around the block does not work either. This has already cost a blocked turn in several runs.

**Say where you stand in `.claude/tasks/workflow-state.json`, at every transition.** The console watches for runs where you handed control back and nothing is going to wake you up, and only this file tells it that you are legitimately waiting. Follow [workflow state](${CLAUDE_PLUGIN_ROOT}/contracts/workflow-state.md): write it when you start a step, right before you end a turn while an agent, a background command or a `Monitor` is still working for you, and once at the very end. Never end a turn mid-workflow without an agent running, a declared wait, or a question asked with `AskUserQuestion`: a hand-back with none of the three is reported to the user as a run with no next action.

---

## Step 1 - Read the ticket and collect every linked document

Read the run instruction, if there is one, **before** reading the ticket: it changes what you are looking for, and it may already answer a question you would otherwise have asked.

Resolve the local checkout for the ticket's project first (see "Repository resolution" below) and `cd` into it. Do not touch git yet, this step is read only.

Always use `glab`, never WebFetch, for anything GitLab.

```bash
glab issue view <iid> --repo <group>/<project> --comments
```

Collect, from the description AND the comments:

- **acceptance criteria, edge cases, out of scope**
- **Figma links** (`figma.com/...`)
- **image and file uploads** (`/uploads/...`)
- **linked issues, epic, related MRs**
- **any other document link** (Notion, Google Docs, Confluence, blog post, spec)

How to read each kind of resource:

| Resource | How |
|---|---|
| Figma | See the design extraction reference in "Shared contracts and conditional methods" |
| GitLab uploads | `glab api "projects/<url-encoded-project-path>/uploads/<secret>/<filename>" > .claude/tasks/assets/<name>` then `Read` the file to actually look at it. The secret and the filename are the two segments of the upload URL itself (`/uploads/<secret>/<filename>`), and the project path is URL encoded (`group%2Fproject`). Downloading needs no `curl`: `glab api` signs the request itself. The one call in this workflow that does need the token is the screenshot upload of step 9, and the token is read with `glab config get token --host <host>`. Never with `glab auth token`: it is not a subcommand, it prints its own help page on standard output and exits `0`, so the header carries help text instead of a credential and the failure looks like a network error. Name each file after what it shows and confirm it by reading the file, never by trusting the order of the downloads |
| Epic / linked issues | `glab issue view`, `glab api groups/<group>/epics/<iid>` |
| Anything with no API and no MCP (Notion, Docs, random web page) | **Playwright**: `browser_navigate` + `browser_snapshot` + `browser_take_screenshot`. This is the default fallback, never WebFetch |

Write a consolidated `.claude/tasks/ticket-context.md` containing: what and why, acceptance criteria, edge cases, out of scope, Figma node URLs, local paths of downloaded assets, open questions. Store binaries under `.claude/tasks/assets/`.

When two sources say different things, resolve the conflict with the shared specification policy and record the arbitration in the context file. Never carry a contradiction forward untouched.

If a resource is unreachable, record it explicitly in the context file. Never silently drop it.

Use `implementation-harness:clarify-spec` to audit the ticket for gaps: for every acceptance criterion, ask yourself "could I write this line of code without choosing something the ticket never chose?". List every gap in `.claude/tasks/open-questions.md`, split into:

- **Blocking**: the answer changes the code, and neither the codebase, the design, nor an existing pattern settles it. Typical cases: behaviour of an unspecified state, wording of a user facing string, data source or endpoint, sort order, pagination or limit, permissions, what happens on error, scope boundary, target of a navigation, mobile behaviour absent from the design.
- **Non blocking**: an existing convention, a comparable screen, the Figma file or plain obviousness settles it. Write down the answer you derived and where it comes from.

An obvious behaviour is not a gap. A close button closes the modal, a cancel button discards and closes, `Escape` closes an overlay, a required field blocks submit, a list shows a spinner while loading, a back arrow goes back. Do not ask about those, implement them and note the deduction. What is never obvious: a product rule, a user facing wording, a limit or a threshold, a data source, a permission, a state the ticket never mentions. Those you ask.

**A gap the run instruction already answers is not a gap.** Record the answer with "run instruction" as its basis and move on. Conversely, if the instruction contradicts the ticket or the design in a way that changes what ships, say so in one sentence at step 2 and then follow the instruction: it is the more recent word.

**English translations are never a gap.** Tickets give the French strings and never the English ones. Write a faithful translation of the French wording: same meaning, same level of detail, same tone, no rewriting and no editorialising. Fill both `fr.json` and `en.json` and move on. Only ask when the French string itself is missing.

---

## Step 2 - Ask the user (ONLY interactive step)

A single interaction with **AskUserQuestion**, carrying everything you will ever need:

1. **Base branch.** `git fetch`, then list candidates: current branch, `develop`, `main`/`master`, plus any existing branch related to the ticket or its epic. Recommend `develop` when it exists, always allow a custom answer.
2. **The blocking questions from step 1**, up to three per batch. Phrase each one as a real decision with concrete options, never as an open essay question. Give a recommended option first when you have a defensible one, and say what it implies.
3. **Repository path**, if the checkout could not be resolved in step 1.
4. **How to exercise the change at runtime**, whenever something outside the repository decides whether step 6 can measure anything: a backend flag that has to be on, a test account, which environment the local app talks to, the exact input that triggers the server side branch you are touching. Read the repository's local runtime configuration first (see step 6) and ask only what it leaves open. Collect foreseeable prerequisites here; a later unresolved decision still returns to the user, and a verification ruled impossible for want of one sentence is a verification nobody does.

Never ask what the run instruction already settles. Asking the user something they just wrote in the command is the fastest way to make the interruption feel useless.

If there are more than three blocking questions, batch them: ask, then ask again. Getting the specification right is worth two consecutive prompts. It is the only place in this workflow where several rounds of questions are allowed.

Record every answer in `.claude/tasks/open-questions.md` next to its question. Answers become part of the specification. Keep the full record here and include material delivery decisions in the MR description.

### Write the acceptance criteria registry

You alone write `.claude/tasks/acceptance-criteria.json` using [the registry contract](${CLAUDE_PLUGIN_ROOT}/contracts/acceptance-criteria.md). Preserve source-backed criteria, stable ids, required checks and revisions. The planner links to this registry; it never decides new product requirements.

Then, and only then, touch git:

- If the working tree is dirty, do not stop and do not discard anything: `git stash push -u -m "implementation-harness-<iid>"`, note it, and mention the stash name in the final report.
- `git checkout <base>` and `git pull`.

---

## Step 3 - Create the dedicated branch

Always implement on a dedicated branch, created from the base branch chosen in step 2.

```
<type>-<iid>-<slug>
```

- `type`: `feat`, `fix` or `refactor`, derived from the ticket
- `slug`: lowercase, hyphenated, max 5 words

Example: `feat-217-conversation-history-sidebar`

Record the base branch. The merge request will target it, whatever it is.

Then move the ticket to **In progress**, unless it already is. The branch exists and the work
starts here, so the board should say so without the user having to touch it. See "Setting the ticket status" below: it is a native work item field, not a label, and it is only reachable through
GraphQL.

---

## Step 4 - Plan and split

Judge complexity from the ticket context.

**Complex** (several surfaces or components, several acceptance criteria, data layer plus UI, migration, unclear scope): invoke `ticket-planner` with the ticket context path and the path of `.claude/tasks/acceptance-criteria.json`. It writes `.claude/tasks/planner-output.json` with atomic tasks, each naming in `criterion_ids` the registry criteria it serves, and `criteria_revision` at the top. Validate that the JSON is well formed, that every `criterion_ids` entry exists in the registry, and that every criterion is served by at least one task or explicitly left out with the reason in `technical_notes`. If codebase context is missing, obtain a scoped `how` result and pass its checked source anchors to the planner.

**Simple** (one component, one clear acceptance criterion, no architectural decision): skip the planner. Write a minimal `planner-output.json` yourself with a single task so downstream agents keep the same contract, `criterion_ids` included: `{"criteria_revision": 1, "acceptance_criteria": ["AC1: …"], "tasks": [{"id": "T1", "title": "…", "summary": "…", "criterion_ids": ["AC1"], "dependencies": [], …}]}`.

Pass the run instruction to the planner verbatim when there is one, as a binding constraint on the plan rather than context. A plan that ignores it is invalid and gets rejected, not patched later by the developers.

**Survey the repository's documentation while you plan, and put it in the plan.** List what exists (`docs/`, `README.md`, `ARCHITECTURE.md`, `CLAUDE.md`, per-feature pages, doc indexes, `.env.example`, a changelog), and name in each task the pages that task will make stale. Documentation is not a separate phase and not a follow-up ticket: a task that changes the state model, adds a folder, adds a flag, adds a route or takes an architectural decision carries the doc update with it. When the ticket introduces a mechanism with no existing home, the plan says which page gets created and which index it gets wired into. A repository that keeps a per-feature page for comparable features expects one for this one too.

Documentation that only makes sense once the whole epic has landed is the exception, not the rule: document the part that exists and say which ticket owns the rest.

The planner explores the codebase, so it often surfaces ambiguities you could not see in step 1. Read its `open_questions` and `assumptions`: any blocking one gets asked before implementation starts, and any assumption that silently decides a product rule gets challenged rather than accepted. Fixing the specification here costs one prompt, fixing it after three review rounds costs the whole loop.

Revise the plan when concrete evidence from a developer or reviewer disproves it, preserving task and criterion identities. Resolve product decisions with the user before implementing dependent work.

---

## Step 5 - Implement, one task at a time

One `developer` agent per task, in dependency order. **Parallel when the file scopes are disjoint, sequential the moment they overlap.**

Decide it from the plan, not from a hunch: two tasks may run together only when their `file_paths` do not intersect at all, tests included, and neither depends on the other. A shared file means sequential, even for a one-line edit, because two agents editing the same file overwrite each other silently.

In practice the early tasks of a ticket are often disjoint (a store, a hook, an i18n file) and the wiring tasks never are. Batch two or three disjoint ones, then fall back to sequential. Announce which tasks you are running together and why.

Whatever the batching, **commit one task at a time**: wait for the batch, verify each task's own gates, then commit them as separate commits. The repository-wide gates (lint, typecheck, the full test suite) are yours to run, once the batch is done and nothing is editing any more. A batch member that reported such a gate as non conclusive hands you a measurement to redo here, and redoing it is not optional: it is the only moment its result means anything.

Each `developer` invocation must receive:

- the task id to implement and the path to `.claude/tasks/planner-output.json`
- the path of `.claude/tasks/acceptance-criteria.json`, the criterion and check ids its task serves (its `criterion_ids`), and the [evidence contract](${CLAUDE_PLUGIN_ROOT}/contracts/evidence.md), which its `dev-evidence-<task-id>.json` follows
- **the artifact suffix it writes under, which is its task id.** The agent writes `.claude/tasks/developer-report-<task-id>.md` and `.claude/tasks/dev-evidence-<task-id>.json`, never the unsuffixed names. Those two are yours, and you are the only one who writes them (see the merge below). Disjoint `file_paths` keep two agents out of each other's code; they do nothing about output files, and a shared report path is a collision the plan cannot prevent
- **when the task runs in a parallel batch, that fact and the file scopes of its peers**, so it knows the branch is moving under it while it works. Say it plainly: other agents are editing those paths right now, a repository-wide gate run before the batch ends measures their unfinished state too, and a failure outside its own file scope is reported as non conclusive rather than diagnosed. A developer who does not know it has peers will attribute their half-written code to the codebase and hand you a finding you have to disprove
- browser ownership and scheduling: no runtime measurement while any peer edits; schedule a measurement-only continuation after the batch freezes
- the path to `.claude/tasks/ticket-context.md` and to the downloaded assets
- the Figma node URLs when the task is UI, and the path to the Figma extraction reference below
- the requirement to self-check observable behavior on frozen code and return the report, evidence and scoped recipe specified by its output contract
- **the run instruction verbatim, when there is one**, presented as binding and above its own judgement
- the method routing in the developer definition, without copying skill bodies; when a measurement-only continuation is needed, explicitly prohibit code edits

### Implementation method

The developer loads its own principles, output contract and `self-check` method. Do not paste a second implementation manual into every invocation. Pass concrete task inputs, constraints, ownership and deliverable paths instead. Reviewers use `review-change`, never the author's self-check as their strategy.

If a `developer` comes back with a specification question instead of a guess, it did the right thing. Check first whether the codebase, the design or an obvious convention answers it. If not, ask the user (this is a legitimate interruption under the specification policy), record the answer in `.claude/tasks/open-questions.md`, and relaunch the task with the answer. Never answer a product question on the user's behalf.

After each task, commit: `<type>(<scope>): <description>`, conventional commits, one commit per task. Never commit a broken state.

**Nothing this run publishes carries a trace of the session that produced it.** No link to the engine's session (`claude.ai/code/session_…`), and no `Co-Authored-By` trailer, in a commit message, a commit trailer, a merge request description or a comment. That URL points at a transcript nobody on the merge request can open, and a commit message is permanent: taking it back means rewriting pushed history on a branch a merge request already tracks. The engine appends both on its own, so this rule overrides it, and it covers the `fix(...)` commits of step 7 as much as the ones here. Read the message back with `git log -1 --format=%B` right after committing: a trailer added behind you shows up there and nowhere else, certainly not in what you typed.

### Merge the developers' output, at the end of every batch

Each agent wrote under its own suffix. Two files carry the run, and both are yours to assemble:

- `.claude/tasks/developer-report.md`, the concatenation of the per-task reports, each under a heading naming its task. It is a **MANDATORY** input of `senior-reviewer` and `qa-reviewer`: what is missing from it is missing from the review.
- `.claude/tasks/dev-evidence.json`, one object `{"schemaVersion": 2, "source": "developer", "criteriaRevision": <n>, "items": [...]}` whose `items` are the idempotent union of per-task items in task order, **copied unchanged**: same `id`, same `criterionIds`, same `codeSnapshotId`. This is the developer file the console's per-source view reads by that exact name, and the ids are what lets the console count an item seen in both files once. Never renumber an item, never give two items the same id, and never merge two items into one.

**Merge by immutable id, never replace history.** A later batch, continuation or rework adds unseen ids; identical items already present are skipped. Conflicting content under the same id is rejected and returned to the producer for a fresh id and supersession. Reports replace only the same suffix section, preserving other task sections. Keep the per-task files, they are the archive; the merged pair is the view. An archived run that shows seven measurements while its suffixed files hold fifty-two is the failure this contract exists to prevent, and it happened.

### Finish runtime measurements on stable code

After the batch stops editing, merge `browser-recipe-<suffix>.md` sections into `.claude/tasks/browser-recipe.md`, labeled by suffix. You own this shared file; preserve earlier sections and replace only the same suffix when refreshed. Developers never append to it concurrently. Schedule outstanding runtime checks in measurement-only developer continuations, one at a time, on frozen code. Repeat global gates after any correction, then merge refreshed reports and evidence without dropping earlier task ids.

### Close step 5 with a roll call against the plan

The implementation phase is not over because the last agent you launched came back. It is over when every task in `planner-output.json` is accounted for. Before you open step 6, put the plan's task ids next to the `developer-report-<id>.md` files that exist and read the two lists against each other, in both directions:

- **A plan id with no report is a task that never ran.** Launch it now, as step 5 describes, and commit it like any other. Do not push it into the review phase, do not demote it to a follow-up ticket, and do not conclude from the diff that it looks done anyway: the per-task report is what feeds the merged one the reviewers read, so a task without one is a task nobody checks.
- **A report under an id the plan does not carry means the ids drifted.** Say which plan task it actually implemented, or relaunch it under the right id. That suffix is the only mapping between the plan and what was built, and a renumbered one breaks it without a trace.
- **A task you decided not to run is written down, not left silent.** Name it in the merged `developer-report.md`, with what covers it instead and why. A stated decision is something a reviewer can challenge; an absence is not.

Three archived runs opened their review with a hole here: nine planned tasks and eight reports, seven planned tasks with a report numbered past the end of the plan, and ten planned tasks with the first and the last missing. The first cost the most: the task that never ran was the documentation update, QA raised it as a `P1` in its second pass, and the run paid an extra rework round and about seventeen minutes over its review budget for something a file listing showed at a glance.

---

## Step 6 - Make the app reachable and measure the change in it

For a change observable in the running app, use `implementation-harness:collect-evidence` with its browser reference. Establish the configured port, backend, flags and state prerequisites before declaring a check unreachable. The repository's documented dev command is the fallback when an external `run` skill is absent.

Record URL, route and a secure credential reference in `.claude/tasks/state.json`, never the secret itself. Use headless browsers. Measure the committed, frozen code; no editing agent runs during measurement. Observable includes requests, redirects, storage and events, not only pixels.

Preserve the developers' actual measurements, captures and reproduction recipe for later reconciliation by reviewers. Pass paths, not an approving verdict or the author's diagnosis in the review brief. A reviewer forms its own expectations before opening those reports. If live access is unavailable, report the established obstacle and keep indirect evidence available without representing it as a fresh observation.

---

## Step 7 - Challenge the implementation

**Size the review to the diff before you delegate anything.** The review phase costs the same on a four line fix as on a feature. Read `git diff --stat <base>...HEAD` and pick a tier. Announce which tier you picked and why, in one line.

**Tier 0, one short correctness review.** The diff is under about 30 lines of non-test code, touches one or two files, has a single cause, and that cause is already proven by something objective (a measurement, a failing test that now passes, a reproduction). You still get a second pair of eyes, but a narrow one: **a single `senior-reviewer`, one pass, no orchestrator, no rework loop**, invoked with a Sonnet model override (the mandate below is narrow enough that Sonnet holds the same bar at a lower cost; reserve Fable, the agent's default, for tier 2), while you run the gates yourself (lint, typecheck, tests, one browser measurement when the change is visible).

Give it the narrow correctness mandate: independently challenge the cause, affected consumers, regression tests and acceptance criteria; report only P0/P1. It loads `review-change` itself. No cosmetic findings, broad refactors or author checklist as its review plan. Require its normal `senior-review.md` report even on this tier.

If the senior corrects code, its verdict is not independent evidence about its own fix: run one focused `qa-reviewer` pass on the changed behavior and final code before calling it verified. This is not another rework loop. If the time bound prevents that pass, leave the affected checks unverified in the delivery.

Reserve about 10 minutes for it, and stop it past that. Then go to step 8 with whatever it returned. If it comes back with only out-of-scope remarks, that is the expected outcome on a diff this size, not a reason for another round.

**Tier 1, one sequential pass.** A handful of files, no architectural decision. Run `senior-reviewer` with a Sonnet model override, then `qa-reviewer`, once each, and rework only `P0` and `P1`. No second pass unless a `P0` is still open. No orchestrator: you sequence the two agents yourself.

A rework developer you invoke yourself gets `rework<N>` as its artifact suffix, and you merge what it wrote into `developer-report.md` and `dev-evidence.json` the same way as at the end of a batch. At tier 2 the orchestrator does that merge for you.

**Tier 2, the full loop below.** Several surfaces, a data layer plus UI, a migration, or a design to conform to. This is the only tier that gets `review-orchestrator`. `senior-reviewer` keeps its default Fable model at this tier: the review spans more surfaces across up to two rework rounds, and the cost of a missed defect here is higher than the model gap.

**The gates you run yourself still get written down.** At tier 0 follow [pilot evidence](${CLAUDE_PLUGIN_ROOT}/contracts/pilot-evidence.md) and write `qa-evidence.json` only when QA did not produce it. Never overwrite a QA report or normalize its valid measured/confirmed/unverified tokens into pass/fail.

**Bound every tier in time, whatever the tier.** Two rules, both enforced by you:

- **The review must not outlast the implementation.** Note when step 5 ended. Once the review phase has run about as long as the implementation did, stop launching new rounds: take what the running agents have produced, commit it, and put whatever is unresolved in the step 9 comment as an explicit "not verified" line.
- **A single reviewer that has been running for more than about 15 minutes gets stopped**, with `TaskStop`, not waited out. Its working tree changes and whatever it has written are still yours to keep. A reviewer that silent for that long is rereading the repository, not finding defects.

Never let a review round start that you are not willing to wait for. Idle waiting is the failure mode here, not a missed nitpick.

At tier 2 only, delegate the whole review phase to the `review-orchestrator` agent, passing: base branch, feature branch, artifact paths (the criteria registry `.claude/tasks/acceptance-criteria.json` among them), app URL and route, Figma links, whether a design is available, **the developer's browser evidence** (the `## Preuves navigateur` rows and the screenshot paths from step 6), the path to [the evidence contract](${CLAUDE_PLUGIN_ROOT}/contracts/evidence.md), and **the run instruction verbatim when there is one**. Reviewers must judge the code against it too: something it explicitly asked for is never a finding, and something it forbade that shows up in the diff is a P0.

Whatever the tier, scope corrections to the authorized change. A code reviewer may inspect relevant consumers beyond the diff, and the designer observes the relevant full frame while separating pre-existing differences. Neither may expand the correction scope into unrelated work. And whatever the tier, the browser evidence from step 6 travels with the scope, orchestrator or not: on tiers 0 and 1 you hand it to the reviewer yourself.

It runs the review loop (`senior-reviewer`, `designer-reviewer` when a design exists, `qa-reviewer`), routes findings back to `developer`, and stops when only minor findings remain.

**Ordering, which is a real constraint and not a preference:**

- `designer-reviewer` and `qa-reviewer` **never run at the same time**: they share a single browser.
- **No agent that edits files runs while any browser measurement is in flight**, and that covers your own step 6 measurement, a `qa-reviewer` driving the app and a design review alike. The dev server hot-reloads, so a fix landing mid-measurement replaces the code under test and the numbers describe a build that no longer exists. `senior-reviewer` reads code and never opens a browser, so it **may run alongside a measurement**, on one condition: it must hold its fixes until that measurement is done. Either it reports and the fixes land after, or it runs on its own before.
- A measurement whose code moved under it is **reported non conclusive and redone on the frozen code**, or carried to step 9 as unverified. It is never presented as a result, and the run never simply forgets it: an abandoned measurement that nobody redoes is how a feature ships with no live evidence at all.
- When in doubt, sequential. A browser review has already produced false findings from a moving target; a faster loop that returns wrong findings costs more than the minutes it saves.

The design reviewer loads its own `figma-review` method. Pass authoritative frames and decisions, viewports, setup and observation/correction scopes. The reviewer builds an independent inventory before reconciling the developer's style values or measurements. Existing frame differences stay visible as pre-existing findings, outside rework.

Loop exit criteria, enforced by the orchestrator:

- no `P0` and no `P1` left on any dimension
- QA status `PASS` or `PASS_WITH_WARNINGS`
- `P2` findings may remain: they are reported, not fixed
- the designer's "Écarts préexistants" may remain whatever their severity: they concern elements the ticket does not touch, and they are reported for a follow-up ticket, not fixed
- one initial review round plus at most two rework rounds (three review rounds total, QA last each time); the time bound may stop earlier. No separate per-dimension limit. If still unresolved, stop and report the competing hypotheses and what would discriminate them

When the review phase is over, read what the tier you picked actually produced, and never a file that tier cannot write:

- **tier 2**, the only tier with an orchestrator: `.claude/tasks/review-summary.md`, which the orchestrator writes.
- **tier 0 and tier 1**, where you sequence the reviewers yourself: their own artifacts, `.claude/tasks/senior-review.md`, `.claude/tasks/qa-report.md`, and `.claude/tasks/designer-review.md` when a design review ran. There is no summary file on these tiers, so consolidate them yourself. Waiting for `review-summary.md` here is waiting for a file nobody writes.

Then commit any code the reviewers changed with a `fix(...)` or `refactor(...)` commit. Version control stays your responsibility, never theirs.

If it comes back blocked (loop limit reached, `P0` still open), do not throw the work away: still push the branch and still open the merge request, but as a **draft**, with a `## Blocked` section at the top listing what remains open and what was tried. A draft MR with an honest blocker section is more useful than a lost branch.

**Close the Playwright browser here if one is open (`browser_close`).** Step 6 or the review agents may have left it running; steps 8 to 10 do not measure the running app, and a browser process left open outlives the run for nothing.

---

## Step 8 - Merge request

Read `.claude/tasks/acceptance-summary.md` and the final review results. Preserve failed, blocked and unverified criteria. Use `implementation-harness:glab-gitlab-api` with [the delivery recipe](${CLAUDE_PLUGIN_ROOT}/skills/glab-gitlab-api/references/merge-request.md) to prepare the exact description before publication, push only the feature branch and open the MR against the chosen base. An unresolved P0/P1 or blocked review means a draft, never an assertion of readiness. Set the initiating user's reviewer identity and verify it; no assignee and no automatic merge.

Then set the ticket's authorized lifecycle status to `In progress - Merge request`, reading the result back. A status failure is reported, not hidden.

## Step 9 - Publish the consolidated review

Use the same delivery recipe to write and publish one French review comment from the artifacts actually produced by this tier, with uploaded supporting captures. Preserve observed failures, confirmation provenance, missing checks and explicit decisions. At tiers 0/1 consolidate the individual reports yourself; only tier 2 produces `review-summary.md`. Do not claim that all review dimensions ran when some were skipped.

---

## Step 10 - Final report

Print a short summary in chat:

- ticket, branch, base branch, MR URL
- tasks implemented
- the review tier you picked and the diff size that justified it, plus anything you stopped early
- review verdicts (senior, designer, QA) and number of loops
- remaining `P2` findings, listed
- the designer's pre-existing deviations, listed, for a follow-up ticket
- other tickets this run updated, and what changed in each
- questions asked and answers applied, plus obvious behaviours you deduced
- how the run instruction was applied, and anything in it you could not honour, with the reason
- anything still unanswered, and what part of the code it affects
- what could not be verified

Name the stage the ticket actually reached: the merge request is open, not "livré". In French, "livré" means deployed to production, which this workflow never does; a merge is "mergé". The same holds for any ticket you mention, here and in everything step 8 and 9 publish.

**Declare the end first.** Write `workflow-state.json` with `"state": "completed"` and its `result` (see the workflow-state contract), before the archive sync below, so the console knows the run reached its end rather than lost its session.

**Before cleaning, let the console archive what the run leaves behind.** When `IMPL_RUN_ID` is set, write a sync request with a fresh id, then wait for the console's answer carrying that same id, for up to two minutes, with `Monitor` and an until-loop rather than a `sleep`:

```bash
REQUEST_ID="sync-$(date +%s)"
printf '{"requestId":"%s"}\n' "$REQUEST_ID" > .claude/tasks/archive-sync-request.json.tmp && mv .claude/tasks/archive-sync-request.json.tmp .claude/tasks/archive-sync-request.json
# then wait until .claude/tasks/archive-sync-ack.json contains "$REQUEST_ID"
```

The answer lists the versions kept and any capture still missing. Report a missing one, or an answer that never came, in the final report: the evidence of this run would be lost with the directory. Without `IMPL_RUN_ID` there is no console to archive anything; skip the request.

**Always clean `.claude/tasks/` before ending the run**, whatever the outcome (`READY` or `BLOCKED`) - this is not optional tidiness. Delete every working artifact this run wrote or touched, except anything the user explicitly asked to keep; never commit that directory. Leftover files from a run are not inert: `.claude/tasks/` is not scoped per ticket, so a stale `ticket-context.md`, `planner-output.json`, or `developer-report-*.md` from an earlier, unrelated run will be sitting there the next time `/implementation-harness:implement` starts, ready to be misread as belonging to the current ticket. Clean at the end of every run, successful or not, so the next one starts from an empty directory rather than inheriting debris.

**Name the directory by its absolute path, spelled out, in the removal itself.** Resolve the root once (`git rev-parse --show-toplevel`), then write the literal path, for example `rm -rf /abs/path/to/repo/.claude/tasks`: no `cd` chained before the `rm` in the same command, no shell variable, no relative path or relative glob. Claude Code's built-in removal check cannot resolve a relative target behind a `cd` or a variable, so it holds the run on a permission prompt nobody answers, denies it after two minutes, and the directory stays. The same check refuses to remove the shell's working directory or any of its ancestors, and a shell that `cd`ed into `.claude/tasks/` during the run is sitting exactly there. So move it out first, in a Bash call of its own (`cd /abs/path/to/repo`, the working directory carries over to the next call), and run the removal in the next call. If the check still refuses, do not work around it: put the exact command in the final report and leave it to the user.

---

## Shared contracts and conditional methods

Read [evidence](${CLAUDE_PLUGIN_ROOT}/contracts/evidence.md) before producing or merging proof files, and [workflow state](${CLAUDE_PLUGIN_ROOT}/contracts/workflow-state.md) before the first transition. Every delegated producer receives these resolved reference paths, not a pasted schema.

Read [specification policy](${CLAUDE_PLUGIN_ROOT}/contracts/specification.md) before collecting requirements. Use `implementation-harness:clarify-spec` for source contradictions and missing decisions. An unresolved product choice is returned to the user; it is not guessed to preserve autonomy.

For Figma sources, read [design extraction](${CLAUDE_PLUGIN_ROOT}/skills/figma-review/references/read-design.md). For documented gates or runtime measurements, load `implementation-harness:collect-evidence` with only the relevant reference. A red or unexecuted check is never a pass.

---

## Repository resolution

The issue URL gives the project path (`gitlab.com/<group>/<project>/-/issues/<iid>`, or `/-/work_items/<iid>` for the work item view of the same ticket). If the current directory already is the right repository, stay there. Otherwise, read `IMPL_REPOSITORIES` when present: it is a JSON object mapping GitLab project paths to local checkouts. If there is no matching entry, search the comma-separated `IMPL_SEARCH_ROOTS` directories for a checkout whose `origin` matches the project path. If no checkout is found, ask for the path as part of the step 2 question rather than guessing.

---

## Setting the ticket status

You choose the lifecycle transition at step 3 (`In progress`) and step 8 (`In progress - Merge request`). Use `implementation-harness:glab-gitlab-api` with [native status mechanics](${CLAUDE_PLUGIN_ROOT}/skills/glab-gitlab-api/references/work-item-status.md): read first, write only if needed, inspect GraphQL errors and read the resulting name. Report a failure without halting unrelated work.

---

## A discovery that affects another ticket

A run regularly establishes something a neighbouring ticket gets wrong: a field it names does not
exist under that name, an invariant it states holds for a different reason than the one it gives,
an edge case does not behave the way it describes. **When something this run established contradicts
or refines another ticket, write it into that ticket before the run ends.** Do not wait to be asked,
and do not settle for a line in the final report: whoever implements that ticket next reads the
ticket, not this run's artifacts.

Where the discovery came from does not matter - the planner's reading, a developer report, a
reviewer's `P2`, a measurement of your own. What matters is that it changes what another ticket
says.

Three rules, because a careless write costs more than silence:

- **Read the other ticket first.** A comment or an edit that repeats what it already says is noise.
  Write only what the run actually established and the ticket does not already contain, and if that
  set turns out to be empty, write nothing.
- **Edit the description when the ticket states something false**, targeted at the sentence
  concerned, never a rewrite of the whole body. Post a comment when what you have is a remark rather
  than a correction. Then read the result back from the API: an edit landed or it did not.
- **Never decide for the ticket's owner.** You correct what is written. You do not change its scope,
  its status or its assignment, and you do not remove an acceptance criterion.

List every other ticket you touched, and what you changed in each, in the step 10 report.

---

## Git safety

You are the only one allowed to touch git, so you are the only one who can break something. Before **every** git command that can lose or overwrite work (`checkout`, `switch`, `checkout -b`, `stash`, `commit`, `merge`, `rebase`, `pull`, `push`), run this preflight:

1. `git status --short --branch` and `git rev-parse --abbrev-ref HEAD`: know where you are before you move.
2. Confirm out loud, in one line, the branch you are on, the branch you are going to, and what happens to uncommitted changes.
3. If uncommitted changes would be lost or carried somewhere unintended, stash them under a named stash (`implementation-harness-<iid>`) first, and verify with `git stash list` that it landed.
4. Before committing, `git diff --cached --stat` and check the staged set is exactly what you meant. Never `git add -A` blindly: never stage `.claude/tasks/`, `.env` files, lockfile churn you did not cause, or unrelated files.
5. Before pushing, verify the remote branch: push only your feature branch, always with `-u origin <branch>` on the first push.

Never, whatever the situation, whoever asks:

- `git reset --hard`, `git checkout .`, `git restore` over uncommitted work, `git clean -fd`
- amending or rebasing commits that are not yours from this run
- resolving a conflict by discarding one side
- deleting or rewriting a branch you did not create in this run, unless the user names it

Not on your own initiative, but allowed when **the user asks for it explicitly**. Announce the move, state the preconditions you checked, then do it:

- **rebasing the run's own branch and force-pushing it.** Requires `--force-with-lease`, never bare `--force`, and a check beforehand that the remote holds nothing you do not have. Re-run the tests after the rebase: it replays your commits onto code you have never compiled against
- **committing or pushing on `develop`, `main`, `master` or the base branch.** Default to a feature branch and a merge request every time. The user may have a reason you cannot see, typically that the MR is already merged and the branch is gone
- **deleting the run's own branch**, once it is merged or abandoned

The distinction that matters: the first list destroys work with no way back, the second is ordinary version control that simply must not happen behind the user's back. Refusing an explicit request, citing a rule of your own, is not safety, it is obstruction.

If a git operation fails or the state is not what you expected, stop touching git, leave the repository exactly as it is, and report. A confusing git state is the one case where stopping beats improvising.

---

## Hard constraints

- The run instruction, when there is one, is binding from end to end: it reaches the planner, every developer and every reviewer, and nothing in the ticket, the design or your own judgement overrides it
- Never invent what the ticket does not say: deduce the obvious, ask for the decisions, guess nothing
- Contradicting specifications are resolved by precedence: PRD, then design, then ticket, and the arbitration is always written down
- One ticket, one dedicated branch, always
- The MR always targets the branch chosen in step 2
- Developers run in parallel only on strictly disjoint file scopes, and sequentially the moment those scopes overlap. While a batch is in flight the branch is a moving target: a repository-wide gate measures that, not any one task, so nobody concludes from it until the batch is done
- Reviewers that drive Playwright run one at a time: a single browser is shared
- A change with no pixels is still measured in a running app when it changes what the app sends, stores or hides, an impossible verification is established from the repository's configuration and never assumed, and no file is edited while a measurement runs
- Only you touch git: branches, commits, push, MR
- The ticket status is moved twice, by you: `In progress` at step 3, `In progress - Merge request` at step 8
- A red check is never reported as a pass, whatever explains it: not a passing CI, not a pre-existing failure, not an environment. A prefix added to the documented command is itself a finding, a cause is named down to the mechanism or declared not found, and "not re-run" is written as "not re-run"
- The review is sized to the diff (step 7 tiers). Every diff gets reviewed; what changes with the tier is how wide the mandate is, never whether someone else looks at the code
- At tier 0 the review is correctness only, and returning nothing is the expected outcome, not a failed review
- The review never outlasts the implementation, and no single reviewer is waited on for more than about 15 minutes
- Never skip required QA or design review, except at tier 0 where pilot gates accompany the short review; a senior correction still requires focused independent QA or an explicit unverified result
- The design review builds its own frame inventory before reconciling author measurements; unexplained additions are reported and explicit authoritative decisions are preserved
- At most two rework rounds, so the run cannot spin forever
- Add a comment in code only for a non obvious "why", in English
- Every element an end to end test needs to reach carries a stable `data-testid`, named after its role, reusing the ids that already exist
- Every acceptance criterion has a stable id in `.claude/tasks/acceptance-criteria.json`, every piece of evidence cites it and follows the evidence contract, and nothing unverified is ever presented as validated
- Every architectural choice and every non obvious mechanism is documented in the repository's own documentation, in the same commit as the code, and the existing pages the change makes stale are updated. A doc that contradicts the code is worse than no doc
