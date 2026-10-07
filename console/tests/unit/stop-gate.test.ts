import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const emitter = path.resolve(process.cwd(), "..", "hooks", "emit.mjs");
const DEVELOPER = "implementation-harness:developer";
let cwd: string;
let state: string;

/** What the hook printed for one event: the decision that sends the agent back, or undefined when it let the event through. */
function hook(payload: object, env: Record<string, string> = { IMPL_RUN_ID: "run" }) {
  const { IMPL_RUN_ID: _run, IMPL_HARNESS_HOOK_URL: _url, IMPL_STOP_GATE: _gate, ...inherited } = process.env;
  const { stdout } = spawnSync(process.execPath, [emitter], {
    input: JSON.stringify({ session_id: "s1", cwd, ...payload }), encoding: "utf8", env: { ...inherited, IMPL_GATE_STATE_DIR: state, ...env },
  });
  return stdout ? JSON.parse(stdout) as { decision: string; reason: string } : undefined;
}

const start = (agentId: string, agentType = DEVELOPER) => hook({ hook_event_name: "SubagentStart", agent_type: agentType, agent_id: agentId });
const edit = (agentId: string, file: string) => hook({ hook_event_name: "PreToolUse", tool_name: "Edit", agent_id: agentId, tool_input: { file_path: path.join(cwd, file) } });
const stop = (agentId: string, extra: object = {}, env?: Record<string, string>) => hook({ hook_event_name: "SubagentStop", agent_type: DEVELOPER, agent_id: agentId, ...extra }, env);

function ledger() {
  const file = path.join(cwd, ".claude", "tasks", "gate-log.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { agentId: string; step: string; result: string; retry: boolean; root?: string; files: string[]; ms?: number });
}

/** A stand-in for a project binary: it notes its arguments, prints `.<name>-output` and exits with `.<name>-exit`. */
function binary(name: string) {
  const file = path.join(cwd, "node_modules", ".bin", name);
  writeFileSync(file, `#!/bin/sh\necho "$@" >> .${name}-args\ncat .${name}-output 2>/dev/null\nexit $(cat .${name}-exit 2>/dev/null || echo 0)\n`);
  chmodSync(file, 0o755);
}

const fails = (name: string, output: string) => { writeFileSync(path.join(cwd, `.${name}-exit`), "1"); writeFileSync(path.join(cwd, `.${name}-output`), output); };
const passes = (name: string) => { rmSync(path.join(cwd, `.${name}-exit`), { force: true }); rmSync(path.join(cwd, `.${name}-output`), { force: true }); };
const argumentsOf = (name: string) => existsSync(path.join(cwd, `.${name}-args`)) ? readFileSync(path.join(cwd, `.${name}-args`), "utf8").trim().split("\n") : [];

beforeEach(() => {
  cwd = realpathSync(mkdtempSync(path.join(os.tmpdir(), "stop-gate-")));
  state = mkdtempSync(path.join(os.tmpdir(), "stop-gate-state-"));
  spawnSync("git", ["init", "-q"], { cwd });
  mkdirSync(path.join(cwd, ".claude", "tasks"), { recursive: true });
  mkdirSync(path.join(cwd, "node_modules", ".bin"), { recursive: true });
  mkdirSync(path.join(cwd, "src"));
  writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ devDependencies: { typescript: "5", eslint: "9", jest: "29" } }));
  writeFileSync(path.join(cwd, "tsconfig.json"), "{}");
  writeFileSync(path.join(cwd, "eslint.config.js"), "");
  for (const file of ["src/cart.ts", "src/total.ts", "src/other.ts"]) writeFileSync(path.join(cwd, file), "");
  writeFileSync(path.join(cwd, ".gitignore"), "node_modules/\n.*-args\n.*-exit\n.*-output\n");
  for (const name of ["tsc", "eslint", "jest"]) binary(name);
});
afterEach(() => { rmSync(cwd, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true }); });

// Every hook is a Node process of its own, and a test fires up to a dozen.
jest.setTimeout(30_000);

