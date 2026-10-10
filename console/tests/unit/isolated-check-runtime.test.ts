import { afterEach, describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IsolationUnavailable, runIsolatedChecks } from "../../server/isolated-checks";

const originalPath = process.env.PATH;
const originalLog = process.env.IMPL_FAKE_DOCKER_LOG;
const originalMode = process.env.IMPL_FAKE_DOCKER_MODE;
let root: string | undefined;
afterEach(async () => {
  if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
  if (originalLog === undefined) delete process.env.IMPL_FAKE_DOCKER_LOG; else process.env.IMPL_FAKE_DOCKER_LOG = originalLog;
  if (originalMode === undefined) delete process.env.IMPL_FAKE_DOCKER_MODE; else process.env.IMPL_FAKE_DOCKER_MODE = originalMode;
  if (root) await rm(root, { recursive: true, force: true });
});

async function setup(mode = "pass") {
  root = await mkdtemp(path.join(os.tmpdir(), "impl-docker-contract-"));
  const log = path.join(root, "calls.jsonl");
  await writeFile(path.join(root, "docker"), `#!/usr/bin/env node
const fs = require('node:fs'); const {execFileSync} = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.IMPL_FAKE_DOCKER_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'inspect') console.log(process.env.IMPL_FAKE_DOCKER_MODE === 'network' ? '{"bridge":{}}' : '{}');
if (args[0] === 'cp') fs.writeFileSync(process.env.IMPL_FAKE_DOCKER_LOG + '.archive', execFileSync('tar', ['-tf', args[1]]));
if (process.env.IMPL_FAKE_DOCKER_MODE === 'unavailable' && args[0] === 'info') process.exit(1);
if (process.env.IMPL_FAKE_DOCKER_MODE === 'fail' && args.includes('node_modules/.bin/jest')) { console.error('test failure'); process.exit(1); }
`, { mode: 0o755 });
  process.env.PATH = `${root}${path.delimiter}${originalPath ?? ""}`;
  process.env.IMPL_FAKE_DOCKER_LOG = log; process.env.IMPL_FAKE_DOCKER_MODE = mode;
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: root, stdio: "pipe" }).toString().trim();
  git("init", "-q"); await writeFile(path.join(root, "tracked.txt"), "tracked");
  git("add", "tracked.txt"); git("commit", "-qm", "snapshot");
  await writeFile(path.join(root, "tracked.txt"), "uncommitted"); await writeFile(path.join(root, ".env"), "SYNTHETIC_HOST_SECRET");
  return { root, log, commit: git("rev-parse", "HEAD") };
}

describe("isolated check orchestration", () => {
  it("should export the exact commit, disconnect before scripts and remove the container", async () => {
    const { root, log, commit } = await setup();
    expect((await runIsolatedChecks(root, commit, true)).every((check) => check.ok)).toBe(true);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(await readFile(`${log}.archive`, "utf8")).toBe("tracked.txt\n");
    expect(calls.findIndex((args) => args[0] === "start")).toBeLessThan(calls.findIndex((args) => args[0] === "cp"));
    const disconnect = calls.findIndex((args) => args[0] === "network" && args[1] === "disconnect");
    const rebuild = calls.findIndex((args) => args.includes("rebuild")); expect(disconnect).toBeLessThan(rebuild);
    const install = calls.find((args) => args.includes("ci")); expect(install).toContain("--ignore-scripts");
    for (const call of calls.filter((args) => args[0] === "exec")) {
      expect(call).toContain("-i"); expect(call.some((arg) => arg.startsWith("IMPL_") || arg.startsWith("GITHUB_TOKEN="))).toBe(false);
    }
    expect(calls.at(-1)?.slice(0, 2)).toEqual(["rm", "--force"]);
  });
  it("should stop on a failed check and still remove the container", async () => {
    const { root, log, commit } = await setup("fail");
    const checks = await runIsolatedChecks(root, commit, true);
    expect(checks.at(-1)).toMatchObject({ name: "unit tests", ok: false });
    expect(checks.some((check) => check.name === "build")).toBe(false);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(calls.at(-1)?.slice(0, 2)).toEqual(["rm", "--force"]);
  });
  it("should refuse checks when disconnecting left a network attached", async () => {
    const { root, log, commit } = await setup("network");
    await expect(runIsolatedChecks(root, commit, false)).rejects.toThrow("network isolation");
    const calls = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(calls.some((args) => args.includes("rebuild"))).toBe(false);
    expect(calls.at(-1)?.slice(0, 2)).toEqual(["rm", "--force"]);
  });
  it("should report unavailable isolation without exporting or executing the candidate", async () => {
    const { root, log, commit } = await setup("unavailable");
    await expect(runIsolatedChecks(root, commit, false)).rejects.toBeInstanceOf(IsolationUnavailable);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(calls.map((args) => args[0])).toEqual(["info"]);
  });
});
