import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Discovery reads real .git/config files, so the integration suite needs a real
 * checkout. Committing a nested .git directory would turn the fixture into an
 * embedded repository, so it is built outside the working tree instead.
 */
export const checkoutsRoot = path.join(os.tmpdir(), "implementation-harness-tests", "checkouts");
/** The hook secret the suite's server is started with, so a test can post hooks the way a session does. */
export const hookToken = "integration-hook-token";
export const sampleCheckout = path.join(checkoutsRoot, "repo");
export const sampleProject = "group/repo";

export function createSampleCheckout() {
  mkdirSync(path.join(sampleCheckout, ".git"), { recursive: true });
  writeFileSync(
    path.join(sampleCheckout, ".git", "config"),
    `[remote "origin"]\n\turl = https://gitlab.com/${sampleProject}.git\n`,
  );
  return sampleCheckout;
}

/** Where the suite's console keeps its runs, away from the developer's own history. */
export const dataDirectory = path.join(os.tmpdir(), "implementation-harness-tests", "data");
/** A `claude` that only waits at its prompt, put first on the console's PATH. See tests/fake-claude/claude. */
export const fakeClaudeDirectory = fileURLToPath(new URL("./fake-claude", import.meta.url));

/**
 * A real git checkout, for the runs that go through the actual session path:
 * the code snapshot utility hashes a working tree, which the bare `.git/config`
 * of the sample checkout cannot give it.
 */
export function createGitCheckout(name: string) {
  const directory = path.join(checkoutsRoot, name);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args], { cwd: directory, stdio: "ignore" });
  git("init", "-q");
  git("remote", "add", "origin", `https://gitlab.com/group/${name}.git`);
  writeFileSync(path.join(directory, "app.ts"), "export const answer = 42;\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  return { directory, project: `group/${name}`, issueUrl: `https://gitlab.com/group/${name}/-/issues/1` };
}
