---
name: schedule
description: "Predict what each GitLab or GitHub ticket of a batch would touch in the current repository and which tickets overlap or depend on each other, then write the result as JSON. Run headless by the console, one session per repository."
disable-model-invocation: true
argument-hint: <input-path> <output-path>
model: sonnet
---

Schedule the tickets described by: $ARGUMENTS

**Parse the arguments first.** Two whitespace-separated tokens, both absolute paths: the input file the console wrote, then the output file to write. The current directory is the main checkout of the repository the tickets belong to.

This session is headless: nobody reads a question and nobody answers a permission prompt. Never use `AskUserQuestion`. Decide, write the output file or fail, and end.

Read [schedule input and output](${CLAUDE_PLUGIN_ROOT}/contracts/schedule.md). It defines both files and the rules the console validates the output against.

## 1. Read the input

Read the input file. Stop with the failure line of step 4, and write nothing, when:

- an argument is missing, or the input file is missing or is not valid JSON;
- `tickets` is not an array;
- the current directory is not a git repository.

**When `tickets` is empty, write `{ "tickets": [], "edges": [] }` to the output path yourself and go to step 4.** No agent, no forge call, no search.

## 2. Predict

Invoke the `implementation-harness:ticket-scheduler` agent, under that qualified name, once for the whole batch: the edges come from comparing the tickets with each other, so splitting the batch loses them. Pass it the two paths and nothing copied from the input. It reads the tickets, searches the repository and writes the output file.

It is read-only, and so are you: no edit in the repository, no branch switch, no stash, no fetch, no install, no build. The output file is the only thing this session writes, and ticket content goes nowhere else.

## 3. Check the output

Read the output file back and apply the contract's validation list against the input. When a rule fails, send the agent the failing rule and the entry concerned, once, and check again. A file that still fails is deleted (`rm <output-path>`, the absolute path spelled out): the console reads a missing file as a failed schedule, which is safer than a wrong one.

Do not correct a prediction yourself and do not lower a `confidence` to make the file pass.

## 4. End

Your last message is one line and nothing else, no explanation after it:

- `schedule: <n> tickets, <m> edges`
- or `schedule failed: <reason in a few words>`

No ticket title, no ticket text and no file list in that line. A denied tool call is a failure to report in that line, never something to work around with another tool.
