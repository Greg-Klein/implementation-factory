import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { inWorkflow, taskDirectory } from "./guard.mjs";

/**
 * The stop gate: when an agent that edits code tries to hand back, the checks
 * its edits call for are run again here, by the harness, and a failure sends
 * the agent back once with the output. Every verdict goes to
 * `.claude/tasks/gate-log.jsonl`, which the pilot reads instead of the report.
 *
 * Three things keep it from doing harm. It blocks once: the second stop is
 * always let through and recorded as it stands. It fails open: a check that
 * cannot run is `skipped`, a package with nothing to run is `none`, and any
 * error in here lets the agent go. And it stays in scope: lint and tests cover
 * the files this agent edited, and while a peer of a parallel batch is still
 * editing, a type error outside those files is `inconclusive`, not a failure.
 */

const GATED = ["implementation-harness:developer", "implementation-harness:senior-reviewer"];
const EDITING_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const ESLINT_CONFIGS = [
  "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts",
  ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml",
];
const LEDGER = "gate-log.jsonl";
const TAIL_LINES = 60;
/** How long an agent may stay silent and still count as editing beside this one. */
const PEER_QUIET_MS = 15 * 60_000;

function milliseconds(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function gateDisabled(env) {
  return ["off", "0", "false", "no"].includes(String(env.IMPL_STOP_GATE ?? "").toLowerCase());
}

/** Where one session keeps what its agents edited: outside the repository, so nothing lands in a diff or a snapshot. */
function stateDirectory(payload, env) {
  const base = env.IMPL_GATE_STATE_DIR || path.join(os.tmpdir(), `implementation-harness-gate-${os.userInfo().username}`);
  const session = createHash("sha256").update(String(payload.session_id ?? payload.cwd ?? "")).digest("hex").slice(0, 16);
  return path.join(base, session);
}

function agentFile(directory, agentId, extension) {
  return path.join(directory, `${String(agentId).replace(/[^\w.-]/g, "_")}.${extension}`);
}

/**
 * Called on every hook of a workflow session, before the stop is judged: notes
 * which gated agents are alive and which files each one edits. The stop event
 * is the only one that names the agent's type for sure, so edits are kept for
 * any agent and sorted out when it stops.
 */
export function gateObserve(payload, env = process.env) {
  const agentId = payload?.agent_id;
  if (!agentId || !inWorkflow(env, taskDirectory(payload.cwd))) return;
  const directory = stateDirectory(payload, env);
  if (payload.hook_event_name === "SubagentStart") {
    if (!GATED.includes(payload.agent_type)) return;
    mkdirSync(directory, { recursive: true });
    writeFileSync(agentFile(directory, agentId, "active"), "");
    return;
  }
  if (payload.hook_event_name !== "PreToolUse") return;
  const marker = agentFile(directory, agentId, "active");
  if (existsSync(marker)) { const now = new Date(); utimesSync(marker, now, now); }
  if (!EDITING_TOOLS.includes(payload.tool_name)) return;
  const edited = payload.tool_input?.file_path ?? payload.tool_input?.notebook_path;
  if (typeof edited !== "string" || !edited) return;
  mkdirSync(directory, { recursive: true });
  appendFileSync(agentFile(directory, agentId, "files"), `${path.resolve(payload.cwd || ".", edited)}\n`);
}

function editedFiles(directory, agentId) {
  let text = "";
  try { text = readFileSync(agentFile(directory, agentId, "files"), "utf8"); } catch { /* the agent edited nothing through a tool */ }
  // Resolved like git resolves the repository, or a checkout reached through a symlink would hold none of them.
  return [...new Set(text.split("\n").filter(Boolean).map((file) => { try { return realpathSync(file); } catch { return file; } }))];
}

/** Whether another gated agent of the session was at work recently: its half-written code is in the tree. */
function peersEditing(directory, agentId, now) {
  let entries = [];
  try { entries = readdirSync(directory); } catch { return false; }
  const own = path.basename(agentFile(directory, agentId, "active"));
  return entries.some((entry) => {
    if (!entry.endsWith(".active") || entry === own) return false;
    try { return now - statSync(path.join(directory, entry)).mtimeMs < PEER_QUIET_MS; } catch { return false; }
  });
}

function repositoryRoot(directory) {
  const result = spawnSync("git", ["-C", directory, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 30_000 });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; }
}