describe("the stop gate", () => {
  it("should let a developer go and record each check when everything passes", () => {
    start("a1");
    edit("a1", "src/cart.ts");
    expect(stop("a1")).toBeUndefined();
    expect(ledger().map(({ step, result, root }) => `${root} ${step}: ${result}`)).toEqual([". type-check: pass", ". lint: pass", ". related tests: pass"]);
    expect(ledger()[0]).toMatchObject({ agent: DEVELOPER, agentId: "a1", files: ["src/cart.ts"], retry: false });
  });

  it("should time each check it ran, the failing one included, and no line that ran nothing", () => {
    start("a1");
    edit("a1", "src/cart.ts");
    fails("eslint", "src/cart.ts: unused variable");
    stop("a1");
    start("a2");
    stop("a2");
    const lines = ledger();
    expect(lines.map(({ step, result }) => `${step}: ${result}`)).toEqual(["type-check: pass", "lint: fail", "no edited file recorded: none"]);
    for (const line of lines.slice(0, 2)) expect(line.ms).toBeGreaterThanOrEqual(0);
    expect(lines[2]).not.toHaveProperty("ms");
  });

  it("should lint and test the files the agent edited, and no other", () => {
    start("a1");
    edit("a1", "src/cart.ts");
    edit("a1", "src/cart.ts");
    edit("a1", "README.md");
    stop("a1");
    expect(argumentsOf("eslint")).toEqual([path.join(cwd, "src/cart.ts")]);
    expect(argumentsOf("jest")).toEqual([`--findRelatedTests --passWithNoTests ${path.join(cwd, "src/cart.ts")}`]);
  });

  it("should check the files an agent changed through the shell, and not those already changed before it started", () => {
    writeFileSync(path.join(cwd, "src/total.ts"), "export const total = 0;\n");
    start("a1");
    writeFileSync(path.join(cwd, "src/cart.ts"), "export const cart = [];\n");
    stop("a1");
    expect(argumentsOf("eslint")).toEqual([path.join(cwd, "src/cart.ts")]);
    expect(ledger()[0]).toMatchObject({ agentId: "a1", step: "type-check", result: "pass", files: ["src/cart.ts"] });
  });

  it("should send back an agent whose shell edit breaks the type-check", () => {
    start("a1");
    writeFileSync(path.join(cwd, "src/cart.ts"), "export const cart: number = 'one';\n");
    fails("tsc", "src/cart.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.");
    expect(stop("a1")?.reason).toContain("error TS2322");
  });

  it("should not take a peer's shell edits for its own when agents of a batch work side by side", () => {
    start("a1");
    start("a2");
    writeFileSync(path.join(cwd, "src/other.ts"), "export const other = 1;\n");
    stop("a2");
    stop("a1");
    expect(ledger().map(({ agentId, step, result }) => `${agentId} ${step}: ${result}`)).toEqual(["a2 no edited file recorded: none", "a1 no edited file recorded: none"]);
    expect(argumentsOf("eslint")).toEqual([]);
  });

  it("should not read the tree when a commit was made while the agent worked", () => {
    spawnSync("git", ["add", "-A"], { cwd });
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base"], { cwd });
    writeFileSync(path.join(cwd, "src/total.ts"), "export const total = 0;\n");
    start("a1");
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "total"], { cwd });
    stop("a1");
    expect(ledger().map(({ step, result }) => `${step}: ${result}`)).toEqual(["no edited file recorded: none"]);
  });

  it("should send the agent back once with the failing output, then let it go and record the failure that remains", () => {
    start("a1");
    edit("a1", "src/cart.ts");
    fails("tsc", "src/cart.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.");
    const first = stop("a1");
    expect(first?.decision).toBe("block");
    expect(first?.reason).toContain("type-check failed in .");
    expect(first?.reason).toContain("error TS2322");
    // The checks after a failing one would repeat the same breakage.
    expect(argumentsOf("eslint")).toEqual([]);

    expect(stop("a1")).toBeUndefined();
    expect(ledger().map(({ step, result, retry }) => ({ step, result, retry }))).toEqual([
      { step: "type-check", result: "fail", retry: false },
      { step: "type-check", result: "fail", retry: true },
    ]);
  });

  it("should record a pass on the second stop when the agent fixed what the gate reported", () => {
    start("a1");
    edit("a1", "src/cart.ts");
    fails("eslint", "src/cart.ts: 'total' is defined but never used");
    expect(stop("a1")?.reason).toContain("lint failed");
    passes("eslint");
    expect(stop("a1", { stop_hook_active: true })).toBeUndefined();
    expect(ledger().filter(({ step }) => step === "lint").map(({ result, retry }) => `${result} ${retry}`)).toEqual(["fail false", "pass true"]);
  });

  it("should judge again an agent that comes back under the same id after a stop that went through", () => {
    start("a1");
    edit("a1", "src/cart.ts");
    fails("jest", "FAIL src/cart.test.ts");
    expect(stop("a1")?.decision).toBe("block");
    expect(stop("a1")).toBeUndefined();
    edit("a1", "src/cart.ts");
    expect(stop("a1")?.decision).toBe("block");
  });

  it("should not hold an agent for type errors outside its files while a peer is editing, and hold it when it works alone", () => {
    start("a1");
    start("a2");
    edit("a1", "src/cart.ts");
    edit("a2", "src/other.ts");
    fails("tsc", "src/other.ts(1,1): error TS1005: ';' expected.");
    expect(stop("a1")).toBeUndefined();
    expect(ledger().map(({ agentId, step, result }) => `${agentId} ${step}: ${result}`)).toEqual(["a1 type-check: inconclusive", "a1 lint: pass", "a1 related tests: pass"]);
    // The last agent of the batch has no peer left: the error in its own file is its own.
    expect(stop("a2")?.reason).toContain("type-check failed");

    // Sent back, the second agent is still at work: it only stops counting as a peer once it is let go.
    expect(stop("a2")).toBeUndefined();
    start("a3");
    edit("a3", "src/total.ts");
    expect(stop("a3")?.reason).toContain("src/other.ts(1,1)");
  });

  it("should hold an agent for a type error in its own file even while a peer is editing", () => {
    start("a1");
    start("a2");
    edit("a1", "src/cart.ts");
    fails("tsc", "src/other.ts(1,1): error TS1005: ';' expected.\nsrc/cart.ts(2,5): error TS2304: Cannot find name 'totl'.");
    expect(stop("a1")?.decision).toBe("block");
  });

  it("should record a check that cannot run as skipped and a package with no check as none, without holding the agent", () => {
    start("a1");
    edit("a1", "src/cart.ts");
    // The compiler is a grandchild here, as it is behind `npm run typecheck`: killing the script alone would leave the gate waiting for it.
    writeFileSync(path.join(cwd, "node_modules", ".bin", "tsc"), "#!/bin/sh\nsleep 30\necho done\n");
    const before = Date.now();
    expect(stop("a1", {}, { IMPL_RUN_ID: "run", IMPL_GATE_STEP_TIMEOUT_MS: "2000" })).toBeUndefined();
    expect(Date.now() - before).toBeLessThan(10_000);
    expect(ledger().map(({ step, result }) => `${step}: ${result}`)).toEqual(["type-check: skipped", "lint: pass", "related tests: pass"]);

    rmSync(path.join(cwd, "node_modules"), { recursive: true });
    rmSync(path.join(cwd, ".claude", "tasks", "gate-log.jsonl"));
    start("a2");
    edit("a2", "src/cart.ts");
    expect(stop("a2")).toBeUndefined();
    expect(ledger().map(({ step, result }) => `${step}: ${result}`)).toEqual(["no check found: none"]);
  });

  it("should run no check for an agent that only edited documentation or pipeline files", () => {
    start("a1");
    edit("a1", "README.md");
    edit("a1", ".gitlab-ci.yml");
    expect(stop("a1")).toBeUndefined();
    expect(ledger().map(({ step, result }) => `${step}: ${result}`)).toEqual(["no file a check reads: none"]);
    expect(argumentsOf("tsc")).toEqual([]);
  });

  it("should still type-check the package when a documentation edit comes with a code edit", () => {
    start("a1");
    edit("a1", "docs/notes.md");
    writeFileSync(path.join(cwd, "src/cart.ts"), "export const cart = [];\n");
    edit("a1", "src/cart.ts");
    stop("a1");
    expect(ledger().map(({ step, result }) => `${step}: ${result}`)).toEqual(["type-check: pass", "lint: pass", "related tests: pass"]);
    expect(ledger()[0].files).toEqual(["docs/notes.md", "src/cart.ts"]);
  });

  it("should say an agent edited nothing rather than stay silent", () => {
    start("a1");
    expect(stop("a1")).toBeUndefined();
    expect(ledger().map(({ step, result }) => `${step}: ${result}`)).toEqual(["no edited file recorded: none"]);
  });

  it("should leave alone the agents that do not edit code, the sessions outside a run, and a run that turned the gate off", () => {
    fails("tsc", "src/cart.ts(3,1): error TS2322");
    edit("a1", "src/cart.ts");
    expect(hook({ hook_event_name: "SubagentStop", agent_type: "implementation-harness:qa-reviewer", agent_id: "a1" })).toBeUndefined();
    expect(hook({ hook_event_name: "SubagentStop", agent_type: "developer", agent_id: "a1" })).toBeUndefined();
    edit("a2", "src/cart.ts");
    expect(stop("a2", {}, {})).toBeUndefined();
    edit("a3", "src/cart.ts");
    expect(stop("a3", {}, { IMPL_RUN_ID: "run", IMPL_STOP_GATE: "off" })).toBeUndefined();
    expect(ledger()).toEqual([]);
    expect(argumentsOf("tsc")).toEqual([]);
  });
});
