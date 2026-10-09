# The engine layer

The factory drives a coding agent. This directory is the only part of the server that knows **which one**.

There is one implementation today, `claude-code`. The interface exists so that a second one means writing a file, without rewriting the server.

## Why

The factory is a daily work tool. If the AI provider changes, the tool has to keep working.

The server depended on Claude Code in only six places, all gathered here since. The main cost of a migration is in `commands/implement.md` and the six agents, written against the tool names and the subagent semantics of Claude Code. This layer handles the server and leaves those prompts as they are. See "What stays coupled" below.

The most specific mechanism of the factory, the blocking question, was proven portable before this layer was written. See the spike in `~/workspace/opencode-question-bridge`.

## The boundary

Above this line, the factory reasons in runs, phases, agents, documents and questions. Below it, an implementation knows an executable, an event vocabulary and a transcript format.

```text
index.ts, hooks.ts, artifacts.ts, transcript.ts, self-improvement.ts
        │
        │  engine.start() / engine.event() / engine.conversationLine() …
        ▼
engine/index.ts        picks the active engine
engine/types.ts        the contract
engine/claude-code.ts  the only implementation
```

Nothing above imports `node-pty`, reads `hook_event_name` or builds a `hookSpecificOutput`.

The boundary has known leaks, to count in when a second engine is written:

- the shape of a hook answer is typed outside the engine (`HookOutput` in `server/types.ts`);
- `domain.ts` tests the tool name `Bash` and spells the `.claude/worktrees` directory;
- the default of `IMPL_WORKTREE_COPY_FILES` in `config.ts` names `.claude/settings.local.json`;
- the evidence archive strips the `.claude/tasks/` prefix the prompts write (`evidence-archive.ts`);
- several messages of `run-health.ts` and `run-incidents.ts` write "Claude Code" where `engine.label` exists.

## The contract

`engine/types.ts`. Each member exists because it varies from one agent to another.

| Member | Role | What varies |
|---|---|---|
| `id`, `label` | identity of the engine | `label` appears in errors and in the activity log |
| `locate()` | the executable, or `null` | name of the binary |
| `command(issueUrl, instruction)` | entry point of the workflow | shape of the command, here a slash command |
| `start(options)` | starts the session, returns an `EngineSession`. `options.onEvent` receives what the agent says outside its hooks, read in the terminal. `options.environment` carries the variables the workflow reads (`IMPL_CODE_SNAPSHOT`, `IMPL_SNAPSHOT_LOG`, `IMPL_SNAPSHOT_EXCLUDE`), set as they are | arguments, environment variables, transport |
| `taskDirectory(cwd)` | where the workflow puts its documents | `.claude/tasks` for Claude Code |
| `transcriptPath(payload)` | the file the dialogue is read from | named by the agent in its own events |
| `conversationLine(line)` | one line of that file | JSONL format specific to the agent |
| `sessionUsage(source)` | the tokens used by the pilot and each subagent | `usage` field of the transcript, one file per subagent |
| `event(payload)` | translates a raw event into an `EngineEvent` | the whole hook vocabulary |
| `questionAnswer(input, answers)` | what the agent expects back from a question | `updatedInput` for Claude Code |
| `startSchedule(options)` | starts the headless session that compares the tickets of a batch, returns `{ finished, kill }`; `finished` carries `usage` (tokens per kind, models, turns, cost) read from the end report of `--output-format json`, absent when the session was killed | arguments, allowed tools, environment |
| `startImprovementJudge(options)` | starts the headless session that judges whether an improvement branch is merged without the user, on Opus, read-only but for its verdict file, returns `{ finished, kill }` | arguments, allowed tools, environment (`improvement-judge.ts`) |
| `startSelfImprovement(options)` | starts the detached self-improvement loop, on Opus | worktree, model and permission flags |
| `startConflictResolution(options)` | replays an improvement branch git alone could not rebase, on Sonnet | worktree, model and permission flags |

### EngineSession

What the factory does with a running session:

- `write(data)`: the raw keystrokes of the built-in terminal;
- `submit(text)`: an instruction typed in the interface, sent the way the agent expects it. Under Claude Code it is a paste between markers followed by a separate carriage return, because a carriage return **inside** the paste is read as content and the instruction is never submitted;
- `resize(cols, rows)`, `kill()`;
- `answerPrompt(decision)`: the answer (`accept` or `refuse`) to the prompt the session raised with `session.prompt`, typed the way the agent expects it. Returns `false`, without typing anything, when that prompt is no longer on screen.

### EngineEvent

One event, said in the words of the factory. The engine translates, `hooks.ts` applies.