/** A manifest that only carries repository tooling (husky, prettier) is not a package to check. */
function checkable(manifest) {
  if (!manifest) return false;
  const scripts = manifest.scripts ?? {};
  const development = Object.keys(manifest.devDependencies ?? {});
  return Object.keys(manifest.dependencies ?? {}).length > 0
    || ["typecheck", "type-check"].some((name) => name in scripts)
    || ["typescript", "eslint", "jest", "vitest", "react-scripts"].some((name) => development.includes(name));
}

/** The nearest directory above a file that holds a package to check, never above the repository. */
function packageRoot(file, top) {
  let directory = path.dirname(file);
  for (;;) {
    if (checkable(readJson(path.join(directory, "package.json")))) return directory;
    const parent = path.dirname(directory);
    if (directory === top || parent === directory) return undefined;
    directory = parent;
  }
}

/** Looks from the package up to the repository: a workspace keeps its binaries and its lockfile at the top. */
function findUpward(root, top, candidates) {
  let directory = root;
  for (;;) {
    for (const candidate of candidates) {
      const found = path.join(directory, candidate);
      if (existsSync(found)) return found;
    }
    const parent = path.dirname(directory);
    if (directory === top || parent === directory) return undefined;
    directory = parent;
  }
}

function packageManager(root, top) {
  const lockfile = findUpward(root, top, ["pnpm-lock.yaml", "yarn.lock", "package-lock.json"]);
  if (lockfile?.endsWith("pnpm-lock.yaml")) return "pnpm";
  return lockfile?.endsWith("yarn.lock") ? "yarn" : "npm";
}

/** A `tsconfig.json` that only lists project references compiles nothing by itself. */
function solutionStyle(root) {
  let text = "";
  try { text = readFileSync(path.join(root, "tsconfig.json"), "utf8"); } catch { return false; }
  return text.includes("\"references\"") && /"files"\s*:\s*\[\s*\]/.test(text);
}

/**
 * The checks one package gets, in the order they run. The type-check covers the
 * package, since an edit breaks its consumers; lint and tests cover the edited
 * files only, because a legacy tree is often red where nobody touched it.
 */
export function gateSteps(root, top, files) {
  const manifest = readJson(path.join(root, "package.json")) ?? {};
  const scripts = manifest.scripts ?? {};
  const binary = (name) => findUpward(root, top, [path.join("node_modules", ".bin", name)]);
  const steps = [];

  const script = ["typecheck", "type-check"].find((name) => name in scripts);
  const tsc = binary("tsc");
  if (script) steps.push({ step: "type-check", command: [packageManager(root, top), "run", script] });
  else if (tsc && existsSync(path.join(root, "tsconfig.json"))) steps.push({ step: "type-check", command: solutionStyle(root) ? [tsc, "-b"] : [tsc, "--noEmit"] });

  const sources = files.filter((file) => SCRIPT_EXTENSIONS.includes(path.extname(file)) && existsSync(file));
  if (!sources.length) return steps;
  const eslint = binary("eslint");
  if (eslint && (findUpward(root, top, ESLINT_CONFIGS) || "eslintConfig" in manifest)) steps.push({ step: "lint", command: [eslint, ...sources] });
  const vitest = binary("vitest");
  const jest = binary("jest");
  const reactScripts = binary("react-scripts");
  if (vitest) steps.push({ step: "related tests", command: [vitest, "related", "--run", "--passWithNoTests", ...sources] });
  else if (jest) steps.push({ step: "related tests", command: [jest, "--findRelatedTests", "--passWithNoTests", ...sources] });
  else if (reactScripts) steps.push({ step: "related tests", command: [reactScripts, "test", "--watchAll=false", "--passWithNoTests", "--findRelatedTests", ...sources] });
  return steps;
}

function run(command, cwd, timeout) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd, timeout, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, killSignal: "SIGKILL",
    env: { ...process.env, CI: "true", FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  // eslint-disable-next-line no-control-regex
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  // A check that could not run, tool missing or out of time, is not the agent's to fix.
  if (result.error || result.status === null) return { ran: false, output: result.error?.code === "ETIMEDOUT" ? `timed out after ${Math.round(timeout / 1000)} s` : String(result.error?.message ?? "killed") };
  return { ran: true, passed: result.status === 0, output };
}

function tail(text) {
  return text.split("\n").filter((line) => line.trim()).slice(-TAIL_LINES).join("\n");
}

/** The files a compiler output locates errors in, or undefined when it names none: a script that prints something else. */
function typeErrorFiles(output, root) {
  const located = [...output.matchAll(/^(.+?)[(:]\d+[,:]\d+\)?:? (?:- )?error TS\d+/gm)].map((match) => path.resolve(root, match[1].trim()));
  return located.length ? located : undefined;
}

