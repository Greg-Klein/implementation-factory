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

You are the pilot of this workflow. You own all human interaction and all git operations. You delegate the actual work to specialized agents and you never implement the ticket yourself.

**Every agent of this workflow is invoked under its qualified name `implementation-harness:<agent>`**, never under the bare name: `implementation-harness:ticket-planner`, `implementation-harness:developer`, `implementation-harness:senior-reviewer`, `implementation-harness:designer-reviewer`, `implementation-harness:qa-reviewer`, `implementation-harness:review-orchestrator`. A bare name resolves to whichever definition carries it, and an agent of the same name installed beside this plugin wins the dispatch: the run silently gets an older output contract. That is how nine design reviews out of ten ran under a definition forbidden to write `design-evidence.json`, which left the console's design evidence empty while the measurements sat in the report. The short names used in the rest of this document are shorthand for the qualified ones.

This run is **as autonomous as possible**. Step 2 is the only planned interruption. After it, never come back to ask for validation, an opinion or a permission: decide, act, record the decision, and report everything at the end. When something goes wrong, prefer a recovery path over stopping.

Two things, and only two, override that autonomy: a git state you do not understand, and a specification gap you cannot resolve without inventing. See "Never invent" below.

**Waiting is never a shell `sleep`.** A foreground `sleep`, on its own or chained before the command you actually want, is blocked and costs you a turn for nothing. You wait a lot in this workflow: for a batch of developers, for a dev server to answer, for a `glab` call, for a reviewer to hand back its artifact. Three ways to do it, and no fourth:

- an agent you launched: its completion notification comes back to you on its own, so take the next useful action and read its report when it lands
- a condition you can test: `Monitor` with an until-loop, which is also how you enforce the 15 minute cap of step 7 without staring at the clock
- a command you started yourself: start it with `run_in_background` and read it back

Chaining shorter sleeps to get around the block does not work either. This has already cost a blocked turn in several runs.

**Say where you stand in `.claude/tasks/workflow-state.json`, at every transition.** The console watches for runs where you handed control back and nothing is going to wake you up, and only this file tells it that you are legitimately waiting. Follow the "Workflow state" section below: write it when you start a step, right before you end a turn while an agent, a background command or a `Monitor` is still working for you, and once at the very end. Never end a turn mid-workflow without an agent running, a declared wait, or a question asked with `AskUserQuestion`: a hand-back with none of the three is reported to the user as a run with no next action.

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
| Figma | See "Reading a Figma design" below |
| GitLab uploads | `glab api "projects/<url-encoded-project-path>/uploads/<secret>/<filename>" > .claude/tasks/assets/<name>` then `Read` the file to actually look at it. The secret and the filename are the two segments of the upload URL itself (`/uploads/<secret>/<filename>`), and the project path is URL encoded (`group%2Fproject`). Downloading needs no `curl`: `glab api` signs the request itself. The one call in this workflow that does need the token is the screenshot upload of step 9, and the token is read with `glab config get token --host <host>`. Never with `glab auth token`: it is not a subcommand, it prints its own help page on standard output and exits `0`, so the header carries help text instead of a credential and the failure looks like a network error. Name each file after what it shows and confirm it by reading the file, never by trusting the order of the downloads |
| Epic / linked issues | `glab issue view`, `glab api groups/<group>/epics/<iid>` |
| Anything with no API and no MCP (Notion, Docs, random web page) | **Playwright**: `browser_navigate` + `browser_snapshot` + `browser_take_screenshot`. This is the default fallback, never WebFetch |

Write a consolidated `.claude/tasks/ticket-context.md` containing: what and why, acceptance criteria, edge cases, out of scope, Figma node URLs, local paths of downloaded assets, open questions. Store binaries under `.claude/tasks/assets/`.

When two sources say different things, resolve the conflict with the precedence order below and record the arbitration in the context file. Never carry a contradiction forward untouched.

If a resource is unreachable, record it explicitly in the context file. Never silently drop it.

Then audit the ticket for gaps. Read it as an implementer, not as a reader: for every acceptance criterion, ask yourself "could I write this line of code without choosing something the ticket never chose?". List every gap in `.claude/tasks/open-questions.md`, split into:

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
4. **How to exercise the change at runtime**, whenever something outside the repository decides whether step 6 can measure anything: a backend flag that has to be on, a test account, which environment the local app talks to, the exact input that triggers the server side branch you are touching. Read the repository's local runtime configuration first (see step 6) and ask only what it leaves open. This is the last moment the run can ask, and a verification ruled impossible for want of one sentence is a verification nobody does.

Never ask what the run instruction already settles. Asking the user something they just wrote in the command is the fastest way to make the interruption feel useless.

If there are more than three blocking questions, batch them: ask, then ask again. Getting the specification right is worth two consecutive prompts. It is the only place in this workflow where several rounds of questions are allowed.

Record every answer in `.claude/tasks/open-questions.md` next to its question. Answers are part of the specification from now on, and they go into the merge request description.

### Write the acceptance criteria registry