| Event | Effect in the factory |
|---|---|
| `agent.start` / `agent.stop` | updates the list of agents, moves the phase forward |
| `agent.kill` | closes an agent stopped from outside (Claude Code emits no end for it) |
| `tool.start` | names the action in progress in the interface, detects the creation of a branch; carries the identifier of the call (`toolUseId`), the calling subagent (`agentId`, absent for the pilot), whether the call works in the background (`background`) and whether an end will be reported (`endReported`) |
| `tool.end` | looks in it for the address of the merge request, and closes the call with the same `toolUseId` |
| `question` | **blocks the agent** until the user answers |
| `attention` | the agent asks for control, with its cause: `permission`, `terminal_interaction` or `unknown` |
| `turn.end` | the **pilot** hands back, which does not mean the workflow is over (the end of a subagent is `agent.stop`) |
| `session.prompt` | the agent stops on a prompt of its own before the session starts (`folder_trust`: trust the folder): a decision waits for the user |
| `session.prompt.end` | that prompt has left the screen |

These fields are filled only when Claude Code provides them: `tool_use_id` and `agent_id` of the tool hooks, `notification_type` of the notifications. A missing field stays unknown, and run health (`server/run-health.ts`) copes with it. `END_REPORTED_TOOLS` has to stay equal to the `PostToolUse` matcher of `hooks/hooks.json`, which a test checks.

Two details that matter in the translation:

1. **The command goes through whole.** `tool.start` carries `command` untruncated, because `createsBranch` and `branchFromCommand` have to match on it. For display, it carries the name of the tool and a neutral `target`, since the input key that names it (`file_path`, `pattern`, `subagent_type`, `url`) varies from one tool to another. `actionLabel` in `domain.ts` turns it into the line "what Claude is doing right now". That label never enters the activity log, where two hundred tool calls would make the workflow's milestones unreadable.
2. **A question already answered is not asked again.** Claude Code replays the hook on the call the factory completed itself, and that second pass carries the answers. `claude-code.ts` recognises it and produces no event.

### The blocking question

It is the central mechanism, and the only one that needs cooperation from both sides.

```text
the agent calls its question tool
        │
        ▼
hooks/emit.mjs posts to /api/hooks, 1 h timeout
        │
        ▼
processHook → engine.event() → EngineEvent { kind: "question" }
        │
        ▼
waitForQuestionAnswer returns an UNRESOLVED Promise
        │                       and publishes the state (the panel shows)
        │
        ▼                       … the user answers in the interface
answerQuestion → engine.questionAnswer(input, answers)
        │
        ▼
the Promise resolves, the HTTP response goes out, the agent resumes
```

The block is that unresolved Promise. An engine that cannot wait on it cannot feed the decisions panel.

### The folder trust prompt

Claude Code draws it before any hook and any transcript: it can only be read in the terminal output. `trust-prompt.ts` holds everything known about it, and nothing else mentions it.

- **The text.** Observed on Claude Code 2.1.288, in a directory never opened: "Accessing workspace:", the path, "Quick safety check: Is this a project you created or one you trust? …", then two options, "No, exit" (under the cursor when it opens) and "Yes, I trust this folder", and "Enter to confirm · Esc to cancel". The raw output is kept in `tests/unit/fixtures/trust-dialog.json`, with the path replaced.
- **The detection.** The words are separated by cursor moves (`ESC[<column>G`), not by spaces, and the frame arrives cut anywhere. The text is therefore compared without escape sequences or blanks, over a sliding window. Three expressions have to be found in it, in order. The search stops after the first 16 kilobytes of output: the prompt is the first thing the session draws, and the same text shown later by a tool is not one.
- **The end.** An output of 400 visible characters with no expression of the prompt means the session moved on to its own screen. Above the engine, the first hook received and the exit of the process also close the prompt.
- **The answer.** Refusing sends Escape, which the prompt itself offers, then ends the session if it is still there two seconds later. Accepting sends Down Arrow then Enter, or Enter alone if the cursor was seen on "Yes". If the cursor is not where it was seen, an acceptance can at worst become a refusal.
- **What is not verified.** No answer was sent to the real Claude Code: accepting writes to the user's configuration. The keys are checked against `tests/fake-claude/claude`, which replays the captured frame.
- **A reworded text** matches nothing. The run then behaves as before: nothing in the conversation, the answer in the Terminal tab. Never a card that blocks a healthy run.
- A subdirectory of a directory already approved does not get the prompt (observed in `<repository>/.claude/worktrees/trust-probe`, same version).

## Adding an engine

1. Write `engine/<name>.ts` that satisfies `Engine`.
2. Pick it in `engine/index.ts`.
3. Provide the equivalent of the prompt corpus for that agent.

Step 3 takes the most work. The first two are mechanical.

## What stays coupled

This layer makes the server agnostic. The rest of the factory is still tied to Claude Code:

- **`commands/` and `agents/`**, about 600 lines plus six agents, written against the tool names of Claude Code. That is most of the migration cost. A possible route: one canonical source and a mapping table of tool names, generated at install time.
- **The interface labels** in `console/lib/notifications.ts` and `console/lib/run-state.ts`, which say "Claude" in hard-coded text. The client does not know the engine; `engine.label` would have to be passed down into `RunState`.
- **Demo mode** (`server/demo.ts`), which stages a Claude Code session.
- **Quality depending on the model.** An engine can answer without holding the workflow. Six agents and two review rounds need a strong model, and nothing here checks it. Checking it takes an eval.
