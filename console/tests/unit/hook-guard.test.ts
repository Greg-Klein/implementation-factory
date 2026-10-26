import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tierScript = path.resolve(process.cwd(), "..", "hooks", "review-tier.mjs");

const emitter = path.resolve(process.cwd(), "..", "hooks", "emit.mjs");
let cwd: string;
let tasks: string;

/** The reason the hook refused the call with, or undefined when it let it through. */
function refusal(toolName: string, toolInput: object, env: Record<string, string> = { IMPL_RUN_ID: "run" }) {
  const { IMPL_RUN_ID: _run, IMPL_HOOK_URL: _url, ...inherited } = process.env;
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
    expect(refusal("Agent", { subagent_type: "developer" })).toContain("implementation-factory:developer");
    expect(refusal("Agent", { subagent_type: "implementation-factory:developer" })).toBeUndefined();
    expect(refusal("Agent", { subagent_type: "Explore" })).toBeUndefined();
  });

  it("should refuse a developer on another model than Sonnet or Opus and let those two through", () => {
    expect(refusal("Agent", { subagent_type: "implementation-factory:developer", model: "haiku" })).toContain("without a model override");
    expect(refusal("Agent", { subagent_type: "implementation-factory:developer", model: "fable" })).toContain("Sonnet");
    expect(refusal("Agent", { subagent_type: "implementation-factory:developer", model: "sonnet" })).toBeUndefined();
    expect(refusal("Agent", { subagent_type: "implementation-factory:developer", model: "opus" })).toBeUndefined();
    expect(refusal("Agent", { subagent_type: "implementation-factory:developer" })).toBeUndefined();
    expect(refusal("Agent", { subagent_type: "implementation-factory:qa-reviewer", model: "sonnet" })).toBeUndefined();
    expect(refusal("Agent", { subagent_type: "implementation-factory:developer", model: "haiku" }, {})).toBeUndefined();
  });

  describe("on the end-to-end decision of the plan", () => {
    const DEVELOPER = { subagent_type: "implementation-factory:developer" };
    const plan = (policy: unknown, steps: string[] = []) => writeFileSync(path.join(tasks, "planner-output.json"), JSON.stringify({
      tasks: [{ id: "T1", verification_steps: steps }],
      test_strategy: policy === undefined ? {} : { e2e_policy: policy },
    }));
    const expected = { expected: true, sources: ["CONTRIBUTING.md#Tests"], command: "npx playwright test", reason: "Every page has a spec." };

    it("should refuse a developer while the plan has no decision, or a malformed one", () => {
      plan(undefined);
      expect(refusal("Agent", DEVELOPER)).toMatch(/has no test_strategy\.e2e_policy/);
      plan({ ...expected, expected: "yes" });
      expect(refusal("Agent", DEVELOPER)).toMatch(/neither true nor false/);
      plan({ ...expected, sources: "README.md" });
      expect(refusal("Agent", DEVELOPER)).toMatch(/e2e_policy\.sources/);
      plan({ ...expected, command: null });
      expect(refusal("Agent", DEVELOPER)).toMatch(/string in e2e_policy\.command/);
      plan({ expected: false, sources: [], command: "", reason: " " });
      expect(refusal("Agent", DEVELOPER)).toMatch(/no e2e_policy\.reason/);
    });

    it("should refuse a developer when the plan expects specs it gives no source, command or task for", () => {
      plan({ ...expected, sources: [] }, ["npx playwright test e2e/cart.spec.ts"]);
      expect(refusal("Agent", DEVELOPER)).toMatch(/cites no source/);
      plan({ ...expected, command: " " }, ["npx playwright test e2e/cart.spec.ts"]);
      expect(refusal("Agent", DEVELOPER)).toMatch(/gives no e2e_policy\.command/);
      plan(expected, ["npm test"]);
      expect(refusal("Agent", DEVELOPER)).toMatch(/no task's verification_steps run/);
    });

    it("should let a developer start on a complete decision, a plan that cannot be read, or no plan", () => {
      plan(expected, ["npx playwright test e2e/cart.spec.ts"]);
      expect(refusal("Agent", DEVELOPER)).toBeUndefined();
      plan({ expected: false, sources: [], command: "", reason: "No e2e tooling in the repository." });
      expect(refusal("Agent", DEVELOPER)).toBeUndefined();
      writeFileSync(path.join(tasks, "planner-output.json"), "{ not json");
      expect(refusal("Agent", DEVELOPER)).toBeUndefined();
      rmSync(path.join(tasks, "planner-output.json"));
      expect(refusal("Agent", DEVELOPER)).toBeUndefined();
    });

    it("should leave a reviewer and a session outside a run alone", () => {
      plan(undefined);
      expect(refusal("Agent", { subagent_type: "implementation-factory:qa-reviewer" })).toMatch(/T1 of planner-output\.json has no/);
      expect(refusal("Agent", DEVELOPER, {})).toBeUndefined();
    });

    it("should check the fields the planner contract writes", () => {
      const contract = readFileSync(path.resolve(process.cwd(), "..", "contracts", "planner.md"), "utf8");
      const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(contract)?.[1] ?? "null") as { test_strategy: { e2e_policy: object } };
      const guard = path.resolve(process.cwd(), "..", "hooks", "guard.mjs");
      const { stdout } = spawnSync(process.execPath, ["--input-type=module", "-e", `const { E2E_POLICY_FIELDS } = await import(${JSON.stringify(guard)}); console.log(JSON.stringify(E2E_POLICY_FIELDS));`], { encoding: "utf8" });
      expect(Object.keys(example.test_strategy.e2e_policy)).toEqual(JSON.parse(stdout));
    });
  });

  it("should refuse a reviewer while a planned task has no report, naming the task", () => {
    const e2e_policy = { expected: false, sources: [], command: "", reason: "No e2e tooling." };
    writeFileSync(path.join(tasks, "planner-output.json"), JSON.stringify({ tasks: [{ id: "T1" }, { id: "T2" }, { id: "T10" }], test_strategy: { e2e_policy } }));
    writeFileSync(path.join(tasks, "developer-report-T1.md"), "# Rapport");
    writeFileSync(path.join(tasks, "developer-report-T10.md"), "# Rapport");
    expect(refusal("Agent", { subagent_type: "implementation-factory:qa-reviewer" })).toMatch(/T2 of planner-output\.json has no/);
    expect(refusal("Agent", { subagent_type: "implementation-factory:developer" })).toBeUndefined();
  });

  it("should start the review once every task is reported or named in the merged report", () => {
    writeFileSync(path.join(tasks, "planner-output.json"), JSON.stringify({ tasks: [{ id: "T1" }, { id: "T2" }] }));
    writeFileSync(path.join(tasks, "developer-report-T1.md"), "# Rapport");
    writeFileSync(path.join(tasks, "developer-report.md"), "## T1\n\nFait.\n\n## T2\n\nNon lancée : couverte par T1.\n");
    expect(refusal("Agent", { subagent_type: "implementation-factory:review-orchestrator" })).toBeUndefined();
  });

  it("should not take T1 named in the merged report for T10", () => {
    writeFileSync(path.join(tasks, "planner-output.json"), JSON.stringify({ tasks: [{ id: "T1" }] }));
    writeFileSync(path.join(tasks, "developer-report.md"), "## T10\n");
    expect(refusal("Agent", { subagent_type: "implementation-factory:senior-reviewer" })).toContain("T1 ");
  });

  it("should start the review when the plan cannot be read", () => {
    writeFileSync(path.join(tasks, "planner-output.json"), "{ not json");
    expect(refusal("Agent", { subagent_type: "implementation-factory:senior-reviewer" })).toBeUndefined();
  });

  it("should refuse a commit or a publication that links to the session", () => {
    expect(refusal("Bash", { command: "git -C /repo commit -m 'fix: x' -m 'Claude-Session: https://claude.ai/code/session_01'" })).toContain("Claude-Session");
    expect(refusal("Bash", { command: "glab mr create --description 'https://claude.ai/code/session_01'" })).toBeDefined();
    expect(refusal("Bash", { command: "gh pr create --title 'feat: x' --body 'https://claude.ai/code/session_01'" })).toBeDefined();
    expect(refusal("Bash", { command: "gh pr comment 12 --body 'See https://claude.ai/code/session_01'" })).toBeDefined();
    expect(refusal("Bash", { command: "gh pr create --title 'feat: x' --body-file .claude/tasks/mr-description.md" })).toBeUndefined();
    expect(refusal("Bash", { command: "git commit -m 'fix(cart): keep the total when a line is removed'" })).toBeUndefined();
    expect(refusal("Bash", { command: "git log --grep 'Co-Authored-By:'" })).toBeUndefined();
  });

  it("should let a commit or a publication credit the model", () => {
    expect(refusal("Bash", { command: "git commit -m \"fix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\"" })).toBeUndefined();
    expect(refusal("Bash", { command: "glab mr create --description 'Generated with [Claude Code](https://claude.com/claude-code)'" })).toBeUndefined();
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
      expect(refusal("Agent", { subagent_type: "implementation-factory:ticket-scheduler", prompt: "p" }, session)).toBeUndefined();
      expect(refusal("Agent", { subagent_type: "general-purpose", prompt: "p" }, session)).toBe("The scheduling session starts `implementation-factory:ticket-scheduler` and no other agent.");
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
      expect(refusal("Agent", { subagent_type: "implementation-factory:senior-reviewer", prompt: "p" }, session)).toBe("The improvement judge starts no agent: it decides alone.");
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
      "git stash push -u -m implementation-factory-1",
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
    expect(refusal("Agent", { subagent_type: "developer" }, {})).toContain("implementation-factory:developer");
  });

  describe("on the review tier the diff requires", () => {
    const senior = { subagent_type: "implementation-factory:senior-reviewer" };
    const orchestrator = { subagent_type: "implementation-factory:review-orchestrator" };
    const qa = { subagent_type: "implementation-factory:qa-reviewer" };

    /** The parent environment's sensitive-path list must not decide these. */
    function tierEnv(extra: Record<string, string> = {}) {
      const { IMPL_SENSITIVE_PATHS: _paths, IMPL_SOURCE_BRANCH: _source, IMPL_BASE_BRANCH: _base, IMPL_TICKET_BASE_BRANCH: _ticket, IMPL_JUDGE_OUTPUT: _judge, IMPL_SCHEDULE_OUTPUT: _schedule, IMPL_RUN_ID: _run, IMPL_HOOK_URL: _url, ...inherited } = process.env;
      return { ...inherited, IMPL_RUN_ID: "run", ...extra };
    }

    function git(args: string[]) {
      const result = spawnSync("git", args, {
        cwd, encoding: "utf8",
        env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" },
      });
      expect({ status: result.status, stderr: result.stderr }).toMatchObject({ status: 0 });
    }

    function commitChange(file: string, content: string) {
      git(["init", "-b", "main"]);
      writeFileSync(path.join(cwd, "README.md"), "base\n");
      git(["add", "README.md"]);
      git(["commit", "-m", "base"]);
      git(["checkout", "-b", "feature"]);
      mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
      writeFileSync(path.join(cwd, file), content);
      git(["add", "--", file]);
      git(["commit", "-m", "change"]);
    }

    function workflow(tier: number | undefined, baseBranch = "main") {
      writeFileSync(path.join(tasks, "workflow-state.json"), JSON.stringify({ schemaVersion: 1, revision: 1, state: "working", step: "7", ...(tier === undefined ? {} : { reviewTier: tier }), baseBranch }));
    }

    function open(command: string, extra: Record<string, string> = {}) {
      return refusal("Bash", { command }, tierEnv({ IMPL_SOURCE_BRANCH: "main", ...extra }));
    }

    it("should refuse a review below the floor and let the tier the paths require through", () => {
      commitChange("src/auth/login.ts", "token\n");
      workflow(0);
      expect(refusal("Agent", senior, tierEnv({ IMPL_SOURCE_BRANCH: "main" }))).toMatch(/review tier is at least 1/);
      workflow(1);
      expect(refusal("Agent", senior, tierEnv({ IMPL_SOURCE_BRANCH: "main" }))).toBeUndefined();
      mkdirSync(path.join(cwd, ".github", "workflows"), { recursive: true });
      writeFileSync(path.join(cwd, ".github", "workflows", "ci.yml"), "name: ci\n");
      git(["add", "--", ".github/workflows/ci.yml"]);
      git(["commit", "-m", "ci"]);
      workflow(1);
      expect(refusal("Agent", senior, tierEnv({ IMPL_SOURCE_BRANCH: "main" }))).toMatch(/review tier is at least 2/);
      workflow(2);
      expect(refusal("Agent", orchestrator, tierEnv({ IMPL_SOURCE_BRANCH: "main" }))).toBeUndefined();
    });

    it("should keep a migration at tier 2 when the setting lists only auth, and let the call through when the diff cannot be read", () => {
      commitChange("db/migrate/001.rb", "change\n");
      workflow(1);
      expect(refusal("Agent", senior, tierEnv({ IMPL_SOURCE_BRANCH: "main", IMPL_SENSITIVE_PATHS: "**/auth/**" }))).toMatch(/at least 2/);
      writeFileSync(path.join(tasks, "workflow-state.json"), "{");
      expect(refusal("Agent", senior, tierEnv({ IMPL_SOURCE_BRANCH: "main" }))).toBeUndefined();
    });

    it("should measure from baseBranch, and from an uncommitted file", () => {
      commitChange("src/app.ts", "app\n");
      workflow(0);
      expect(refusal("Agent", senior, tierEnv())).toBeUndefined();
      mkdirSync(path.join(cwd, "auth"), { recursive: true });
      writeFileSync(path.join(cwd, "auth", "login.ts"), "token\n");
      expect(refusal("Agent", senior, tierEnv())).toMatch(/auth\/login\.ts/);
    });

    it("should refuse to publish tier 2 until the orchestrator has written a verdict, and tier 1 until QA has", () => {
      commitChange(".gitlab-ci.yml", "stages: []\n");
      workflow(2);
      const create = "gh pr create --base main --head feature --title 'feat: x' --body-file .claude/tasks/mr-description.md";
      expect(open(create)).toMatch(/review-orchestrator/);
      expect(open("sudo /usr/bin/gh pr create --title x")).toMatch(/review-orchestrator/);
      expect(open("glab api --method POST \"projects/:fullpath/merge_requests\" --field description=@.claude/tasks/mr-description.md")).toMatch(/review-orchestrator/);
      expect(open("gh api --method=POST repos/acme/shop/pulls")).toMatch(/review-orchestrator/);
      expect(open("git commit -m \"mention gh pr create\"")).toBeUndefined();
      expect(open("glab api --method POST projects/:fullpath/merge_requests/12/notes")).toBeUndefined();
      expect(open("gh pr comment 12 --body-file .claude/tasks/mr-review-comment.md")).toBeUndefined();
      writeFileSync(path.join(tasks, "review-summary.md"), "## Verdict\n\nREADY\n");
      expect(open(create)).toMatch(/review-orchestrator/);
      expect(refusal("Agent", orchestrator, tierEnv({ IMPL_SOURCE_BRANCH: "main" }))).toBeUndefined();
      expect(open(create)).toBeUndefined();

      rmSync(path.join(cwd, ".git"), { recursive: true, force: true });
      rmSync(path.join(tasks, "review-summary.md"), { force: true });
      commitChange("src/security/token.ts", "secret\n");
      workflow(1);
      const tier1 = { IMPL_RUN_ID: "tier-1" };
      expect(open("gh pr create --title x", tier1)).toMatch(/qa-reviewer/);
      expect(refusal("Agent", qa, tierEnv({ IMPL_SOURCE_BRANCH: "main", ...tier1 }))).toBeUndefined();
      writeFileSync(path.join(tasks, "qa-report.md"), " \n");
      expect(open("gh pr create --title x", tier1)).toMatch(/qa-report\.md/);
      writeFileSync(path.join(tasks, "qa-report.md"), "# QA\n\nPASS\n");
      expect(open("gh pr create --title x", tier1)).toBeUndefined();
    });

    it("should print the same floor the guard enforces", () => {
      commitChange("db/migrations/004.sql", "select 1;\n");
      workflow(0);
      const result = spawnSync(process.execPath, [tierScript], { cwd, encoding: "utf8", env: tierEnv({ IMPL_SOURCE_BRANCH: "main" }) });
      expect({ status: result.status, stderr: result.stderr }).toMatchObject({ status: 0 });
      expect(JSON.parse(result.stdout)).toMatchObject({ floor: 2, unreadable: false, reviewTier: 0 });
    });
  });
});