function shown(command) {
  const words = [path.basename(command[0]), ...command.slice(1, 4)];
  return words.join(" ") + (command.length > 4 ? " …" : "");
}

/**
 * Judges a stop. Returns the text that sends the agent back, or undefined when
 * it may go. Only a gated agent of a workflow session is looked at.
 */
export function gateStop(payload, env = process.env, now = Date.now()) {
  if (payload?.hook_event_name !== "SubagentStop" || !GATED.includes(payload.agent_type) || !payload.agent_id) return undefined;
  const tasks = taskDirectory(payload.cwd);
  if (!inWorkflow(env, tasks)) return undefined;
  const directory = stateDirectory(payload, env);
  const agentId = payload.agent_id;
  const sentBack = agentFile(directory, agentId, "sent-back");
  const release = () => {
    for (const extension of ["files", "active", "sent-back"]) rmSync(agentFile(directory, agentId, extension), { force: true });
  };
  if (gateDisabled(env)) { release(); return undefined; }

  // Kept here as well as read from the event: Claude Code documents `stop_hook_active`
  // for the session's own stop only, and a gate that forgot it had already sent
  // this agent back would hold it for ever.
  const retry = Boolean(payload.stop_hook_active) || existsSync(sentBack);
  const top = repositoryRoot(payload.cwd || ".");
  const files = top ? editedFiles(directory, agentId).filter((file) => file.startsWith(top + path.sep) && !file.startsWith(path.join(top, ".claude") + path.sep)) : [];
  // The files say which task a line is about to a reader that only knows the plan's file scopes.
  const scope = files.slice(0, 20).map((file) => path.relative(top, file));
  const record = (entry) => {
    if (!tasks) return;
    appendFileSync(path.join(tasks, LEDGER), `${JSON.stringify({ at: new Date().toISOString(), agent: payload.agent_type, agentId, retry, ...entry, files: scope })}\n`);
  };
  if (!files.length) {
    // Written so an agent that edited nothing reads as that, and not as a gate that never ran.
    record({ result: "none", step: "no edited file recorded" });
    release();
    return undefined;
  }

  const byRoot = new Map();
  for (const file of files) {
    const root = packageRoot(file, top);
    if (root) byRoot.set(root, [...(byRoot.get(root) ?? []), file]);
  }
  if (!byRoot.size) record({ result: "none", step: "no package to check" });

  const peers = peersEditing(directory, agentId, now);
  const stepTimeout = milliseconds(env.IMPL_GATE_STEP_TIMEOUT_MS, 10 * 60_000);
  const deadline = now + milliseconds(env.IMPL_GATE_BUDGET_MS, 20 * 60_000);
  const failures = [];
  for (const [root, touched] of byRoot) {
    const where = path.relative(top, root) || ".";
    const steps = gateSteps(root, top, touched);
    if (!steps.length) record({ root: where, result: "none", step: "no check found" });
    for (const { step, command } of steps) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) { record({ root: where, step, command: shown(command), result: "skipped", detail: "the gate ran out of time" }); continue; }
      const outcome = run(command, root, Math.min(stepTimeout, remaining));
      if (!outcome.ran) { record({ root: where, step, command: shown(command), result: "skipped", detail: outcome.output }); continue; }
      if (outcome.passed) { record({ root: where, step, command: shown(command), result: "pass" }); continue; }
      const elsewhere = step === "type-check" && peers ? typeErrorFiles(outcome.output, root)?.every((file) => !touched.includes(file)) : false;
      if (elsewhere) {
        record({ root: where, step, command: shown(command), result: "inconclusive", detail: "type errors outside the files this agent edited, while another agent was editing" });
        continue;
      }
      record({ root: where, step, command: shown(command), result: "fail" });
      failures.push(`${step} failed in ${where}\n$ ${shown(command)}\n${tail(outcome.output)}`);
      // The later checks of this package would mostly repeat the same breakage.
      break;
    }
  }

  if (failures.length && !retry) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(sentBack, "");
    return [
      "implementation-harness stop gate. These are the results of your own checks, which the harness ran again on the files you edited. Act on them as on a command you ran yourself.",
      ...failures,
      "Fix what your change caused, run the check again, then finish. A failure that is already there on the base branch, or that comes from a file outside your scope, is not yours to fix: name it in your report as non conclusive, with the path, and finish.",
    ].join("\n\n");
  }
  release();
  return undefined;
}