Once the answers are in, and before any plan exists, write `.claude/tasks/acceptance-criteria.json`: the one list of what this run has to prove, with an identifier every later document reuses. The planner links its tasks to these identifiers, every evidence file cites them, and the console computes from them which criterion was verified, on which code, and with what. You are its only writer.

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "criteria": [
    {
      "id": "AC1",
      "text": "La valeur du filtre est conservée au retour sur la page.",
      "revision": 1,
      "source": { "kind": "ticket", "reference": "<ticket URL or document URL>", "excerpt": "the sentence it comes from, verbatim" },
      "verification": {
        "expected": "Le filtre retrouve sa dernière valeur.",
        "requiredChecks": [
          { "id": "AC1-C1", "description": "Quitter puis rouvrir la page", "method": "test" }
        ]
      }
    }
  ]
}
```

- **Only what the specification asks.** A criterion comes from the ticket, a reference document (PRD, design, linked issue), an answer the user gave in step 2, or the run instruction: `source.kind` is one of `ticket`, `prd`, `design`, `linked_issue`, `user_answer`, `run_instruction`, and `excerpt` quotes the words it comes from. An obvious behaviour you deduced stays a deduction in `open-questions.md`; it never becomes a requirement here, and neither does a preference the planner infers later.
- **Identifiers are stable for the whole run**, review rounds included: `AC1`, `AC2`, in the order of the ticket. A criterion discovered later gets the next free number; nothing is ever renumbered or reused.
- **A change of meaning is a new revision.** Rewording that changes what has to be true increments the top-level `revision` and sets that criterion's `revision` to it; the console then stops counting the evidence gathered against the older wording. A typo fix is not a change of meaning.
- **A broad criterion is split into required checks** (`AC<n>-C<m>`, `method` one of `test`, `browser`, `static_analysis`, `manual`). It is verified only when every one of them is. A criterion with a single obvious check needs no `requiredChecks`: it is its own check.
- **Lint, typecheck and the whole test suite are not criteria.** They stay visible as general checks and are never attached to every criterion to make them look covered.
- **No criterion at all is an answer too**: write `"criteria": []` and say why in `open-questions.md`. The console then shows that nothing was identified instead of an empty "all verified".

Write it the way every evidence file of this run is written, to a temporary name renamed into place (`… > .claude/tasks/acceptance-criteria.json.tmp && mv .claude/tasks/acceptance-criteria.json.tmp .claude/tasks/acceptance-criteria.json`), so the console never reads it half written.

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
starts here, so the board should say so without the user having to touch it. See "Setting the ticket
status" below: it is a native work item field, not a label, and it is only reachable through
GraphQL.

---

## Step 4 - Plan and split

Judge complexity from the ticket context.

**Complex** (several surfaces or components, several acceptance criteria, data layer plus UI, migration, unclear scope): invoke `ticket-planner` with the ticket context path and the path of `.claude/tasks/acceptance-criteria.json`. It writes `.claude/tasks/planner-output.json` with atomic tasks, each naming in `criterion_ids` the registry criteria it serves, and `criteria_revision` at the top. Validate that the JSON is well formed, that every `criterion_ids` entry exists in the registry, and that every criterion is served by at least one task or explicitly left out with the reason in `technical_notes`. If the planner lacks codebase context, run an `Explore` agent first and feed its map to the planner.

**Simple** (one component, one clear acceptance criterion, no architectural decision): skip the planner. Write a minimal `planner-output.json` yourself with a single task so downstream agents keep the same contract, `criterion_ids` included: `{"criteria_revision": 1, "acceptance_criteria": ["AC1: …"], "tasks": [{"id": "T1", "title": "…", "criterion_ids": ["AC1"], "dependencies": [], …}]}`.

Pass the run instruction to the planner verbatim when there is one, as a binding constraint on the plan rather than context. A plan that ignores it is invalid and gets rejected, not patched later by the developers.

**Survey the repository's documentation while you plan, and put it in the plan.** List what exists (`docs/`, `README.md`, `ARCHITECTURE.md`, `CLAUDE.md`, per-feature pages, doc indexes, `.env.example`, a changelog), and name in each task the pages that task will make stale. Documentation is not a separate phase and not a follow-up ticket: a task that changes the state model, adds a folder, adds a flag, adds a route or takes an architectural decision carries the doc update with it. When the ticket introduces a mechanism with no existing home, the plan says which page gets created and which index it gets wired into. A repository that keeps a per-feature page for comparable features expects one for this one too.

Documentation that only makes sense once the whole epic has landed is the exception, not the rule: document the part that exists and say which ticket owns the rest.

The planner explores the codebase, so it often surfaces ambiguities you could not see in step 1. Read its `open_questions` and `assumptions`: any blocking one gets asked before implementation starts, and any assumption that silently decides a product rule gets challenged rather than accepted. Fixing the specification here costs one prompt, fixing it after three review rounds costs the whole loop.

Never re-plan mid-run unless a reviewer proves the plan itself is wrong.

---

## Step 5 - Implement, one task at a time

One `developer` agent per task, in dependency order. **Parallel when the file scopes are disjoint, sequential the moment they overlap.**

Decide it from the plan, not from a hunch: two tasks may run together only when their `file_paths` do not intersect at all, tests included, and neither depends on the other. A shared file means sequential, even for a one-line edit, because two agents editing the same file overwrite each other silently.

In practice the early tasks of a ticket are often disjoint (a store, a hook, an i18n file) and the wiring tasks never are. Batch two or three disjoint ones, then fall back to sequential. Announce which tasks you are running together and why.

Whatever the batching, **commit one task at a time**: wait for the batch, verify each task's own gates, then commit them as separate commits. The repository-wide gates (lint, typecheck, the full test suite) are yours to run, once the batch is done and nothing is editing any more. A batch member that reported such a gate as non conclusive hands you a measurement to redo here, and redoing it is not optional: it is the only moment its result means anything.

Each `developer` invocation must receive:

- the task id to implement and the path to `.claude/tasks/planner-output.json`
- the path of `.claude/tasks/acceptance-criteria.json`, the criterion and check ids its task serves (its `criterion_ids`), and the **evidence contract** below, which its `dev-evidence-<task-id>.json` follows
- **the artifact suffix it writes under, which is its task id.** The agent writes `.claude/tasks/developer-report-<task-id>.md` and `.claude/tasks/dev-evidence-<task-id>.json`, never the unsuffixed names. Those two are yours, and you are the only one who writes them (see the merge below). Disjoint `file_paths` keep two agents out of each other's code; they do nothing about output files, and a shared report path is a collision the plan cannot prevent
- **when the task runs in a parallel batch, that fact and the file scopes of its peers**, so it knows the branch is moving under it while it works. Say it plainly: other agents are editing those paths right now, a repository-wide gate run before the batch ends measures their unfinished state too, and a failure outside its own file scope is reported as non conclusive rather than diagnosed. A developer who does not know it has peers will attribute their half-written code to the codebase and hand you a finding you have to disprove
- **in that same breath, that the Playwright browser is shared with those peers.** The tree and the gates are not the only common resource: the whole batch drives one browser, and a peer navigating the current tab mid-measurement is the normal case, not an incident. Tell each member to work in its own tab, to read back the URL in the tool output before trusting any value or any capture, and to redo a measurement it cannot attribute to its own page rather than report it. Two archived runs lost evidence here, one to a screenshot that had recorded a peer's page, the other to a developer who dropped browser evidence entirely because of the contention
- the path to `.claude/tasks/ticket-context.md` and to the downloaded assets
- the Figma node URLs when the task is UI, plus the "Reading a Figma design" procedure below
- the explicit instruction to **verify its own work in the browser with Playwright** when the change is observable in the running app, and to fill the `## Preuves navigateur` table of its report: one row per observable criterion, with the value read from the live DOM, the reference it is checked against, the screenshot path under `.claude/tasks/assets/`, and how to redo the measurement. A temporary harness (fixture route, measurement page, seeded state, `fetch` stub) stays out of the diff, but the recipe to rebuild it goes in `.claude/tasks/browser-recipe.md`, one file for the whole run, appended to rather than overwritten: the reviewers often cannot reach the app themselves, a measurement nobody can redo is one they must record as unverified, and a stub each of them reconstitutes from prose comes back different enough that the difference gets reported as a defect
- **the run instruction verbatim, when there is one**, presented as binding and above its own judgement
- the implementation brief below, verbatim

### Implementation brief (paste into every developer and rework invocation)

