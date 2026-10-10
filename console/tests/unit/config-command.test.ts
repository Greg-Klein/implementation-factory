import { describe, expect, it } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "..");
const configPath = path.join(repoRoot, "bin", "config.mjs");
const examplePath = path.join(repoRoot, ".env.example");

function envFile(content = "") {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "impl-config-")), ".env");
  if (content) writeFileSync(file, content);
  return file;
}

function config(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("node", [configPath, ...args], {
    encoding: "utf8",
    // A bare IMPL_* variable inherited from the developer's shell would be
    // reported as the effective value and hide what the file actually holds.
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: "test", ...env },
    timeout: 20_000,
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("impl config", () => {
  it("should print the path of the configuration file", () => {
    const file = envFile();
    expect(config(["path"], { IMPL_ENV_FILE: file }).stdout.trim()).toBe(file);
  });

  it("should list every key with its effective value and source", () => {
    const { code, stdout } = config(["list"], { IMPL_ENV_FILE: envFile("IMPL_PORT='4321'\n"), IMPL_HOST: "0.0.0.0" });
    expect(code).toBe(0);
    expect(stdout).toMatch(/IMPL_PORT\s+4321\s+\.env/);
    expect(stdout).toMatch(/IMPL_HOST\s+0\.0\.0\.0\s+shell/);
    expect(stdout).toMatch(/IMPL_SEARCH_ROOTS\s+~\/workspace\s+default/);
    expect(stdout).toMatch(/IMPL_WORKTREE_DEPENDENCY_DIRS\s+node_modules\s+default/);
    expect(stdout).toMatch(/IMPL_WORKTREE_COPY_FILES\s+\.env\*,\.claude\/settings\.local\.json\s+default/);
  });

  it("should let a shell variable win over the file", () => {
    const file = envFile("IMPL_PORT='4321'\n");
    expect(config(["get", "IMPL_PORT"], { IMPL_ENV_FILE: file, IMPL_PORT: "5555" }).stdout.trim()).toBe("5555");
    expect(config(["get", "IMPL_PORT"], { IMPL_ENV_FILE: file }).stdout.trim()).toBe("4321");
  });

  it("should refuse an unknown key", () => {
    const { code, stderr } = config(["set", "IMPL_INCONNU=1"], { IMPL_ENV_FILE: envFile() });
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown variable");
  });

  it("should refuse an invalid port instead of writing it", () => {
    const file = envFile("IMPL_PORT='3210'\n");
    const { code, stderr } = config(["set", "IMPL_PORT=0"], { IMPL_ENV_FILE: file });
    expect(code).toBe(1);
    expect(stderr).toContain("expected an integer");
    expect(readFileSync(file, "utf8")).toBe("IMPL_PORT='3210'\n");
  });

  it("should refuse a boolean that is neither true nor false", () => {
    const { code, stderr } = config(["set", "IMPL_SELF_IMPROVEMENT_AUTORUN=oui"], { IMPL_ENV_FILE: envFile() });
    expect(code).toBe(1);
    expect(stderr).toContain("true or false");
  });

  it("should refuse a permission mode Claude Code does not accept", () => {
    const file = envFile();
    const { code, stderr } = config(["set", "IMPL_PERMISSION_MODE=plan"], { IMPL_ENV_FILE: file });
    expect(code).toBe(1);
    expect(stderr).toContain("bypassPermissions");
    expect(config(["set", "IMPL_PERMISSION_MODE=manual"], { IMPL_ENV_FILE: file }).code).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("IMPL_PERMISSION_MODE='manual'");
  });

  it("should take a list of dependency directories and refuse an empty one", () => {
    const file = envFile();
    expect(config(["set", "IMPL_WORKTREE_DEPENDENCY_DIRS=node_modules,vendor"], { IMPL_ENV_FILE: file }).code).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("IMPL_WORKTREE_DEPENDENCY_DIRS='node_modules,vendor'");
    expect(config(["get", "IMPL_WORKTREE_DEPENDENCY_DIRS"], { IMPL_ENV_FILE: file }).stdout.trim()).toBe("node_modules,vendor");
    expect(config(["set", "IMPL_WORKTREE_COPY_FILES= "], { IMPL_ENV_FILE: file }).code).toBe(1);
  });

  it("should take an absolute path or nothing for the ticket proposals file and refuse a relative one", () => {
    const file = envFile();
    expect(config(["set", "IMPL_TICKET_PROPOSALS_FILE=/tmp/proposals.json"], { IMPL_ENV_FILE: file }).code).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("IMPL_TICKET_PROPOSALS_FILE='/tmp/proposals.json'");
    expect(config(["set", "IMPL_TICKET_PROPOSALS_FILE="], { IMPL_ENV_FILE: file }).code).toBe(0);
    const { code, stderr } = config(["set", "IMPL_TICKET_PROPOSALS_FILE=~/proposals.json"], { IMPL_ENV_FILE: file });
    expect(code).toBe(1);
    expect(stderr).toContain("absolute path");
  });

  it("should write a valid value and point at the restart", () => {
    const file = envFile();
    const { code, stdout } = config(["set", "IMPL_PORT=4321"], { IMPL_ENV_FILE: file });
    expect(code).toBe(0);
    expect(stdout).toContain("impl restart");
    expect(readFileSync(file, "utf8")).toContain("IMPL_PORT='4321'");
  });

  it("should not ask for a restart for a launcher-only key", () => {
    const { stdout } = config(["set", "IMPL_NO_OPEN=1"], { IMPL_ENV_FILE: envFile() });
    expect(stdout).not.toContain("impl restart");
  });

  it("should report an invalid configuration with a non-zero exit code", () => {
    const { code, stderr } = config(["check"], { IMPL_ENV_FILE: envFile("IMPL_PORT='abc'\n") });
    expect(code).toBe(1);
    expect(stderr).toContain("IMPL_PORT");
  });

  it("should warn about an unknown key without failing", () => {
    const { code, stdout } = config(["check"], { IMPL_ENV_FILE: envFile("IMPL_OUBLIEE='1'\n") });
    expect(code).toBe(0);
    expect(stdout).toContain("unknown key");
  });

  it("should refuse to rewrite a line whose quote is never closed", () => {
    const file = envFile("IMPL_PORT='3210\n");
    const { code, stderr } = config(["set", "IMPL_PORT=4321"], { IMPL_ENV_FILE: file });
    expect(code).toBe(1);
    expect(stderr).toContain("Unclosed quote");
    expect(readFileSync(file, "utf8")).toBe("IMPL_PORT='3210\n");
  });

  it("should print the configuration instead of prompting when there is no terminal", () => {
    const { code, stdout, stderr } = config([], { IMPL_ENV_FILE: envFile() });
    expect(code).toBe(0);
    expect(stdout).toContain("IMPL_SEARCH_ROOTS");
    expect(stderr).toContain("Non-interactive terminal");
  });

  it("should keep .env.example identical to the schema template", () => {
    expect(config(["template"]).stdout).toBe(readFileSync(examplePath, "utf8"));
  });
});

describe("security configuration", () => {
  it("should validate a control token and avoid printing it in the settings list", () => {
    const file = envFile();
    expect(config(["set", "IMPL_CONTROL_TOKEN=short"], { IMPL_ENV_FILE: file }).code).toBe(1);
    const token = "test-secret-control-token-0123456789abcdef";
    expect(config(["set", `IMPL_CONTROL_TOKEN=${token}`], { IMPL_ENV_FILE: file }).code).toBe(0);
    const listed = config(["list"], { IMPL_ENV_FILE: file }).stdout;
    expect(listed).toContain("(configured secret)"); expect(listed).not.toContain(token);
    expect(config(["get", "IMPL_CONTROL_TOKEN"], { IMPL_ENV_FILE: file }).stdout.trim()).toBe(token);
  });
});
