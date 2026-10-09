import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const emitter = path.resolve(process.cwd(), "..", "hooks", "emit.mjs");
let cwd: string;
let tasks: string;

/** The reason the hook refused the call with, or undefined when it let it through. */
function refusal(toolName: string, toolInput: object, env: Record<string, string> = { IMPL_RUN_ID: "run" }) {
  const { IMPL_RUN_ID: _run, IMPL_HARNESS_HOOK_URL: _url, ...inherited } = process.env;
  const payload = { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput, cwd };
  const { stdout } = spawnSync(process.execPath, [emitter], { input: JSON.stringify(payload), encoding: "utf8", env: { ...inherited, ...env } });
  if (!stdout) return undefined;
  const output = JSON.parse(stdout) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
  expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
  return output.hookSpecificOutput.permissionDecisionReason;
}

beforeEach(() => {
  cwd = mkdtempSync(path.join(os.tmpdir(), "hook-guard-"));
  tasks = path.join(cwd, ".claude", "tasks");
  mkdirSync(tasks, { recursive: true });
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

describe("the hook guard", () => {
  it("should refuse a workflow agent under its bare name and let the qualified one through", () => {
    expect(refusal("Agent", { subagent_type: "developer" })).toContain("implementation-harness:developer");
    expect(refusal("Agent", { subagent_type: "implementation-harness:developer" })).toBeUndefined();
    expect(refusal("Agent", { subagent_type: "Explore" })).toBeUndefined();
  });

  it("should refuse a developer on another model than Sonnet or Opus and let those two through", () => {
    expect(refusal("Agent", { subagent_type: "implementation-harness:developer", model: "haiku" })).toContain("without a model override");
    expect(refusal("Agent", { subagent_type: "implementation-harness:developer", model: "fable" })).toContain("Sonnet");
    expect(refusal("Agent", { subagent_type: "implementation-harness:developer", model: "sonnet" })).toBeUndefined();
    expect(refusal("Agent", { subagent_type: "implementation-harness:developer", model: "opus" })).toBeUndefined();
    expect(refusal("Agent", { subagent_type: "implementation-harness:developer" })).toBeUndefined();
    expect(refusal("Agent", { subagent_type: "implementation-harness:qa-reviewer", model: "sonnet" })).toBeUndefined();
    expect(refusal("Agent", { subagent_type: "implementation-harness:developer", model: "haiku" }, {})).toBeUndefined();
  });

  it("should refuse a reviewer while a planned task has no report, naming the task", () => {
    writeFileSync(path.join(tasks, "planner-output.json"), JSON.stringify({ tasks: [{ id: "T1" }, { id: "T2" }, { id: "T10" }] }));
    writeFileSync(path.join(tasks, "developer-report-T1.md"), "# Rapport");
    writeFileSync(path.join(tasks, "developer-report-T10.md"), "# Rapport");
    expect(refusal("Agent", { subagent_type: "implementation-harness:qa-reviewer" })).toMatch(/T2 of planner-output\.json has no/);
    expect(refusal("Agent", { subagent_type: "implementation-harness:developer" })).toBeUndefined();
  });

  it("should start the review once every task is reported or named in the merged report", () => {
    writeFileSync(path.join(tasks, "planner-output.json"), JSON.stringify({ tasks: [{ id: "T1" }, { id: "T2" }] }));
    writeFileSync(path.join(tasks, "developer-report-T1.md"), "# Rapport");
    writeFileSync(path.join(tasks, "developer-report.md"), "## T1\n\nFait.\n\n## T2\n\nNon lancée : couverte par T1.\n");
    expect(refusal("Agent", { subagent_type: "implementation-harness:review-orchestrator" })).toBeUndefined();
  });

  it("should not take T1 named in the merged report for T10", () => {
    writeFileSync(path.join(tasks, "planner-output.json"), JSON.stringify({ tasks: [{ id: "T1" }] }));
    writeFileSync(path.join(tasks, "developer-report.md"), "## T10\n");
    expect(refusal("Agent", { subagent_type: "implementation-harness:senior-reviewer" })).toContain("T1 ");
  });

  it("should start the review when the plan cannot be read", () => {
    writeFileSync(path.join(tasks, "planner-output.json"), "{ not json");
    expect(refusal("Agent", { subagent_type: "implementation-harness:senior-reviewer" })).toBeUndefined();
  });

  it("should refuse a commit or a publication that carries a trace of the session", () => {
    expect(refusal("Bash", { command: "git commit -m \"fix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\"" })).toContain("Co-Authored-By");
    expect(refusal("Bash", { command: "git -C /repo commit -m 'fix: x' -m 'Claude-Session: https://claude.ai/code/session_01'" })).toBeDefined();
    expect(refusal("Bash", { command: "glab mr create --description 'https://claude.ai/code/session_01'" })).toBeDefined();
    expect(refusal("Bash", { command: "gh pr create --title 'feat: x' --body 'https://claude.ai/code/session_01'" })).toBeDefined();
    expect(refusal("Bash", { command: "gh pr comment 12 --body 'Co-Authored-By: Claude <noreply@anthropic.com>'" })).toBeDefined();
    expect(refusal("Bash", { command: "gh pr create --title 'feat: x' --body-file .claude/tasks/mr-description.md" })).toBeUndefined();
    expect(refusal("Bash", { command: "git commit -m 'fix(cart): keep the total when a line is removed'" })).toBeUndefined();
    expect(refusal("Bash", { command: "git log --grep 'Co-Authored-By:'" })).toBeUndefined();
  });

  it("should refuse a publication whose text or file shows a credential, and name it without quoting it", () => {
    const token = `ghp_${"a1B2".repeat(9)}`;
    const typed = refusal("Bash", { command: `gh pr comment 12 --body 'curl -H "Authorization: token ${token}"'` });
    expect(typed).toContain("a GitHub token");
    expect(typed).not.toContain(token);

    const jwt = `eyJ${"hbGciOiJIUzI1NiJ9"}.eyJ${"zdWIiOiIxMjM0NTY3ODkwIn0"}.${"SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV"}`;
    writeFileSync(path.join(tasks, "mr-description.md"), `# Fix\n\nSee ![capture](https://private-user-images.githubusercontent.com/1/2.png?jwt=${jwt})\n`);
    for (const command of [
      "gh pr create --base main --head feat-1 --title 'feat: x' --body-file .claude/tasks/mr-description.md",
      "glab api --method POST \"projects/:fullpath/merge_requests\" --field \"description=@.claude/tasks/mr-description.md\"",
      "glab mr note 12 --message \"$(cat .claude/tasks/mr-description.md)\"",
    ]) expect(refusal("Bash", { command })).toMatch(/a signed token \(JWT\), in mr-description\.md line 3/);

    writeFileSync(path.join(tasks, "mr-review-comment.md"), "## Revue\n\n-----BEGIN RSA PRIVATE KEY-----\n");
    expect(refusal("Bash", { command: "glab api --method POST projects/1/merge_requests/2/notes --field \"body=@.claude/tasks/mr-review-comment.md\"" })).toContain("a private key");
  });

  it("should let through a publication that only talks about credentials, and a read of a file that holds one", () => {
    writeFileSync(path.join(tasks, "mr-description.md"), "# Fix\n\nThe client now sends `Authorization: Bearer <token>` and reads `GITHUB_TOKEN` (ghp_...) from the environment. The password field is masked.\n");
    expect(refusal("Bash", { command: "gh pr create --title 'feat: x' --body-file .claude/tasks/mr-description.md" })).toBeUndefined();
    writeFileSync(path.join(tasks, "notes.md"), `token: glpat-${"x".repeat(24)}\n`);
    expect(refusal("Bash", { command: "cat .claude/tasks/notes.md" })).toBeUndefined();
    // Named in a title, the file is not what the command sends.
    expect(refusal("Bash", { command: "gh pr create --title 'docs: update .claude/tasks/notes.md' --body-file .claude/tasks/mr-description.md" })).toBeUndefined();
    expect(refusal("Bash", { command: "git commit -m 'docs: update .claude/tasks/notes.md'" })).toBeUndefined();
    expect(refusal("Bash", { command: "gh pr comment 12 -F .claude/tasks/notes.md" })).toContain("a GitLab token");
    expect(refusal("Bash", { command: "glab api projects/1/merge_requests/2 # .claude/tasks/notes.md" })).toBeUndefined();
    expect(refusal("Bash", { command: "glab api --method POST projects/1/merge_requests/2/notes --field \"body=@.claude/tasks/notes.md\"" })).toContain("a GitLab token");
  });

  it("should refuse the git commands that destroy work, wherever they sit on the line", () => {
    for (const command of [
      "git reset --hard",
      "cd /repo && rtk git -C /repo reset --hard origin/main",
      "(git clean -fd)",
      "git checkout .",
      "git checkout -- .",
      "git restore .",
      "git switch --discard-changes main",
      "git push --force origin feat-1-x",
      "git push origin +feat-1-x",
      "git worktree prune",
      "git worktree remove /repo/.claude/worktrees/run-1",
    ]) expect(`${command} => ${refusal("Bash", { command }) ? "refused" : "let through"}`).toBe(`${command} => refused`);
  });

  it("should refuse them behind a keyword, a wrapper, a path or a redirection, each by its own rule", () => {
    const reset = "`git reset --hard` destroys uncommitted work";
    const clean = "`git clean -f` deletes untracked files";
    const checkout = "This checkout discards every uncommitted change of the tree";
    const restore = "This restore discards every uncommitted change of the tree";
    for (const [command, rule] of [
      ["if ! git diff --quiet; then git reset --hard; fi", reset],
      ["for d in a b; do git -C $d clean -fd; done", clean],
      ["! git reset --hard", reset],
      ["sudo git reset --hard", reset],
      ["nohup git clean -fd", clean],
      ["timeout 5 git reset --hard", reset],
      ["ls | xargs git clean -f", clean],
      ["/usr/bin/git reset --hard", reset],
      ["git reset --hard>/dev/null", reset],
      ["git reset --hard 2>/dev/null", reset],
      ["git clean -fd>log", clean],
      ["echo `git reset --hard`", reset],
      ["echo $(git reset --hard)", reset],
      ["git --config-env core.editor=EDITOR reset --hard", reset],
      ["git checkout -- ./", checkout],
      ["git checkout -- ..", checkout],
      ["git restore ./", restore],
      ["git restore '*'", restore],
      ["git restore :/", restore],
      ["git restore ':(top)'", restore],
      ["GIT_EXEC_PATH=/usr/lib/git git reset --hard", reset],
      ["GIT_DIR=/repo/.git /usr/bin/git reset --hard", reset],
    ]) expect(`${command} => ${refusal("Bash", { command }) ?? "let through"}`).toContain(`${command} => ${rule}`);
  });

  describe("in the headless scheduling session", () => {
    const output = "/data/schedule/call-1/output.json";
    const session = { IMPL_SCHEDULE_OUTPUT: output };
    const reads = "The scheduling session only reads tickets";

    it("should refuse a forge call that writes, whatever way the method or the field is spelled", () => {
      for (const command of [
        "gh api -X DELETE repos/acme/shop/issues/7",
        "gh api repos/acme/shop/issues/7/comments -f body=hello",
        "gh api --method POST repos/acme/shop/issues/7/comments --raw-field body=hello",
        "gh api repos/acme/shop/issues/7 --input payload.json",
        "glab api --method PUT projects/:fullpath/issues/7 --field description=x",
        "glab api -XPOST projects/:fullpath/issues/7/notes",
        "glab api projects/:fullpath/merge_requests",
        "gh api repos/acme/shop",
        "gh issue comment 7 --body hello",
        "glab issue update 7 --description x",
        "gh pr create --title x",
        "/opt/homebrew/bin/gh api -X DELETE repos/acme/shop/issues/7",
        "GH_HOST=github.example.com gh api -X DELETE repos/acme/shop/issues/7",
        "git log --oneline; gh api -X DELETE repos/acme/shop/issues/7",
      ]) expect(`${command} => ${refusal("Bash", { command }, session) ?? "let through"}`).toContain(`${command} => ${reads}`);
    });

    it("should let it read an issue and its links", () => {
      for (const command of [
        "glab issue view 7",
        "glab issue view 7 --repo https://gitlab.com/acme/shop",
        "glab api \"projects/:fullpath/issues/7/links\"",
        "glab api --hostname gitlab.example.com projects/acme%2Fshop/issues/7/links",
        "gh issue view 7 --repo acme/shop",
        "gh api \"repos/{owner}/{repo}/issues/7/dependencies/blocked_by\" --jq '.[] | {number, title, state}'",
        "gh api repos/acme/shop/issues/7/dependencies/blocking --hostname github.example.com --paginate",
        "git log --oneline -20",
        "git grep -n checkout",
        "git grep -n gh src",
        "git log --grep glab",
        "git show HEAD:bin/gh",
        "git grep -n rm src",
        "ls tests/fake-claude/gh",
        "ls src",
      ]) expect(`${command} => ${refusal("Bash", { command }, session) ?? "let through"}`).toBe(`${command} => let through`);
    });

    it("should let it write and remove its output file, and no other", () => {
      expect(refusal("Write", { file_path: output, content: "{}" }, session)).toBeUndefined();
      expect(refusal("Write", { file_path: "src/a.ts", content: "x" }, session)).toBe(`The scheduling session writes its output file and nothing else: ${output}.`);
      expect(refusal("Write", { file_path: "/data/schedule/call-1/../../queue.json", content: "[]" }, session)).toContain("writes its output file and nothing else");
      expect(refusal("Edit", { file_path: output, old_string: "a", new_string: "b" }, session)).toContain("writes its output file and nothing else");
      expect(refusal("Bash", { command: `rm ${output}` }, session)).toBeUndefined();
      expect(refusal("Bash", { command: "rm /data/schedule/call-1/../../queue.json" }, session)).toBe(`The scheduling session removes its own output file and nothing else: ${output}.`);
      expect(refusal("Bash", { command: `rm -rf ${output}` }, session)).toContain("removes its own output file and nothing else");
    });

    it("should let it start its agent and no other", () => {
      expect(refusal("Agent", { subagent_type: "implementation-harness:ticket-scheduler", prompt: "p" }, session)).toBeUndefined();
      expect(refusal("Agent", { subagent_type: "general-purpose", prompt: "p" }, session)).toBe("The scheduling session starts `implementation-harness:ticket-scheduler` and no other agent.");
      expect(refusal("Agent", { prompt: "p" }, session)).toContain("and no other agent");
    });
  });

  describe("in the headless improvement judge session", () => {
    const output = "/tmp/improvement-judge/call-1/verdict.json";
    const session = { IMPL_JUDGE_OUTPUT: output };
    const writes = `The improvement judge writes its verdict file and nothing else: ${output}.`;

    it("should let it write its verdict file and nothing else", () => {
      expect(refusal("Write", { file_path: output, content: "{}" }, session)).toBeUndefined();
      expect(refusal("Write", { file_path: "hooks/guard.mjs", content: "x" }, session)).toBe(writes);
      expect(refusal("Write", { file_path: "/tmp/improvement-judge/call-1/../../queue.json", content: "[]" }, session)).toBe(writes);
      expect(refusal("Edit", { file_path: output, old_string: "a", new_string: "b" }, session)).toBe(writes);
      expect(refusal("NotebookEdit", { notebook_path: "a.ipynb" }, session)).toBe(writes);
    });

    it("should refuse every command, read-only ones included", () => {
      for (const command of ["git log --oneline", "ls", `rm ${output}`, "/usr/bin/git merge main"])
        expect(refusal("Bash", { command }, session)).toBe("The improvement judge runs no command: the console gave it the diff and the checks in its input file.");
    });

    it("should refuse every agent", () => {
      expect(refusal("Agent", { subagent_type: "implementation-harness:senior-reviewer", prompt: "p" }, session)).toBe("The improvement judge starts no agent: it decides alone.");
    });

    it("should let it read", () => {
      expect(refusal("Read", { file_path: "/data/runs/run-1/run.json" }, session)).toBeUndefined();
      expect(refusal("Grep", { pattern: "x" }, session)).toBeUndefined();
    });
  });

  it("should let through the git commands the workflow needs", () => {
    for (const command of [
      "git reset --soft HEAD~1",
      "git clean -nfd",
      "git checkout -- src/a.ts",
      "git restore --staged .",
      "git switch -c feat-1-x --no-track origin/main",
      "git push -u origin feat-1-x",
      "git push --force-with-lease origin feat-1-x",
      "git worktree add --detach /tmp/qa-1 HEAD",
      "git worktree remove --force /tmp/qa-1",
      "git stash push -u -m implementation-harness-1",
      "git commit -m 'docs: never run git reset --hard'",
      "git log --grep 'clean -fd'",
      "git commit -F - <<EOF\nfix: x\n\ngit reset --hard was the cause\nEOF",
      "git restore src/a.ts",
      "git checkout -- ./src",
      "git restore --staged ./",
      "git diff --stat > /tmp/diff.txt",
      "if git diff --quiet; then git status --short; fi",
      "sudo git status",
      "cd git && ls",
      "git restore :/console/server/domain.ts",
      "git restore ':(top)console/server/domain.ts'",
      "git checkout ':/fix typo' -- src/a.ts",
      "GIT_EXEC_PATH=/usr/lib/git git status",
    ]) expect(`${command} => ${refusal("Bash", { command }) ? "refused" : "let through"}`).toBe(`${command} => let through`);
  });

  it("should refuse a stash and a deleted or overwritten branch in the worktree of a run", () => {
    const worktree = { IMPL_RUN_ID: "run", IMPL_RUN_WORKTREE: "/repo/.claude/worktrees/run-1" };
    expect(refusal("Bash", { command: "git stash" }, worktree)).toContain("worktree mode");
    expect(refusal("Bash", { command: "git stash list" }, worktree)).toBeUndefined();
    expect(refusal("Bash", { command: "git branch -D feat-1-x" }, worktree)).toBeDefined();
    expect(refusal("Bash", { command: "git switch -C feat-1-x origin/main" }, worktree)).toBeDefined();
    expect(refusal("Bash", { command: "git checkout -B feat-1-x" }, worktree)).toBeDefined();
    expect(refusal("Bash", { command: "git worktree remove ." }, { ...worktree, IMPL_RUN_WORKTREE: cwd })).toBeDefined();
    // A checkout whose `.git` is a file is a linked worktree, with or without the console.
    writeFileSync(path.join(cwd, ".git"), "gitdir: /repo/.git/worktrees/x\n");
    expect(refusal("Bash", { command: "git stash" })).toContain("worktree mode");
  });

  it("should say nothing outside a run of the workflow", () => {
    expect(refusal("Bash", { command: "git reset --hard" }, {})).toBeUndefined();
    expect(refusal("Agent", { subagent_type: "developer" }, {})).toBeUndefined();
    expect(refusal("Bash", { command: "git commit -m 'x\n\nCo-Authored-By: someone'" }, {})).toBeUndefined();
    writeFileSync(path.join(tasks, "workflow-state.json"), "{}");
    expect(refusal("Agent", { subagent_type: "developer" }, {})).toContain("implementation-harness:developer");
  });
});
