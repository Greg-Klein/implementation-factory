# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Two things in one repo:

1. **A Claude Code plugin** (`.claude-plugin/`, `commands/`, `agents/`, `hooks/`, `skills/`). `/implementation-harness:implement` drives a GitLab ticket end to end (clarify, plan, implement, test, specialized reviews, MR). `improve` and `rebase` run the self-improvement loop on this repo itself; `review` is the review step.
2. **A local console** (`console/`): a Next.js UI plus a Node server that spawns the real `claude` binary in a PTY (`claude --plugin-dir <this repo> "/implementation-harness:implement <ticket>"`), and makes its progress, agents, questions and documents visible. No direct Anthropic API calls, no API key.

There is no desktop app. The console only runs from the checkout through `impl`, so a merged self-improvement lands in the code that serves it (plugin files on the next run, `console/` and `bin/` after `impl restart`, which the merge notice asks for).

`bin/implementation-harness` is the `impl` launcher (start/demo/restart/stop/status/config/improve). `bin/config.mjs` + `env-schema.mjs` + `env-file.mjs` implement `impl config` over a local `.env` (the shell environment wins over `.env`, which wins over the defaults, see `.env.example`).

## Commands

All from `console/` (Node >= 22):

```bash
npm install                  # node-pty is native, needs build tools
npm run dev                  # tsx server/index.ts, http://127.0.0.1:3210
npm run typecheck            # tsc --noEmit
npm run test:unit            # Jest (swc), tests/unit/*.test.ts
npx jest tests/unit/hooks.test.ts -t "should ..."   # single unit test
npm run test:integration     # Playwright, starts an isolated dev server on :3211 (500ms demo steps, no local .env, temp data dir, tests/fake-claude on PATH)
npx playwright test tests/integration/questions.spec.ts   # single spec
npm run build                # next build --webpack
```

CI (`.github/workflows/ci.yml`) runs typecheck, unit, build, integration. Run the same before calling work done.

`impl demo` (or the demo mode in the UI) replays a simulated run from `server/demo.ts` / `demo-data.ts` without touching any repo or GitLab. Integration tests lean on it.

## Architecture

Flow: a hook fires in the Claude Code session (PTY). `hooks/hooks.json` runs `hooks/emit.mjs`, which POSTs the event to the local server with `IMPL_RUN_ID`. `server/engine` translates the raw hook payload into `EngineEvent`s, `server/hooks.ts` applies them to the `RunSession` the hook names, and the WebSocket sends the new state to the React UI (`components/harness.tsx` shell, `run-rail.tsx` sidebar, `run-view.tsx` and panels).

Several runs go at once. Nothing run-specific is module state any more. Everything a run owns lives on its `RunSession`, and every client message and HTTP route that acts on a run names it by `runId`.