> **Standards you must hold to.**
>
> - Write the simplest code that fully solves the task. KISS first, then YAGNI, then DRY. No abstraction, option, config or hook added for a future that is not in this ticket.
> - Reuse what the repository already has: existing components, hooks, utils, tokens, patterns, test helpers. Grep before you write. A new helper is a last resort, and it must be justified in your report.
> - Match the surrounding code: naming, file layout, import style, state management, error handling, i18n. Repository conventions and CLAUDE.md always win over your own habits.
> - Optimize for the next reader. Small functions with honest names, early returns, no clever one liners, no deep nesting, no dead code, no commented out code, no stray debug logs.
> - **Comments: the exception, not the habit. Default to none.** Before writing one, apply the deletion test: delete it, and ask whether a competent developer reading the code could then make a wrong decision. If the answer is no, it does not go in. What survives is a non obvious *why*: an external contract, a product rule the code cannot state, a trap, a load-bearing ordering, a choice that looks like a mistake and would get "fixed". Everything else is noise: a restatement of the code, a step label, a decorative JSDoc block, a duplicate of something already explained elsewhere in the same diff, a comment on a well named function. One line, in English, as short as possible, no block comment. If you feel the urge to explain *what*, rename or split instead. A diff that adds no comment at all is a normal outcome.
> - **Documentation is part of the task, not a follow-up.** A comment explains a line; documentation explains a decision. Anything that is an architectural choice, a non obvious mechanism, a contract between layers, or a rule someone would otherwise have to reverse engineer from the code goes into the repository's documentation, in the same task and the same commit as the code. Concretely: where a thing is mounted and why there rather than somewhere else, the shape of a contract and who fills it, a piece of state and what derives from it, an ordering that must hold, a rule that looks arbitrary until you know the product reason.
> - **Update what already exists before adding anything new.** Look for the repository's documentation first (`docs/`, `README.md`, `ARCHITECTURE.md`, `CLAUDE.md`, per-feature docs, doc indexes, `.env.example`, a changelog) and bring the pages your change makes stale back in line: a new state field where the state model is described, a new folder where the folder layout is listed, a new flag where flags are documented, a new route where routes are listed. A doc that now contradicts the code is worse than no doc. Only create a new page when the subject has no home, and then wire it into whatever index or table of contents the repository keeps, so it is reachable rather than orphaned.
> - Match the existing documentation's form: its depth, its structure, its language, its level of detail. Do not write a tutorial where the repository writes four dense paragraphs, and do not paste code that will drift. Document the why and the shape, link to the code for the rest. If the feature spans several tickets and yours only lands a part, document the part that exists and say plainly what is not implemented yet and which ticket owns it.
> - Handle the real edge cases from the acceptance criteria: empty, loading, error, unauthorized, long content, slow network. Ignore impossible ones.
> - Accessibility and semantics are part of the job on UI work: real semantic elements, labels, keyboard reachability, focus states.
> - **Every element an end to end test needs to reach carries a stable `data-testid`.** The e2e suite lives in another repository and hardcodes these attributes, so an element without one is unreachable and a renamed one breaks a test you cannot see from here. Put one on what a test asserts or drives: interactive controls, the element carrying a value or a piece of copy, each distinct state (empty, loading, error, success), a list and its rows. Skip the purely decorative wrappers, an attribute on every `div` is noise. Follow the repository's existing naming (grep the neighbouring components first, kebab-case in this codebase), name it after the role and never after the styling, reuse the id that already exists rather than adding a second one beside it, and treat an existing id as a contract: do not rename or drop it as part of unrelated work. It is an addition, not a replacement: a testid never excuses a missing role, label or accessible name.
> - Types are strict. No `any`, no non null assertion to silence the compiler, no disabled lint rule without an inline reason.
> - **Always test the code you write.** Every task ships its own tests, in the same task, never "later": a new module gets a test file, a modified behaviour gets its existing test updated or extended. Cover the behaviour, not the implementation, and cover the edge cases from the acceptance criteria, not only the happy path. Test labels in English, phrased to read after the `it`.
> - Run the tests you wrote and make them pass. A test that cannot be written honestly (a real environment limit, not a difficulty) is reported as such, with what it would take to cover it. Never write a test that passes for the wrong reason, never lower an assertion to make it green, never skip or comment out a failing test.
> - Strictly no scope creep. Spotted an unrelated problem? Report it, do not fix it.
> - **When two specifications contradict each other, apply the precedence order: PRD, then design, then ticket.** The PRD wins over the Figma design, the design wins over the ticket description, acceptance criteria and comments. The lower source is outdated, not a refinement. Exception: an explicit later decision (a comment saying the PRD is wrong on this point, an answer given by the user) wins over everything. Silence at a higher level is not a contradiction: a design detailing what the PRD leaves open is normal. Report every contradiction you arbitrated at the top of your report, never resolve one silently.
> - **Never invent what the specification does not say.** Obvious interaction behaviour can be deduced (a close button closes the modal, `Escape` closes an overlay, a spinner shows while loading): implement it and note the deduction. Anything that is a decision (a product rule, a user facing string, a limit, a data source, a permission, an error behaviour) is not yours to choose. Stop that part, report the question at the top of your report, and implement everything else. Never invent copy, never invent an endpoint, never bury a `// TODO: confirm` in the diff.
> - **A gate whose result you report runs through the project's own binary**, `./node_modules/.bin/<tool>` or the package script, never through a bare global command. An alias, a wrapper or a hook can sit in front of a tool and hand back a summary and an exit code it made up, and a gate result that went through one is not a measurement. Summarized or decorated output where the tool prints raw lines, truncated paths, a documented flag rejected as unknown, a search returning nothing on a pattern that is plainly in the file: each is that wrapper showing itself, so re-run through the project binary and report that result. The same goes for reading a file: if what you read looks stripped of its comments or reformatted, read it again with the `Read` tool before you conclude anything from it.
> - Before finishing: run lint, typecheck and tests, and check the change in the browser with Playwright whenever it is observable in the running app, which includes a change that renders nothing but alters what the app sends, stores or hides. Any browser you launch yourself is headless, never a visible window. Report failures you could not fix instead of hiding them, and report them as failures: a red check is never turned green by attributing it to the environment, to the past or to a passing CI. If you had to prefix the project's documented command with anything to get it green, that prefix is itself a finding, and the red result of the documented command is what goes in your report.

If a `developer` comes back with a specification question instead of a guess, it did the right thing. Check first whether the codebase, the design or an obvious convention answers it. If not, ask the user (this is a legitimate interruption, see "Never invent"), record the answer in `.claude/tasks/open-questions.md`, and relaunch the task with the answer. Never answer a product question on the user's behalf.

After each task, commit: `<type>(<scope>): <description>`, conventional commits, one commit per task. Never commit a broken state.

**Nothing this run publishes carries a trace of the session that produced it.** No link to the engine's session (`claude.ai/code/session_…`), and no `Co-Authored-By` trailer, in a commit message, a commit trailer, a merge request description or a comment. That URL points at a transcript nobody on the merge request can open, and a commit message is permanent: taking it back means rewriting pushed history on a branch a merge request already tracks. The engine appends both on its own, so this rule overrides it, and it covers the `fix(...)` commits of step 7 as much as the ones here. Read the message back with `git log -1 --format=%B` right after committing: a trailer added behind you shows up there and nowhere else, certainly not in what you typed.

### Merge the developers' output, at the end of every batch

Each agent wrote under its own suffix. Two files carry the run, and both are yours to assemble:

- `.claude/tasks/developer-report.md`, the concatenation of the per-task reports, each under a heading naming its task. It is a **MANDATORY** input of `senior-reviewer` and `qa-reviewer`: what is missing from it is missing from the review.
- `.claude/tasks/dev-evidence.json`, one object `{"schemaVersion": 2, "source": "developer", "criteriaRevision": <n>, "items": [...]}` whose `items` are every per-task `items` array end to end, in task order, **copied unchanged**: same `id`, same `criterionIds`, same `codeSnapshotId`. This is the developer file the console's per-source view reads by that exact name, and the ids are what lets the console count an item seen in both files once. Never renumber an item, never give two items the same id, and never merge two items into one.

**Merge, never replace.** A later batch, and a rework round in step 7, add their rows to what is already there. Keep the per-task files, they are the archive; the merged pair is the view. An archived run that shows seven measurements while its suffixed files hold fifty-two is the failure this contract exists to prevent, and it happened.

### Close step 5 with a roll call against the plan

The implementation phase is not over because the last agent you launched came back. It is over when every task in `planner-output.json` is accounted for. Before you open step 6, put the plan's task ids next to the `developer-report-<id>.md` files that exist and read the two lists against each other, in both directions:

- **A plan id with no report is a task that never ran.** Launch it now, as step 5 describes, and commit it like any other. Do not push it into the review phase, do not demote it to a follow-up ticket, and do not conclude from the diff that it looks done anyway: the per-task report is what feeds the merged one the reviewers read, so a task without one is a task nobody checks.
- **A report under an id the plan does not carry means the ids drifted.** Say which plan task it actually implemented, or relaunch it under the right id. That suffix is the only mapping between the plan and what was built, and a renumbered one breaks it without a trace.
- **A task you decided not to run is written down, not left silent.** Name it in the merged `developer-report.md`, with what covers it instead and why. A stated decision is something a reviewer can challenge; an absence is not.

Three archived runs opened their review with a hole here: nine planned tasks and eight reports, seven planned tasks with a report numbered past the end of the plan, and ten planned tasks with the first and the last missing. The first cost the most: the task that never ran was the documentation update, QA raised it as a `P1` in its second pass, and the run paid an extra rework round and about seventeen minutes over its review budget for something a file listing showed at a glance.

---

## Step 6 - Make the app reachable and measure the change in it

Before the review phase, if the change is observable in a running app:

