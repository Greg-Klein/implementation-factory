import { describe, expect, it } from "@jest/globals";
import { gitLabIssueEndpoint, gitLabProjectPath, gitRemoteProjects, listSetting, permissionMode, positiveDuration } from "../../server/domain";

describe("harness configuration", () => {
  it("should use positive durations and reject invalid overrides", () => {
    expect(positiveDuration("500", 5_000)).toBe(500);
    expect(positiveDuration("0", 5_000)).toBe(5_000);
    expect(positiveDuration("invalid", 5_000)).toBe(5_000);
  });

  it("should start a run in a known permission mode rather than a mode Claude Code refuses", () => {
    expect(permissionMode("bypassPermissions", "auto")).toBe("bypassPermissions");
    expect(permissionMode(" manual ", "auto")).toBe("manual");
    expect(permissionMode("plan", "auto")).toBe("auto");
    expect(permissionMode("", "auto")).toBe("auto");
    expect(permissionMode(undefined, "auto")).toBe("auto");
  });

  it("should bring node_modules and the local configuration into a worktree unless told otherwise", () => {
    expect(listSetting(undefined, ["node_modules"])).toEqual(["node_modules"]);
    expect(listSetting("", [".env*", ".claude/settings.local.json"])).toEqual([".env*", ".claude/settings.local.json"]);
    expect(listSetting("node_modules, vendor", ["node_modules"])).toEqual(["node_modules", "vendor"]);
  });

  it("should extract nested GitLab project paths from issue URLs", () => {
    expect(gitLabProjectPath("https://gitlab.com/group/platform/repo/-/issues/42")).toBe("group/platform/repo");
    expect(gitLabProjectPath("https://gitlab.com/group/platform/repo/-/work_items/42")).toBe("group/platform/repo");
    expect(gitLabProjectPath("https://gitlab.com/group/repo/-/merge_requests/42")).toBeUndefined();
    expect(gitLabProjectPath("not-a-url")).toBeUndefined();
  });

  it("should build the GitLab API path of the issue a ticket URL points at", () => {
    expect(gitLabIssueEndpoint("https://gitlab.example.com/group/platform/repo/-/issues/42#note_1")).toEqual({ hostname: "gitlab.example.com", path: "projects/group%2Fplatform%2Frepo/issues/42" });
    expect(gitLabIssueEndpoint("https://gitlab.com/group/repo/-/work_items/7")).toEqual({ hostname: "gitlab.com", path: "projects/group%2Frepo/issues/7" });
    expect(gitLabIssueEndpoint("ticket-simule://IH-42")).toBeUndefined();
  });

  it("should read project paths from every remote form", () => {
    const config = [
      '[remote "origin"]',
      "\turl = git@gitlab.com:group/platform/repo.git",
      '[remote "mirror"]',
      "\turl = https://gitlab.com/group/other.git",
      '[remote "ssh"]',
      "\turl = ssh://git@gitlab.com/group/third",
    ].join("\n");
    expect(gitRemoteProjects(config)).toEqual(["group/platform/repo", "group/other", "group/third"]);
  });

  it("should ignore a git config without any usable remote", () => {
    expect(gitRemoteProjects("[core]\n\tbare = false\n")).toEqual([]);
    expect(gitRemoteProjects("")).toEqual([]);
  });
});
