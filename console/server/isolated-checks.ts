import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
export type Check = { name: string; command: string; ok: boolean; output: string };
export class IsolationUnavailable extends Error {}
const TIMEOUT = 20 * 60_000;
const OUTPUT_LIMIT = 2 * 1024 * 1024;
const activeContainers = new Set<string>();
let stopping = false;
export const CHECK_IMAGE = "mcr.microsoft.com/playwright:v1.63.0-noble";

/** Installation starts online without host mounts, secrets or a writable image filesystem. */
export function containerArguments(name: string, image: string) {
  return ["create", "--name", name, "--init", "--network", "bridge", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--user", "1000:1000", "--cpus", "2", "--memory", "4g",
    "--memory-swap", "4g", "--pids-limit", "256", "--shm-size", "256m", "--log-driver", "none",
    "--tmpfs", "/work:rw,exec,size=2g,uid=1000,gid=1000", "--tmpfs", "/tmp:rw,exec,size=512m,uid=1000,gid=1000",
    "--workdir", "/work", "--entrypoint", "/bin/sh", image, "-c", "sleep infinity"];
}

/** Commands are provided by the trusted console, never read from the candidate's scripts. */
export function checkSteps(integration: boolean): { name: string; args: string[] }[] {
  return [
    { name: "dependency scripts", args: ["npm", "rebuild", "--offline"] },
    { name: "typecheck", args: ["node_modules/.bin/tsc", "--noEmit", "--incremental", "false"] },
    { name: "script typecheck", args: ["node_modules/.bin/tsc", "-p", "tsconfig.scripts.json", "--incremental", "false"] },
    { name: "unit tests", args: ["node_modules/.bin/jest", "--runInBand", "--no-cache"] },
    { name: "build", args: ["node_modules/.bin/next", "build", "--webpack"] },
    ...(integration ? [{ name: "integration tests", args: ["node_modules/.bin/playwright", "test"] }] : []),
  ];
}

/** Bound both elapsed time and output; killing docker exec is followed by removing its container. */
async function docker(args: string[], timeout = TIMEOUT) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("docker", args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", bytes = 0, failure: Error | undefined;
    const stop = (message: string) => { failure ??= new Error(message); child.kill("SIGKILL"); };
    const timer = setTimeout(() => stop("Isolated check timed out."), timeout);
    const append = (data: Buffer) => {
      bytes += data.length;
      if (bytes > OUTPUT_LIMIT) { stop("Isolated check exceeded its output limit."); return; }
      output = (output + data.toString()).slice(-8_000);
    };
    child.stdout.on("data", append); child.stderr.on("data", append);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); if (failure || code !== 0) reject(failure ?? new Error(output.trim() || `docker exited ${code}`)); else resolve(output); });
  });
}

/** Export the exact commit, not its worktree's ignored files, dependencies or credentials. */
export async function runIsolatedChecks(repository: string, commit: string, integration: boolean): Promise<Check[]> {
  const image = process.env.IMPL_CHECK_IMAGE?.trim() || CHECK_IMAGE;
  try { await docker(["info", "--format", "{{.ServerVersion}}"], 10_000); await docker(["image", "inspect", image], 10_000); }
  catch { throw new IsolationUnavailable(`Automatic merge paused: Docker or the check image is unavailable. Pull ${image}, then start Docker. The branch is kept.`); }
  const temporary = await mkdtemp(path.join(os.tmpdir(), "impl-check-"));
  const name = `impl-check-${randomUUID()}`;
  const checks: Check[] = [];
  let creationAttempted = false;
  try {
    const archive = path.join(temporary, "source.tar");
    await exec("git", ["archive", "--format=tar", `--output=${archive}`, commit], { cwd: repository, timeout: 60_000 });
    if (stopping) throw new IsolationUnavailable("Automatic merge paused: the console is stopping.");
    creationAttempted = true; activeContainers.add(name);
    await docker(containerArguments(name, image), 30_000);
    await docker(["start", name], 30_000);
    await docker(["cp", archive, `${name}:/tmp/source.tar`], 60_000);
    const execute = (args: string[], cwd = "/work/console") => docker(["exec", "--workdir", cwd, name,
      "env", "-i", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HOME=/tmp/home",
      "CI=1", "NEXT_TELEMETRY_DISABLED=1", "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright", "npm_config_cache=/tmp/npm", ...args]);
    await execute(["tar", "-xf", "/tmp/source.tar", "-C", "/work"], "/work");
    try {
      await execute(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
      checks.push({ name: "install", command: "npm ci --ignore-scripts --no-audit --no-fund", ok: true, output: "" });
    } finally { await docker(["network", "disconnect", "bridge", name], 30_000); }
    const networks = JSON.parse(await docker(["inspect", "--format", "{{json .NetworkSettings.Networks}}", name], 10_000)) as unknown;
    if (!networks || typeof networks !== "object" || Array.isArray(networks) || Object.keys(networks).length !== 0) throw new Error("Candidate network isolation could not be verified.");
    for (const step of checkSteps(integration)) {
      if (stopping) throw new IsolationUnavailable("Automatic merge paused: the console is stopping.");
      try { await execute(step.args); checks.push({ name: step.name, command: step.args.join(" "), ok: true, output: "" }); }
      catch (error) { checks.push({ name: step.name, command: step.args.join(" "), ok: false, output: String(error).slice(-1_500) }); break; }
    }
    return checks;
  } finally {
    try {
      if (creationAttempted && activeContainers.has(name)) await removeContainer(name, 10_000);
      activeContainers.delete(name);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
}

/** Stop candidate processes before the console exits, including checks interrupted by SIGTERM. */
export async function stopIsolatedChecks() {
  stopping = true;
  await Promise.all([...activeContainers].map(async (name) => {
    await removeContainer(name, 5_000);
    activeContainers.delete(name);
  }));
}

async function removeContainer(name: string, timeout: number) {
  try { await docker(["rm", "--force", name], timeout); }
  catch (error) { if (!/No such container/i.test(String(error))) throw error; }
}