- **Establish the port from the project's own configuration before you start or probe anything.** Read `.env`, `.env.local`, `docker-compose.yml`, the framework config, or an OAuth/callback URL for the port the app actually expects, and use that one explicitly. Two archived runs lost time to guessing instead: one polled the framework's default port for over twenty minutes while `.env.local` named a different one, the other started on the default port and broke the OAuth callback that expected another — both found out only after repeated failed connections.
- Use the `run` skill (or the repository's documented dev command) to start the app and get a URL.
- Note the URL, the route to reach the feature, and any test credentials in `.claude/tasks/state.json`.
- **Every browser of the run is headless, including the one that logs in.** Never launch one with `headless: false`, `--headed` or a visible window, and never reconfigure the Playwright MCP: a window that opens takes the focus of the user's machine while other runs work in the background. When the app sits behind a login, fill the login form yourself from a headless script with the test account the user provides (read the secret at the moment you type it, never print or write it), export `context.storageState()` and add those cookies to the MCP browser. With no test account, ask for one in step 2, or record the checks behind the login as blocked. One archived run opened a visible Chromium for the user to sign in to, and wrote that procedure to memory for every later run.

**Observable is wider than visible, and this is where runs lose their best evidence.** A change that renders nothing is still observable when it changes what the app does: a request body or a header, an id chained from one call to the next, a tracking event, a redirect, a cache or storage write, a bubble that must now stay absent. Those are read in the browser, from the network panel and the live DOM, and nothing else proves them: a unit test proves the code's own contract, never what the running app sends over the wire. "The ticket adds no pixel" settles whether a design review runs. It does not settle whether a measurement runs.

**Establish that a verification is impossible, never assume it.** Before writing that the change cannot be exercised, read the repository's local runtime configuration and report what you found: which backend the dev server or the Storybook actually talks to (endpoint files, proxy setup, `.env.example`, docker-compose, seeds, fixtures), and whether the state you need is reachable from there. A local app pointed at a shared test environment already has that environment's flags and data. Name the files that carry your conclusion. A feasibility claim with no file behind it is a guess, and a guess here costs the run its only live evidence. If the answer depends on something the repository does not hold, that question belonged in the step 2 batch, where it is still askable.

**Measure here, on the committed code, before the review phase opens.** Step 7 runs agents that edit files, and a measurement taken while the code moves under it is worth nothing (see the ordering constraints there).

If the app really cannot be started, say so explicitly with the reason you established: the design review will be skipped and QA confidence drops. Do not pretend a visual review happened.

**An unreachable app does not make the visual criteria unverifiable.** The developer measured them and left screenshots and numbers behind, so collect the `## Preuves navigateur` rows from `.claude/tasks/developer-report.md` and the files under `.claude/tasks/assets/`, and pass both on with the reason the app is out of reach. That evidence becomes the reviewers' reference: they confirm each criterion against it, or name it unverified. What must never happen again is a reviewer writing "browser check not run" while the measurement it needed sat in `.claude/tasks/assets/`.

---

## Step 7 - Challenge the implementation

**Size the review to the diff before you delegate anything.** The review phase costs the same on a four line fix as on a feature. Read `git diff --stat <base>...HEAD` and pick a tier. Announce which tier you picked and why, in one line.

**Tier 0, one short correctness review.** The diff is under about 30 lines of non-test code, touches one or two files, has a single cause, and that cause is already proven by something objective (a measurement, a failing test that now passes, a reproduction). You still get a second pair of eyes, but a narrow one: **a single `senior-reviewer`, one pass, no orchestrator, no rework loop**, invoked with a Sonnet model override (the mandate below is narrow enough that Sonnet holds the same bar at a lower cost; reserve Fable, the agent's default, for tier 2), while you run the gates yourself (lint, typecheck, tests, one browser measurement when the change is visible).

Give that reviewer an explicit mandate, because left unbounded it will spend twenty minutes returning comment wording and test naming:

> Review this diff for correctness only, and stop there. Four questions, nothing else: does the change actually remove the cause it claims to remove; does it break anything that used to work, in particular any other call site or caller of what you changed; do the new tests fail on the pre-fix code; is any acceptance criterion left unmet. Report `P0` and `P1` only. Naming, comment wording, style, file organisation, test phrasing, suggestions and nitpicks are explicitly out of scope on this tier: skip them, do not list them, not even as `P2`. Do not audit untouched code. Fix a real defect if you find one, otherwise change nothing and return a one paragraph verdict.

Reserve about 10 minutes for it, and stop it past that. Then go to step 8 with whatever it returned. If it comes back with only out-of-scope remarks, that is the expected outcome on a diff this size, not a reason for another round.

**Tier 1, one sequential pass.** A handful of files, no architectural decision. Run `senior-reviewer` with a Sonnet model override, then `qa-reviewer`, once each, and rework only `P0` and `P1`. No second pass unless a `P0` is still open. No orchestrator: you sequence the two agents yourself.

A rework developer you invoke yourself gets `rework<N>` as its artifact suffix, and you merge what it wrote into `developer-report.md` and `dev-evidence.json` the same way as at the end of a batch. At tier 2 the orchestrator does that merge for you.

**Tier 2, the full loop below.** Several surfaces, a data layer plus UI, a migration, or a design to conform to. This is the only tier that gets `review-orchestrator`. `senior-reviewer` keeps its default Fable model at this tier: the review spans more surfaces across up to two rework rounds, and the cost of a missed defect here is higher than the model gap.

**The gates you run yourself still get written down.** At tier 0 no `qa-reviewer` runs, so nobody writes `.claude/tasks/qa-evidence.json` and the console's "Preuves" tab reports the tests as never run while they were green in your own terminal. Once lint, typecheck and tests have run, write that file yourself, same schema as `qa-reviewer`'s:

```json
{
  "schemaVersion": 2,
  "source": "qa",
  "status": "PASS | PASS_WITH_WARNINGS | FAIL",
  "round": 1,
  "criteriaRevision": 1,
  "producer": { "role": "pilot" },
  "codeSnapshot": { "atStart": "<id>", "atEnd": "<id>" },
  "items": [
    { "id": "GATE-1", "label": "string", "verdict": "pass | fail | not_run", "method": "test", "command": "string", "actual": "string" },
    { "id": "PILOT-1", "label": "string", "verdict": "pass | fail | not_run", "criterionIds": ["AC1"], "method": "test", "command": "string", "actual": "string" }
  ]
}
```

One item per gate (`GATE-<n>`, no `criterionIds`: a gate verifies the change as a whole, never a criterion), plus one item per criterion you verified yourself with something objective, a targeted test that failed before the fix and passes now being the usual one (`PILOT-<n>`, citing the criterion). `label` and `actual` in French, `command` the literal command run, the JSON keys and verdict tokens in English exactly as shown. A gate you did not run is an item with `not_run` and the reason in `actual`, never a missing item. The rest of the evidence contract below applies: snapshot, atomic write.

**`pass | fail | not_run` is the set a gate row takes, not the whole schema.** When a `qa-reviewer` ran, that file is its output and it carries three more tokens for the observable criteria it reports on: `measured`, `confirmed` and `unverified` (see `agents/qa-reviewer.md`). The console renders all six. So do not touch the verdicts in a file a reviewer wrote: `measured` is not a malformed `pass`, and flattening it deletes the one thing those tokens exist to record, whether QA measured a criterion itself or took it from the developer's evidence. Normalise a verdict only when it falls outside those six tokens.

**Bound every tier in time, whatever the tier.** Two rules, both enforced by you:

- **The review must not outlast the implementation.** Note when step 5 ended. Once the review phase has run about as long as the implementation did, stop launching new rounds: take what the running agents have produced, commit it, and put whatever is unresolved in the step 9 comment as an explicit "not verified" line.
- **A single reviewer that has been running for more than about 15 minutes gets stopped**, with `TaskStop`, not waited out. Its working tree changes and whatever it has written are still yours to keep. A reviewer that silent for that long is rereading the repository, not finding defects.

Never let a review round start that you are not willing to wait for. Idle waiting is the failure mode here, not a missed nitpick.

Delegate the whole review phase to the `review-orchestrator` agent, passing: base branch, feature branch, artifact paths (the criteria registry `.claude/tasks/acceptance-criteria.json` among them), app URL and route, Figma links, whether a design is available, **the developer's browser evidence** (the `## Preuves navigateur` rows and the screenshot paths from step 6), **the evidence contract below**, and **the run instruction verbatim when there is one**. Reviewers must judge the code against it too: something it explicitly asked for is never a finding, and something it forbade that shows up in the diff is a P0.

Whatever the tier, scope every reviewer to **the diff**, never to the repository: name the files and say explicitly that untouched code is out of scope. An unbounded reviewer will audit whatever it finds, and that is where the hour goes. And whatever the tier, the browser evidence from step 6 travels with the scope, orchestrator or not: on tiers 0 and 1 you hand it to the reviewer yourself.

It runs the review loop (`senior-reviewer`, `designer-reviewer` when a design exists, `qa-reviewer`), routes findings back to `developer`, and stops when only minor findings remain.

**Ordering, which is a real constraint and not a preference:**

- `designer-reviewer` and `qa-reviewer` **never run at the same time**: they share a single browser.
- **No agent that edits files runs while any browser measurement is in flight**, and that covers your own step 6 measurement, a `qa-reviewer` driving the app and a design review alike. The dev server hot-reloads, so a fix landing mid-measurement replaces the code under test and the numbers describe a build that no longer exists. `senior-reviewer` reads code and never opens a browser, so it **may run alongside a measurement**, on one condition: it must hold its fixes until that measurement is done. Either it reports and the fixes land after, or it runs on its own before.
- A measurement whose code moved under it is **reported non conclusive and redone on the frozen code**, or carried to step 9 as unverified. It is never presented as a result, and the run never simply forgets it: an abandoned measurement that nobody redoes is how a feature ships with no live evidence at all.
- When in doubt, sequential. A browser review has already produced false findings from a moving target; a faster loop that returns wrong findings costs more than the minutes it saves.

Instructions to pass on to the design review every time, because every one of these failures has already happened:

- **measure, never eyeball.** Every visual claim must be a value read from the live DOM via `getComputedStyle` against a value read from Figma, reported side by side. It must never conclude PASS on the grounds that it lacks a reference value: a missing reference means it has not finished reading Figma, including the parent frame
- **check resulting positions, not only declared values.** Matching every colour, radius, padding and font metric proves nothing about where things actually land. Compare the rendered geometry against the design: alignment between neighbouring elements, vertical centring within a row, baselines, equal gaps, and what changes across breakpoints
- **review in both directions.** Design to code catches what is missing. Code to design catches what was added: an element, a state, a colour or a spacing that exists in the render and corresponds to no node in Figma. The second direction is the one that gets skipped, and it is how invented hover fills, invented focus rings and stray decorative elements have shipped unreported. The review must enumerate what it actually sees on screen and map each piece to a Figma node; anything it cannot map is a finding, not a detail
- **compare resolved colour values, never token names.** A token can be right by name and wrong by value, and a raw hex can be one shade off the design's. Every colour in the diff gets its resolved `rgb()` set against the Figma hex, including borders, shadows, icon strokes and text. "Uses the brand token" is not a verdict
- **exercise every interactive state the design provides.** Hover, focus, keyboard focus, selected, disabled, empty, error. Drive each one in the browser and measure it. A state the design specifies and the review could not reach is reported as unverified, never as a pass
- **it never files a blocking finding about behaviour.** It has no code access and cannot know the app's real state, so a behaviour that looks wrong is an observation for QA with the exact steps, not a defect with a severity. Its severities apply to visual deviations only

**Before launching the design review, extract the diff's own style values and hand them over.** The reviewer has no code access, so it cannot discover that the implementation invented something: it can only check what it is told to look for, and left to itself it checks the list you wrote in `ticket-context.md`, which by construction contains only what Figma specifies. Close that hole yourself: grep the diff for every colour, radius, shadow, border, spacing, font metric and interactive state, and pass the list split in two.

- **values with a Figma source**: the reviewer measures them against the design, as above
- **values with no Figma source**: each one is a finding by default, at least `P2`. It survives only if it is justified by an existing repository idiom named with `file:line`, or by an accessibility requirement the design is silent about. Anything else is removed, not kept because it looks fine. Write the justification in the merge request notes, so an invented value is a recorded decision rather than an accident

An implementation that adds nothing the design does not show is the target. When it does add something on purpose, say so out loud in the review comment and in the MR description.

Loop exit criteria, enforced by the orchestrator:

- no `P0` and no `P1` left on any dimension
- QA status `PASS` or `PASS_WITH_WARNINGS`
- `P2` findings may remain: they are reported, not fixed
- the designer's "Écarts préexistants" may remain whatever their severity: they concern elements the ticket does not touch, and they are reported for a follow-up ticket, not fixed
- **at most two rework rounds**, and the time bound above applies over them. A third round means the implementation or the plan is wrong, not that another pass is needed: stop, and say so in the report

When the review phase is over, read what the tier you picked actually produced, and never a file that tier cannot write:

- **tier 2**, the only tier with an orchestrator: `.claude/tasks/review-summary.md`, which the orchestrator writes.
- **tier 0 and tier 1**, where you sequence the reviewers yourself: their own artifacts, `.claude/tasks/senior-review.md`, `.claude/tasks/qa-report.md`, and `.claude/tasks/designer-review.md` when a design review ran. There is no summary file on these tiers, so consolidate them yourself. Waiting for `review-summary.md` here is waiting for a file nobody writes.

Then commit any code the reviewers changed with a `fix(...)` or `refactor(...)` commit. Version control stays your responsibility, never theirs.

If it comes back blocked (loop limit reached, `P0` still open), do not throw the work away: still push the branch and still open the merge request, but as a **draft**, with a `## Blocked` section at the top listing what remains open and what was tried. A draft MR with an honest blocker section is more useful than a lost branch.

**Close the Playwright browser here if one is open (`browser_close`).** Step 6 or the review agents may have left it running; steps 8 to 10 never touch the running app, and a browser process left open outlives the run for nothing.

---

## Step 8 - Merge request

**Read the acceptance summary first.** When the console runs the session (`IMPL_RUN_ID` is set), it keeps `.claude/tasks/acceptance-summary.md` up to date from the registry and every evidence file, with the same computation its "Preuves" tab shows: one sentence ("5 critères vérifiés sur 8 · 1 échec · 1 bloqué · 1 non vérifié"), the criteria that are not verified and why, and a detail table for step 9. Use it as it is. A criterion it reports unverified, blocked or failed is never reworded as validated, anywhere. When the file is absent (no console), write the same content yourself from the registry and the evidence files, by the same rule: a criterion is verified only when evidence taken on the final code says so.

That summary feeds the decisions this workflow already takes; it is not a second verdict. A criterion in failure is an acceptance criterion not met, which is a `P0` of the review loop and, if still open, the draft case below. A blocked criterion goes under `## Blocked` when the merge request is a draft, and into the step 9 comment as not verified otherwise.

Write the description to `.claude/tasks/mr-description.md` first, then push the branch and open the merge request in one call, as a normal merge request (not a draft) targeting the base branch from step 2.

```bash
git push -u origin <branch>
glab api --method POST "projects/:fullpath/merge_requests" \
  --field "source_branch=<branch>" \
  --field "target_branch=<base>" \
  --field "title=feat: <english title>" \
  --field "description=@.claude/tasks/mr-description.md" \
  --field "remove_source_branch=true"
```

Two things this single call settles, and neither is optional:

- **The description comes from the file, never from the command line.** `--field "key=@<file>"` reads the file instead of passing its content through the shell, so the backticks and the quotes of a long Markdown description survive intact. `glab mr create` has no file flag for the description, only `-d`, which is why the REST endpoint replaces the subcommand here rather than being paired with it.
- **No filler content is ever published, not even for a second.** A merge request is public the instant it exists: it fires a notification, mails the subscribers, and whoever opens the link in that window reads what is there. Creating one with a stand-in description and patching it a moment later puts fake content in front of real people, and `placeholder` reads as a botched description rather than as a transient state. The description is written before the merge request, never after.

The response carries `iid` and `web_url`; keep both, steps 9 and 10 need them. For the blocked case above, prefix the title with `Draft: ` - the REST call has no `--draft` flag.

**Then set the reviewer, in a second call.** The merge request always goes out with one: the person who started the run. Resolve them, never hardcode an id or a login.

```bash
glab api user                                        # read "username" from the response
glab mr update <iid> --reviewer <username>
glab api "projects/:fullpath/merge_requests/<iid>"   # read "reviewers" back
```

- **The subcommand, not the REST field.** `glab api --method PUT … --field "reviewer_ids[]=<id>"` answers **HTTP 400**: that array form is not accepted here. `glab mr update --reviewer` answers `requested review from "@<username>"` and is the form that works.
- `glab api` has no `--jq` flag, so read the field out of the JSON response rather than filtering it on the command line.
- **Read it back, always.** The third call is not a formality. This field is in the same family as the `assignee_ids` that GitLab accepts and ignores, so a call that returns without error proves nothing. The reviewer is set when you have read the name back out of `reviewers`, and a reviewer you could not read back is reported as not set.
- Reviewer and assignee are two different fields. Setting the first never sets the second, and the rule above stands: no assignee.

Rules:

- Title in English, conventional prefix (`feat:`, `fix:`, `refactor:`)
- **No assignee at all.** Do not assign the MR to anyone. The reviewer is a different field, set above, and that one is never skipped
- No manual label, no estimate
- **Always link the MR to its ticket**, without exception. Two things, both required:
  - the full ticket URL on the first line of the description, so the link is visible and clickable whatever GitLab does with keywords
  - the keyword: `Closes #<iid>` when the target is the project's default branch, `Related to #<iid>` otherwise (a merge into a feature branch closes nothing, so `Closes` would be a lie)
  - both go into the description file before the merge request is created, so the link is there from the first second
- **Never merge the MR yourself.** The user merges.

Once the merge request is open, move the ticket to **In progress -
Merge request** (see "Setting the ticket status" below). Do it even when the run ends blocked and
the merge request is a draft: the work has left implementation either way.

Description template (`.claude/tasks/mr-description.md`). **Keep it short.** A reviewer reads the code, not a report: aim for 25 lines or so, and never pad it to look thorough.

```md
Closes #<iid>

## Résumé

Two or three sentences: the user facing problem, and what happens instead now.

## Changements

Three to five bullets, one per notable item. File names only when they help the reader find their way.

## Critères d'acceptation

The summary sentence, then one bullet per criterion that is not verified, with its reason in a few words. Nothing more: the detail goes in the step 9 comment. Omit the bullets when every criterion is verified.

## Notes d'implémentation

Only what the code cannot say on its own: a decision that looks like a mistake and would get "fixed", a deliberate widening or narrowing of the ticket, a trap. Two or three at most, and having none is a valid outcome. If a note only describes what the diff shows, drop it.

Hors scope selon le ticket : ...
```

What does **not** belong in the description, because it is noise for the reviewer:

- test counts, coverage percentages, lint and typecheck output, build status. It either passes or the MR is not ready
- the list of everything that was verified, or verified in a browser
- design conformance tables, before and after values, findings and their severities
- follow-up ideas, out of scope discoveries, open product questions
- the reasoning history: what was asked, what was deduced, what was arbitrated

All of that either belongs in the review comment of step 9, or nowhere. The description answers "what changed and why", nothing else.

One more thing is banned here, for a different reason than noise: **the link to the engine's session**, and the `Co-Authored-By` trailer. That is the step 5 rule, and it holds for this description and for the step 9 comment exactly as it holds for a commit message.

---

## Step 9 - Post the code review as an MR comment

Once the loop is over and only minor findings remain, publish the consolidated review as a comment on the merge request. This is mandatory, on a `READY` verdict as well as on a `BLOCKED` one.

Build it from the sources step 7 named for your tier (`review-summary.md` at tier 2, the reviewers' own artifacts below it) plus the per round archives, write it to `.claude/tasks/mr-review-comment.md`, then post it:

```bash
glab api --method POST projects/<id>/merge_requests/<mr_iid>/notes \
  --field "body=@.claude/tasks/mr-review-comment.md"
```

**A screenshot that backs a claim travels with the comment, not just in words.** `.claude/tasks/assets/` is only a path on this machine; nobody reading the merge request can open it, so a verification described in prose with no image reachable from there is unverifiable to that reader, whatever proof sat in the run's evidence. Before posting, upload every screenshot that backs a claim in the report (skip a debug capture nobody cites) to the project, one call per file:

```bash
curl -sS --request POST \
  --header "PRIVATE-TOKEN: $(glab config get token --host <host>)" \
  --form "file=@.claude/tasks/assets/<name>.png" \
  "https://<host>/api/v4/projects/<url-encoded-project-path>/uploads"
```

`<host>` is the GitLab host of the ticket URL, `gitlab.com` in the normal case. **This is the one call in the workflow that `glab api` cannot make.** `POST /uploads` only accepts `multipart/form-data`, while `--field` and `--raw-field` only ever build a JSON body: `glab api --method POST .../uploads --field "file=@<path>"` sends the bytes of the PNG as a JSON string and GitLab answers `400 Bad Request`, on every project and every file. Reaching for `glab mr note` instead does not help either, because the image has to exist on the project before any comment can link to it.

The response's `markdown` field is already a ready-to-embed image link. Paste each one under `### Captures`, with a one-line caption naming what it proves. An upload that fails leaves its claim without an image: say so in the `### Validation` section rather than dropping the caption silently or pointing at a local path.

Use [conventional comments](https://conventionalcomments.org/) for each finding, exactly like `/implementation-harness:review`:

```md
## Revue automatisée

Les revues senior, QA et design ont tourné sur N rounds. Les constats ci-dessous sont ce qui reste après la boucle de retouches.

### Constats

**issue (blocking):** `path/file.ts:42` - sujet

Why it matters, in one or two sentences.

**suggestion (non-blocking):** `path/file.tsx:15-28` - sujet

What to change and why.

**nitpick (non-blocking):** `path/file.tsx:60` - sujet

**praise:** `path/file.ts:10` - sujet

### Corrigé pendant la boucle

- [P0] ... (relevé par senior, corrigé au round 2, confirmé par QA)

### Critères d'acceptation

The detail table of `.claude/tasks/acceptance-summary.md`. Every attachment it names is a local path: link it only once uploaded as below, with the returned link; one that was not uploaded is written "capture restée locale", never as a path.

### Validation

- Lint / typecheck / tests : ...
- Vérification navigateur : routes et viewports, ou pourquoi ça n'a pas pu tourner
- Revue design : comparée à Figma / ignorée et pourquoi

### Captures

![légende décrivant ce que la capture prouve](lien markdown renvoyé par l'upload)

### Verdict

`à merger` | `changements mineurs` | `à retravailler` - one or two sentences.

N blocking - N non-blocking - N nitpicks - N praise
```

Rules for this comment:

- Everything in French, findings anchored on `file:line`
- Only what survived the loop, plus what was fixed. No speculation, no hypothetical future problems
- Honest about what could not be verified. Never claim a browser or design check that did not happen
- One single comment, not one per finding
- Every screenshot cited as evidence is uploaded and embedded, never left as a local path GitLab cannot resolve; omit the `### Captures` section entirely when no browser evidence exists to back it
- If the API call fails, fall back to `glab mr note <mr_iid> --message "$(cat .claude/tasks/mr-review-comment.md)"` and report the fallback

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

**Declare the end first.** Write `workflow-state.json` with `"state": "completed"` and its `result` (see "Workflow state"), before the archive sync below, so the console knows the run reached its end rather than lost its session.

**Before cleaning, let the console archive what the run leaves behind.** When `IMPL_RUN_ID` is set, write a sync request with a fresh id, then wait for the console's answer carrying that same id, for up to two minutes, with `Monitor` and an until-loop rather than a `sleep`:

```bash
REQUEST_ID="sync-$(date +%s)"
printf '{"requestId":"%s"}\n' "$REQUEST_ID" > .claude/tasks/archive-sync-request.json.tmp && mv .claude/tasks/archive-sync-request.json.tmp .claude/tasks/archive-sync-request.json
# then wait until .claude/tasks/archive-sync-ack.json contains "$REQUEST_ID"
```

The answer lists the versions kept and any capture still missing. Report a missing one, or an answer that never came, in the final report: the evidence of this run would be lost with the directory. Without `IMPL_RUN_ID` there is no console to archive anything; skip the request.

**Always clean `.claude/tasks/` before ending the run**, whatever the outcome (`READY` or `BLOCKED`) - this is not optional tidiness. Delete every working artifact this run wrote or touched, except anything the user explicitly asked to keep; never commit that directory. Leftover files from a run are not inert: `.claude/tasks/` is not scoped per ticket, so a stale `ticket-context.md`, `planner-output.json`, or `developer-report-*.md` from an earlier, unrelated run will be sitting there the next time `/implementation-harness:implement` starts, ready to be misread as belonging to the current ticket. Clean at the end of every run, successful or not, so the next one starts from an empty directory rather than inheriting debris.

**Name the directory by its absolute path, spelled out, in the removal itself.** Resolve the root once (`git rev-parse --show-toplevel`), then write the literal path, for example `rm -rf /abs/path/to/repo/.claude/tasks`: no `cd` before the `rm`, no shell variable, no relative path or relative glob. Claude Code's built-in removal check cannot resolve a relative target behind a `cd` or a variable, so it holds the run on a permission prompt nobody answers, denies it after two minutes, and the directory stays. If the check still refuses, do not work around it: put the exact command in the final report and leave it to the user.

---

## Evidence contract

Every evidence file of the run (`dev-evidence-<suffix>.json` and its merge, `qa-evidence.json`, `design-evidence.json`) follows this contract, whoever writes it. Pass this section on to every agent that writes one. The console reads these files as data and archives each version: what they claim is what the merge request summary will say.

```json
{
  "schemaVersion": 2,
  "source": "developer | qa | design",
  "round": 1,
  "criteriaRevision": 1,
  "producer": { "role": "developer | qa-reviewer | designer-reviewer | pilot" },
  "codeSnapshot": { "atStart": "<id>", "atEnd": "<id>" },
  "items": [
    {
      "id": "unique in the run",
      "label": "string, in French",
      "verdict": "pass | fail | not_run | measured | confirmed | unverified",
      "criterionIds": ["AC2"], "checkIds": ["AC2-C1"], "taskIds": ["T3"],
      "method": "test | browser | static_analysis | manual",
      "observedAt": "ISO 8601",
      "expected": "string", "actual": "string", "command": "string", "note": "string",
      "screenshot": "assets/relative-path.png", "attachments": ["assets/other.png"],
      "supersedes": ["an earlier id"], "confirms": "the id of the evidence inspected",
      "blocker": { "reason": "what prevented the check", "action": "what it would take" }
    }
  ]
}
```

- **Identifiers are unique in the run and never reused.** Developer `<task-id>-E<n>` (rework `rework<N>-E<n>`), QA `QA-R<round>-<n>`, design `DS-R<round>-<n>`, your own gates `GATE-<n>` and checks `PILOT-<n>`. A later round that verifies the same check again writes a **new** item with a new id and names the earlier one in `supersedes`. That is the only way a success replaces an earlier failure; a failure left unreplaced keeps the criterion from turning green.
- **Links.** An item about a criterion cites it in `criterionIds`, plus the `checkIds` it covers when the criterion lists several required checks. General gates (lint, typecheck, the whole suite, a build) cite nothing. `criteriaRevision` is the registry revision the producer read.
- **Blocked is not unverified.** A check prevented by something concrete (an unreachable environment, missing credentials, a state that cannot be reached) is `not_run` or `unverified` with a `blocker` naming the obstacle and what would unblock it. Without a named obstacle it is simply unverified.
- **A confirmation names what it checked.** `confirmed` always carries `confirms` with the id of the evidence inspected; it stays worth that evidence, on the code that evidence was taken on.
- **The code version comes from the shared utility, never from you.** Run `node "$IMPL_CODE_SNAPSHOT"` right before the first measurement of a sequence and right after the last, and copy the `id` of its JSON output into `codeSnapshot.atStart` and `codeSnapshot.atEnd` (or `codeSnapshotId` / `codeSnapshotAtEnd` on each item, which is what developers do so a merge keeps them). Never type, shorten or edit an id. When `IMPL_CODE_SNAPSHOT` is unset or the command fails, leave the fields out: the console then shows "version inconnue", which is true. Two different ids around one measurement mean the code moved under it: that measurement is not conclusive, and it is redone rather than reported.
- **Written whole, then renamed into place**: write `<name>.json.tmp`, then `mv` it over `<name>.json`. The console reads files as they land, and a file caught half written is counted as nothing.

## Workflow state

`.claude/tasks/workflow-state.json` says what you are doing and what comes next. The console reads it as data; hooks tell it what happened, only this file tells it what you expect to happen. Write it whole to `workflow-state.json.tmp`, then `mv` it into place, like every other file the console reads.

```json
{
  "schemaVersion": 1,
  "revision": 7,
  "state": "working | waiting | completed | blocked",
  "step": "5",
  "nextAction": {
    "kind": "run_step | await_agent | await_process | await_dependency | deliver",
    "taskIds": ["T3"],
    "agents": ["developer"],
    "expectedArtifact": "qa-report.md",
    "description": "string, in French: what happens next, in one sentence"
  },
  "result": {
    "delivery": "merge_request | draft_merge_request | none",
    "mergeRequestUrl": "https://…",
    "blockers": ["string, in French"]
  }
}
```

- **`revision` starts at 1 and goes up by one on every write.** A lower revision is ignored.
- **`working`** when you start a step (`step` is its number, `nextAction.kind` `run_step`).
- **`waiting`** right before you end a turn while something works for you: `await_agent` with the `agents` and `taskIds` of the batch you launched in the background, `await_process` for a background command or a `Monitor` you are waiting on, `await_dependency` for anything else outside the session, with `expectedArtifact` when a file will mark the end. A declared wait never hides a run for long: with no agent actually running, `await_agent` is reported as no next action, and the others turn into a doubt after the silence threshold.
- **`completed`** once, at step 10, before the archive sync: `result.delivery` is `merge_request` or `draft_merge_request` with the `mergeRequestUrl` you opened, or `none` with every reason in `blockers`. A draft merge request with known blockers is a correct end: list them. The console checks the end against the merge request it saw; an end it cannot confirm does not close the run.
- **`blocked`** when you stop for one of the two reasons "Never invent" allows, with `nextAction.description` naming what would unblock the run.

Without `IMPL_RUN_ID` there is no console reading it; write it anyway, it costs nothing.

## Specification precedence

When two sources of truth contradict each other, the higher one wins:

0. **The run instruction** (the command's second argument) and the answers the user gives in step 2. These are current decisions about this run, so they beat every document. Nothing overrides them
1. **PRD** (or any product specification document: Notion, Google Docs, Confluence, the epic description when it plays that role)
2. **Design** (Figma, and the mockups or screenshots attached to the ticket)
3. **Ticket** (description, acceptance criteria, comments)

A ticket that contradicts the design does not override it, and a design that contradicts the PRD does not override it either. The lower source is treated as outdated, not as a refinement.

Two exceptions, and only two:

- **An explicit later decision beats the order.** A ticket comment that says "the PRD is wrong on this point, do X" is a decision, not a contradiction. Same for an answer the user gives in step 2, and same for the run instruction. Record it as such.
- **A gap is not a contradiction.** Silence at a higher level is not a conflict: the design detailing what the PRD leaves open is normal, follow it.

Never resolve a contradiction silently. Write it down in `.claude/tasks/ticket-context.md`: which sources disagree, on what, which one you applied and why. It goes into the merge request description too. If applying the precedence order changes something user facing in a way that looks unintended (the PRD looks simply stale rather than authoritative), it becomes a blocking question for step 2 instead of a decision you take alone.

---

## Never invent

A specification gap is never filled by imagination. Three ways out, in this order:

1. **Deduce, when it is genuinely obvious.** Standard interaction behaviour, an existing convention in the repository, a comparable screen already shipped, an explicit answer in the Figma file. A close button closes the modal, a cancel discards and closes, `Escape` closes an overlay, a spinner shows while loading. The English translation of a French string the ticket does provide also belongs here: translate faithfully, never ask. Implement it and write the deduction down in the report.
2. **Ask, when the answer is a decision.** A product rule, a user facing string, a limit or threshold, a data source, a permission, an error behaviour, a scope boundary, a state the ticket never mentions. These are not yours to choose, whatever the cost in autonomy.
3. **Never guess in silence.** No plausible placeholder copy, no invented endpoint, no arbitrary limit, no `// TODO: confirm with product` buried in a diff.

Most gaps surface in step 1 and are asked in step 2. A gap that only surfaces during implementation is the one legitimate reason to interrupt again: ask it, then resume. `developer` and reviewer agents must escalate such a gap to you rather than decide it themselves.

Every deduction and every answered question ends up in the merge request description, so the user can see what was assumed and what was decided.

---

## A red check is never a pass

A check is red or it is green. Nothing about where the failure comes from changes that, and none of these makes it green: a passing CI on the base branch, the same failure existing before the change, an environment that resolves a dependency differently, a machine-specific setup. Those explain a red check. They do not convert it.

This is the one place where reclassification is the failure mode rather than the fix, so the rule is mechanical.

- **Run the command the project documents**, the one in its `README`, its `CLAUDE.md` or its CI configuration. That command's result is the result. Discovering a variant that passes is useful and gets reported, but it never replaces the documented command's outcome.
- **The command you typed is not always the command that ran.** A shell alias, a wrapper or a hook can stand in front of a tool, rewrite its arguments, summarize its output and return an exit code of its own making. That breaks this rule from underneath: a gate whose exit code was synthesized by something other than the tool is not a measurement, green or red. Read the output for the signs, they are unmistakable - a summary or a decorated recap where the tool prints raw lines, truncated paths, a flag the tool documents rejected as unknown, a search that returns nothing on a pattern you can see in the file, a builtin behaving like an unrelated program. When you see one, re-run the gate through the project's own binary, `./node_modules/.bin/<tool>` or the package script that wraps it, and report that result. A wrapper masking a green is the same defect as one masking a red; only the direction of the lie changes.
- **If a prefix, a flag or an exported variable was needed to get green, the prefix is itself a finding.** Report it as "the documented command is red, this variant is green, here is the difference", never as "the suite passes". A suite that only passes under an undocumented incantation is a defect of the project or of the harness, and it is reported as one.
- **Name the cause down to the mechanism, or say you did not find it.** "Environmental", "local resolution problem", "pre-existing" are categories, not causes. A cause is the version, the module, the resolution path, the config key. An unproven cause written as a fact is worse than an honest "cause not found": it gets recorded, it gets trusted, and the next run stops looking.
- **Never write a diagnosis into project memory, a report or an MR without the evidence that proves it.** A wrong diagnosis recorded as settled costs more than the red check it was meant to excuse.
- **A failure that comes from the harness itself is reported as a harness defect**, in the final report, so it can reach the improvement loop instead of being absorbed run after run.

What this rule does **not** do: it does not turn a pre-existing failure into something you must fix. A red check that predates the change, is named, and is reported, is out of scope and stays out of scope. Scope is unchanged; only the wording is constrained. What is forbidden is exactly one thing: calling it a success.

The same applies to a check that was not re-run. "Not re-run" is a third result alongside pass and fail, and it is written as such. Taking a check on another agent's word is not a result, and a report that presents it as one is wrong even when the underlying claim happens to be true.

---

## Reading a Figma design

**Default path: the Figma MCP tools directly.** In this order:

1. `get_metadata` on the file or frame URL, to locate the relevant nodes
2. `get_design_context` on each node, for structure, spacing, typography and layout
3. `get_design_context` on the **frame that contains** the node as well. The backdrop, scrim, overlay and page background belong to the frame, not to the component, and reading only the component silently drops them. This has already cost a missed defect
4. `get_screenshot` on each node, to keep a visual reference for the developer and the design review
5. `get_variable_defs` for the tokens actually used, so the code binds to design tokens instead of hardcoded values

When you write the specs into `ticket-context.md`, make it an **exhaustive list of named values**, not a prose summary: colours with their opacity, blurs, radii, borders, shadows, font families, sizes, weights, line heights, paddings, gaps, dimensions, plus every interactive state the design provides. Whatever you leave out will not be checked by anyone downstream: the design review reads your list, and a value absent from it comes back as "no spec given" instead of as a defect.

The `figma:figma-design-to-code` skill is a bonus, not a prerequisite: it comes from the Figma plugin, it is not reachable from every context, and the `designer-reviewer` agent has no `Skill` tool at all. Load it when you have it and it costs nothing, skip it otherwise. Its absence never blocks or delays the run.

Read the design tokens before writing any style, and prefer the repository's existing tokens and components over reproducing raw values from Figma.

Record whether the design was fully read. A partially read design lowers the confidence of the design review and must be said out loud, never smoothed over.

---

## Repository resolution

The issue URL gives the project path (`gitlab.com/<group>/<project>/-/issues/<iid>`, or `/-/work_items/<iid>` for the work item view of the same ticket). If the current directory already is the right repository, stay there. Otherwise, read `IMPL_REPOSITORIES` when present: it is a JSON object mapping GitLab project paths to local checkouts. If there is no matching entry, search the comma-separated `IMPL_SEARCH_ROOTS` directories for a checkout whose `origin` matches the project path. If no checkout is found, ask for the path as part of the step 2 question rather than guessing.

---

## Setting the ticket status

The status is **not a label**. It is the native work item status field, and it does not appear in
the REST issue API at all: `glab api projects/<id>/issues/<iid>` never returns it, and the
`.statut::*` scoped labels that exist on some projects are a separate, older thing. GraphQL is the
only way in.

Two moments, both mandatory:

- **step 3**, once the branch is created: `In progress`
- **step 8**, once the merge request is open and its description is set: `In progress - Merge request`

Read first, and skip the write when the ticket already carries the right status:

```bash
glab api graphql -f query='
query {
  project(fullPath: "<group>/<project>") {
    workItems(iid: "<iid>") {
      nodes {
        id
        widgets { ... on WorkItemWidgetStatus { status { name } } }
      }
    }
  }
}'
```

One query gives both things you need: the current status name, and the global work item id
(`gid://gitlab/WorkItem/<numeric id>`), which the mutation requires and which is **not** the iid.

Then write it by name:

```bash
glab api graphql -f query='
mutation {
  workItemUpdate(input: {
    id: "gid://gitlab/WorkItem/<numeric id>",
    statusWidget: { name: "In progress" }
  }) {
    errors
    workItem { widgets { ... on WorkItemWidgetStatus { status { name } } } }
  }
}'
```

What matters:

- The name resolves case insensitively, so the board's exact casing does not have to be guessed:
  `in progress - merge request` reaches `In progress - Merge request`.
- An unknown name writes nothing and returns an explicit error listing every valid status for that
  work item type. Read that list instead of guessing a second time.
- `errors: []` plus the new name echoed back is the only proof the write landed. GraphQL returns
  HTTP 200 with a populated `errors` array on failure, so a successful call proves nothing on its own.
- Statuses come from the group lifecycle, so another project may expose other names. Resolve by
  name, never hardcode a status id.
- **This never blocks the run.** If the status cannot be set, note it in the final report and carry
  on. A ticket left on the wrong status is a board annoyance; a halted implementation is a real cost.

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
- The MR always targets the branch chosen in step 1
- Developers run in parallel only on strictly disjoint file scopes, and sequentially the moment those scopes overlap. While a batch is in flight the branch is a moving target: a repository-wide gate measures that, not any one task, so nobody concludes from it until the batch is done
- Reviewers that drive Playwright run one at a time: a single browser is shared
- A change with no pixels is still measured in a running app when it changes what the app sends, stores or hides, an impossible verification is established from the repository's configuration and never assumed, and no file is edited while a measurement runs
- Only you touch git: branches, commits, push, MR
- The ticket status is moved twice, by you: `In progress` at step 3, `In progress - Merge request` at step 8
- A red check is never reported as a pass, whatever explains it: not a passing CI, not a pre-existing failure, not an environment. A prefix added to the documented command is itself a finding, a cause is named down to the mechanism or declared not found, and "not re-run" is written as "not re-run"
- The review is sized to the diff (step 7 tiers). Every diff gets reviewed; what changes with the tier is how wide the mandate is, never whether someone else looks at the code
- At tier 0 the review is correctness only, and returning nothing is the expected outcome, not a failed review
- The review never outlasts the implementation, and no single reviewer is waited on for more than about 15 minutes
- Never skip QA, never skip the design review when a design exists, **except at tier 0**, where the short correctness review plus the gates you run yourself stand in for them, and you say so in the MR comment
- The design review runs in both directions, and you hand it the diff's own style values before it starts. A value in the code with no Figma source is a finding, never a silent keep
- At most two rework rounds, so the run cannot spin forever
- Add a comment in code only for a non obvious "why", in English
- Every element an end to end test needs to reach carries a stable `data-testid`, named after its role, reusing the ids that already exist
- Every acceptance criterion has a stable id in `.claude/tasks/acceptance-criteria.json`, every piece of evidence cites it and follows the evidence contract, and nothing unverified is ever presented as validated
- Every architectural choice and every non obvious mechanism is documented in the repository's own documentation, in the same commit as the code, and the existing pages the change makes stale are updated. A doc that contradicts the code is worse than no doc
