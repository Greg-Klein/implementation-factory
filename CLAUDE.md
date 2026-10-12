# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. The shared guidance (what the repo is, commands, architecture, conventions, code habits) lives in `AGENTS.md`, imported here:

@AGENTS.md

## Claude Code specifics

- `AGENTS.md` is the file to edit. What any coding agent needs goes there; this file only holds what applies to Claude Code alone, and never restates a rule `AGENTS.md` owns.
- Claude Code loads this file, and `AGENTS.md` through the import above, in a session opened in this checkout or in a worktree of it. A `self-improvement-*` worktree therefore reads its branch's own copy of both, which is why the judge of an improvement branch runs from its input directory and not from the worktree (`JudgeOptions` in `console/server/engine/types.ts`).
- Neither file is runtime context for the projects the plugin drives: the workflow prompts read `principles/` and `contracts/` through `${CLAUDE_PLUGIN_ROOT}` paths.
- To try a change to the plugin (`commands/`, `agents/`, `hooks/`, `skills/`) in a session, load this checkout with `claude --plugin-dir <this repo>`, which is what the console does for a run.
