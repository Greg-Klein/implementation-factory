import { describe, expect, it } from "@jest/globals";
import { actionLabel } from "../../server/domain";

describe("what the agent is doing right now", () => {
  it("should name the intent of a shell command, not the command", () => {
    expect(actionLabel("Bash", "glab issue view 258")).toBe("Reading the GitLab ticket");
    expect(actionLabel("Bash", "glab api projects/42")).toBe("Querying GitLab");
    expect(actionLabel("Bash", "glab mr create --fill --draft")).toBe("Opening the merge request");
    expect(actionLabel("Bash", 'glab api --method POST "projects/:fullpath/merge_requests" --field "source_branch=feat/258"')).toBe("Opening the merge request");
    expect(actionLabel("Bash", 'glab api --method POST projects/42/merge_requests/128/notes --field "body=@review.md"')).toBe("Querying GitLab");
    expect(actionLabel("Bash", "glab mr view 128 --comments")).toBe("Reading the merge request");
    expect(actionLabel("Bash", "gh issue view 258 --repo acme/shop --comments")).toBe("Reading the GitHub ticket");
    expect(actionLabel("Bash", "gh pr create --base main --body-file .claude/tasks/mr-description.md")).toBe("Opening the pull request");
    expect(actionLabel("Bash", 'gh api --method POST "repos/acme/shop/pulls" --field "head=feat/258"')).toBe("Opening the pull request");
    expect(actionLabel("Bash", "gh api --method POST repos/acme/shop/pulls/12/comments")).toBe("Querying GitHub");
    expect(actionLabel("Bash", "gh pr view 12 --json state")).toBe("Reading the pull request");
    expect(actionLabel("Bash", "git switch -c feat/258-notifications")).toBe("Creating the branch");
    expect(actionLabel("Bash", 'git commit -m "fix: close the agents"')).toBe("Committing the changes");
    expect(actionLabel("Bash", "git push -u origin HEAD")).toBe("Pushing the branch");
    expect(actionLabel("Bash", "git diff --stat")).toBe("Inspecting the repository");
    expect(actionLabel("Bash", "npm run test:unit")).toBe("Running the tests");
    expect(actionLabel("Bash", "npx playwright test --headed")).toBe("Running the tests");
    expect(actionLabel("Bash", "npm run typecheck")).toBe("Checking types");
    expect(actionLabel("Bash", "npm run build")).toBe("Building the project");
    expect(actionLabel("Bash", "npm ci --no-audit")).toBe("Installing the dependencies");
  });

  it("should read through the wrappers a command reaches the factory under", () => {
    // A hook of the user's own rewrites every shell call as `rtk <command>`.
    expect(actionLabel("Bash", "rtk git status")).toBe("Inspecting the repository");
    expect(actionLabel("Bash", "rtk grep actionLabel server")).toBe("Searching the code");
    expect(actionLabel("Bash", "cd console && npm test")).toBe("Running the tests");
  });

  it("should say at least that a shell is running, for a command it does not know", () => {
    expect(actionLabel("Bash", "./scripts/deploy.sh")).toBe("Shell command");
    expect(actionLabel("Bash", undefined)).toBe("Shell command");
  });

  it("should not mistake a project name for the tool it contains", () => {
    expect(actionLabel("Bash", "curl https://gitlab.example.com/api")).toBe("Shell command");
  });

  it("should name a file by its name alone, never by its path", () => {
    expect(actionLabel("Read", undefined, "/repo/console/server/domain.ts")).toBe("Reading domain.ts");
    expect(actionLabel("Edit", undefined, "/repo/console/lib/types.ts")).toBe("Editing types.ts");
    expect(actionLabel("Write", undefined, "/repo/tasks/todo.md")).toBe("Writing todo.md");
    expect(actionLabel("Read", undefined, undefined)).toBe("Reading a file");
  });

  it("should keep a search pattern whole, since it is not a path", () => {
    expect(actionLabel("Grep", undefined, "createsBranch|branchFromCommand")).toBe("Searching for \"createsBranch|branchFromCommand\"");
    expect(actionLabel("Grep", undefined, undefined)).toBe("Searching the code");
  });

  it("should name the agent a delegation hands the work to", () => {
    expect(actionLabel("Agent", undefined, "developer")).toBe("Delegating to developer");
    expect(actionLabel("Task", undefined, "qa-reviewer")).toBe("Delegating to qa-reviewer");
    expect(actionLabel("Agent", undefined, undefined)).toBe("Delegating to an agent");
  });

  it("should name a web address by its host, and never by its query string", () => {
    expect(actionLabel("WebFetch", undefined, "https://nextjs.org/docs/app/api-reference/config?x=1")).toBe("Querying nextjs.org");
    expect(actionLabel("WebFetch", undefined, "pas une url")).toBe("Querying the web");
    expect(actionLabel("WebSearch", undefined, undefined)).toBe("Searching the web");
  });

  it("should recognize the external tools the review agents drive", () => {
    expect(actionLabel("mcp__playwright__browser_click")).toBe("Driving the browser");
    expect(actionLabel("mcp__plugin_figma_figma__get_design_context")).toBe("Querying Figma");
    expect(actionLabel("mcp__claude_ai_Slack__slack_send_message")).toBe("Calling an external tool");
  });

  it("should claim nothing about a tool it has no words for", () => {
    expect(actionLabel("SomeToolAddedLater")).toBeUndefined();
    expect(actionLabel("")).toBeUndefined();
  });
});
