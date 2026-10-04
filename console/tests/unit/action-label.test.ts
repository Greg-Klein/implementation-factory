import { describe, expect, it } from "@jest/globals";
import { actionLabel } from "../../server/domain";

describe("what the agent is doing right now", () => {
  it("should name the intent of a shell command, not the command", () => {
    expect(actionLabel("Bash", "glab issue view 258")).toBe("Lecture du ticket GitLab");
    expect(actionLabel("Bash", "glab api projects/42")).toBe("Consultation de GitLab");
    expect(actionLabel("Bash", "glab mr create --fill --draft")).toBe("Ouverture de la merge request");
    expect(actionLabel("Bash", 'glab api --method POST "projects/:fullpath/merge_requests" --field "source_branch=feat/258"')).toBe("Ouverture de la merge request");
    expect(actionLabel("Bash", 'glab api --method POST projects/42/merge_requests/128/notes --field "body=@review.md"')).toBe("Consultation de GitLab");
    expect(actionLabel("Bash", "glab mr view 128 --comments")).toBe("Consultation de la merge request");
    expect(actionLabel("Bash", "gh issue view 258 --repo acme/shop --comments")).toBe("Lecture du ticket GitHub");
    expect(actionLabel("Bash", "gh pr create --base main --body-file .claude/tasks/mr-description.md")).toBe("Ouverture de la pull request");
    expect(actionLabel("Bash", 'gh api --method POST "repos/acme/shop/pulls" --field "head=feat/258"')).toBe("Ouverture de la pull request");
    expect(actionLabel("Bash", "gh api --method POST repos/acme/shop/pulls/12/comments")).toBe("Consultation de GitHub");
    expect(actionLabel("Bash", "gh pr view 12 --json state")).toBe("Consultation de la pull request");
    expect(actionLabel("Bash", "git switch -c feat/258-notifications")).toBe("Création de la branche");
    expect(actionLabel("Bash", 'git commit -m "fix: close the agents"')).toBe("Commit des modifications");
    expect(actionLabel("Bash", "git push -u origin HEAD")).toBe("Publication de la branche");
    expect(actionLabel("Bash", "git diff --stat")).toBe("Inspection du dépôt");
    expect(actionLabel("Bash", "npm run test:unit")).toBe("Exécution des tests");
    expect(actionLabel("Bash", "npx playwright test --headed")).toBe("Exécution des tests");
    expect(actionLabel("Bash", "npm run typecheck")).toBe("Vérification des types");
    expect(actionLabel("Bash", "npm run build")).toBe("Build du projet");
    expect(actionLabel("Bash", "npm ci --no-audit")).toBe("Installation des dépendances");
  });

  it("should read through the wrappers a command reaches the harness under", () => {
    // A hook of the user's own rewrites every shell call as `rtk <command>`.
    expect(actionLabel("Bash", "rtk git status")).toBe("Inspection du dépôt");
    expect(actionLabel("Bash", "rtk grep actionLabel server")).toBe("Recherche dans le code");
    expect(actionLabel("Bash", "cd console && npm test")).toBe("Exécution des tests");
  });

  it("should say at least that a shell is running, for a command it does not know", () => {
    expect(actionLabel("Bash", "./scripts/deploy.sh")).toBe("Commande shell");
    expect(actionLabel("Bash", undefined)).toBe("Commande shell");
  });

  it("should not mistake a project name for the tool it contains", () => {
    expect(actionLabel("Bash", "curl https://gitlab.example.com/api")).toBe("Commande shell");
  });

  it("should name a file by its name alone, never by its path", () => {
    expect(actionLabel("Read", undefined, "/repo/console/server/domain.ts")).toBe("Lecture de domain.ts");
    expect(actionLabel("Edit", undefined, "/repo/console/lib/types.ts")).toBe("Modification de types.ts");
    expect(actionLabel("Write", undefined, "/repo/tasks/todo.md")).toBe("Écriture de todo.md");
    expect(actionLabel("Read", undefined, undefined)).toBe("Lecture d'un fichier");
  });

  it("should keep a search pattern whole, since it is not a path", () => {
    expect(actionLabel("Grep", undefined, "createsBranch|branchFromCommand")).toBe("Recherche de « createsBranch|branchFromCommand »");
    expect(actionLabel("Grep", undefined, undefined)).toBe("Recherche dans le code");
  });

  it("should name the agent a delegation hands the work to", () => {
    expect(actionLabel("Agent", undefined, "developer")).toBe("Délégation à developer");
    expect(actionLabel("Task", undefined, "qa-reviewer")).toBe("Délégation à qa-reviewer");
    expect(actionLabel("Agent", undefined, undefined)).toBe("Délégation à un agent");
  });

  it("should name a web address by its host, and never by its query string", () => {
    expect(actionLabel("WebFetch", undefined, "https://nextjs.org/docs/app/api-reference/config?x=1")).toBe("Consultation de nextjs.org");
    expect(actionLabel("WebFetch", undefined, "pas une url")).toBe("Consultation du web");
    expect(actionLabel("WebSearch", undefined, undefined)).toBe("Recherche sur le web");
  });

  it("should recognize the external tools the review agents drive", () => {
    expect(actionLabel("mcp__playwright__browser_click")).toBe("Pilotage du navigateur");
    expect(actionLabel("mcp__plugin_figma_figma__get_design_context")).toBe("Consultation de Figma");
    expect(actionLabel("mcp__claude_ai_Slack__slack_send_message")).toBe("Appel d'un outil externe");
  });

  it("should claim nothing about a tool it has no words for", () => {
    expect(actionLabel("SomeToolAddedLater")).toBeUndefined();
    expect(actionLabel("")).toBeUndefined();
  });
});