- `server/engine/` is **the only code that knows the driven agent is Claude Code**: binary, hook vocabulary, transcript JSONL format, how to submit input, `.claude/tasks` path, `hookSpecificOutput`. Nothing above it may import `node-pty` or read `hook_event_name`. Contract in `engine/types.ts`, rationale in `engine/README.md`. Keep new agent-specific logic there.
- Blocking questions: the `PreToolUse` hook on `AskUserQuestion` (timeout 3600s) waits for the UI answer, which returns as `updatedInput`. Claude Code replays the hook with answers; the engine ignores that second pass.
- `server/access.ts` + `server/hook-bridge.ts`: every HTTP request needs a `Host` naming the console, the WebSocket an `Origin` it served, `/api/hooks` the per-boot secret carried in `IMPL_HARNESS_HOOK_URL`. `emit.mjs` retries once, then spools the event to `data/runs/<id>/hooks-spool.jsonl` (`IMPL_HOOK_SPOOL`), replayed before the next hook and on every monitor tick; `hookId` dedupes. Questions are never retried nor spooled.
- Run health: `server/run-health.ts` (pure `evaluateRunHealth`, injected clock and policy) reads `RunSession.signals` (pilot turn end, tool calls paired by `toolUseId`, subagent vs pilot, background calls, notification causes) and `workflow-state.json` (`server/workflow-state.ts`), `server/run-incidents.ts` keeps incidents (fingerprint dedupe, resolution on the lifting event, action checks, archive normalisation), `server/run-monitor.ts` is the single scheduler the registry owns (tick + `session.signal()`, serialised per run with incident actions). Silence alone is only `suspected_stall`; a mid-workflow `turn.end` no longer sets `attention` by itself, and an exit before a result is `failed` with a `lost_session` incident. An agent that ends without a file its contract requires, with nobody taking over, raises an incident: `planner-output.json` for `ticket-planner`, `qa-report.md`, `qa-evidence.json` and `qa-plan.md` for `qa-reviewer`, `designer-review.md`, `design-evidence.json` and `design-inventory.md` for `designer-reviewer`, `review-summary.md` for `review-orchestrator` (`PRODUCER_CONTRACTS`). Actions go through `incident.action` (revision + requestId, decision persisted before the effect). Runs left with an open incident are read back by `server/run-archive.ts` and served on `/api/archive/*`, never registered.
- `server/domain.ts`: pure logic, no FS/agent. Prefer putting logic here or in `engine/` so it is unit-testable.
- Review order: `RunSession.artifactArrived` records the first time each document is seen in `RunState.artifactArrivals` (called from `server/artifacts.ts`). `reviewPlanNotes` in `domain.ts` turns these times into `RunState.reviewNotes`, one note when `qa-plan.md` did not arrive before `qa-report.md`, or `design-inventory.md` before `designer-review.md`. A note is a remark shown in the evidence tab and changes no verdict. `phaseForArtifact` ignores both plan files, so they never open the next step.
- `server/run-session.ts`: one run and everything it owns (state, archive, engine session, terminal buffer, artifact and transcript watchers, pending-question bridge, demo timers), with `activity()`/`publish()`.
- `server/registry.ts`: every run the console holds plus the launch queue (`data/queue.json`, restored on boot). Enforces one run per checkout (`runHoldsRepository`: in progress or session still open) and `IMPL_MAX_CONCURRENT_RUNS`, and drains the queue whenever a run lets go.
- `server/context.ts`: the open sockets with the run each one is subscribed to, `broadcast()` (list of runs, notices) vs `broadcastToViewers()` (one run's state and terminal). On boot, non-terminal archived runs are reclassified `failed`.
- WebSocket protocol: `harness` (summaries + queue + archived runs, to every page), `run` and `terminal.output` (to the pages that opened that run via `run.subscribe`), `notice` (harness-level events), `error` and `incident.result` (answered to the page that asked). HTTP: `/api/runs`, `/api/runs/<id>`, `/api/artifacts?runId=&path=`, and read-only `/api/archive/runs/<id>`, `/api/archive/runs/<id>/acceptance`, `/api/archive/artifacts`.
- "Suivi" board: `planner-output.json` is parsed when archived (`plannedTasks`), the engine reads the plan task id out of a developer delegation (the `developer-report-<id>.md` suffix in the `Agent` prompt), `pairDelegation` binds it FIFO to the next `SubagentStart` of that type, and `planTaskBoard` derives each card's column and assignee (report present = done). Agents get a first name and photo in start order (`agentIdentity`, pictures in `public/avatars/`) and a French role (`agentRole`).
- Acceptance evidence: the pilot writes `acceptance-criteria.json` (stable `AC<n>` ids), tasks carry `criterion_ids`, evidence files follow `contracts/evidence.md`. `server/acceptance.ts` (pure) derives each criterion's status (failed wins over blocked, then unverified, then verified, and stale, unversioned or unreplaced evidence never counts as verified) and renders the MR summary. A QA item with `kind: "attempt"` is a break attempt: a failing one counts against the criterion it cites, any other is listed under it (`AcceptanceCriterionView.attempts`) and verifies nothing. `qaVerdictConsistency` compares the `status` of the latest QA report with QA's own executed observations on the current code and returns `AcceptanceView.qa`, with a warning when `PASS` or `PASS_WITH_WARNINGS` is declared over a criterion QA did not observe; a focused pass answers only for the criteria in its root `mandate`. The warning also goes into the MR summary (`qaWarning`); `server/evidence-archive.ts` keeps every version and its captures under `data/runs/<id>/evidence/`; `server/acceptance-runtime.ts` ingests, identifies the code with `hooks/code-snapshot.mjs` (the same utility the workflow runs), writes `acceptance-summary.md` back to the task directory and answers the pre-cleanup `archive-sync-request.json`. The full view is `/api/runs/<id>/acceptance`; `RunState.acceptance` and `RunSummary.acceptance` carry figures only, including the QA verdict digest (`acceptance.qa`: status, `consistent`, number of unobserved criteria).
- `server/artifacts.ts`: watches the target repo's `.claude/` (restricted to `tasks/`, because the workflow deletes and recreates `tasks/`) and copies documents into the run archive. Only files written since run start count.
- `server/transcript.ts`: tails the session transcript for the conversation panel (lags behind the terminal by design).
- `server/self-improvement.ts` + `worktree.ts`: feedback/self-audit storage, `self-improvement-*` worktrees, auto-rebase on HEAD moves, merge simulation via `git merge-tree --write-tree`, `mergeNeedsRestart` flags a merge that touched `console/` or `bin/`, one improvement in flight at a time (autonomous audits are queued and launched one after another, so runs finishing together cannot each open a branch). Nothing is ever pushed or auto-merged; the UI merge button is the only promotion path.
- `server/repository.ts`: finds the GitLab checkout for a ticket by scanning `IMPL_SEARCH_ROOTS` two levels deep and reading `.git/config`.
- `lib/`: client-side helpers (run-state derivation, conversation, notifications, sound).

Runtime data lives in `console/data/runs/<run-id>/` (`run.json`, `terminal.log`, `artifacts/`). Gitignored and confidential (ticket content): never copy it into tracked files, commits or docs.

## Conventions

- Code, identifiers, comments and commit messages in English. User-facing UI text and READMEs in French.
- UI styling and wording follow `brand/README.md` (tokens, type scale, components, tone). A screen that departs from it is fixed, or the brand book is updated in the same commit.
- Commits: conventional prefixes (`fix:`, `feat:`, `chore:`), subject describes the behavior change in plain words. `self-improvement: apply improvements from self-improvement-<id>` is reserved for the improvement loop.
- Server modules are ESM and import siblings with the `.js` suffix (Jest maps it back).
- Unit tests: `describe(...)` + `it("should ...")`, one file per responsibility.
- Every `agents/*.md`, `commands/*.md` and `skills/*/SKILL.md` needs YAML frontmatter with `name` and `description`, and a skill's `name` is its directory (enforced by `tests/unit/plugin-metadata.test.ts`).
- `principles/engineering.md` holds the short common decision rules; `contracts/` holds schemas and policies. Agents explicitly read them through `${CLAUDE_PLUGIN_ROOT}` paths; this root CLAUDE.md is not runtime context for plugin users. Methods live in `skills/`, loaded conditionally. See `docs/engineering-workflow.md` for routing, independent review and artifact ownership.
- Developer `self-check` and independent `review-change` must remain separate. `collect-evidence` supplies execution mechanics, never the reviewer's scenario selection or verdict. Reviewer expectations are established before reading author conclusions: QA writes them to `qa-plan.md`, the design reviewer to `design-inventory.md`, and briefs pass author evidence by path only.
- The design review (`designer-reviewer`, file `agents/designer-reviewer-figma.md`, skill `figma-review`) runs on any change visible in the UI, with or without Figma. A QA verdict `INCONCLUSIVE` never exits as ready. A design verdict `INCONCLUSIVE` is reported as "design non vérifié" and does not block.
- Editing `commands/` or `agents/` changes the workflow prompts run against real tickets; `implement.md` and agents are tightly coupled to Claude Code tool names.
- After changing server code, a running `impl` must be restarted (`impl restart`), otherwise it serves a stale Next manifest (unstyled page).
