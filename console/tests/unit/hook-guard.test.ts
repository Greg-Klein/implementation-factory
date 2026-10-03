import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const emitter = path.resolve(process.cwd(), "..", "hooks", "emit.mjs");
let cwd: string;
let tasks: string;

/** The reason the hook refused the call with, or undefined when it let it through. */
function refusal(toolName: string, toolInput: object, env: Record<string, string> = { IMPL_RUN_ID: "run" }) {
  const { IMPL_RUN_ID: _run, IMPL_HARNESS_HOOK_URL: _url, ...inherited } = process.env;
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
    expect(refusal("Agent", { subagent_type: "developer" })).toContain("implementation-harness:developer");
    expect(refusal("Agent", { subagent_type: "implementation-harness:developer" })).toBeUndefined();
    expect(refusal("Agent", { subagent_type: "Explore" })).toBeUndefined();
  });

  it("should refuse a reviewer while a planned task has no report, naming the task", () => {
    writeFileSync(path.join(tasks, "planner-output.json"), JSON.stringify({ tasks: [{ id: "T1" }, { id: "T2" }, { id: "T10" }] }));
    writeFileSync(path.join(tasks, "developer-report-T1.md"), "# Rapport");
    writeFileSync(path.join(tasks, "developer-report-T10.md"), "# Rapport");
    expect(refusal("Agent", { subagent_type: "implementation-harness:qa-reviewer" })).toMatch(/T2 of planner-output\.json has no/);
    expect(refusal("Agent", { subagent_type: "implementation-harness:developer" })).toBeUndefined();
  });

  it("should start the review once every task is reported or named in the merged report", () => {
    writeFileSync(path.join(tasks, "planner-output.json"), JSON.stringify({ tasks: [{ id: "T1" }, { id: "T2" }] }));
    writeFileSync(path.join(tasks, "developer-report-T1.md"), "# Rapport");
    writeFileSync(path.join(tasks, "developer-report.md"), "## T1\n\nFait.\n\n## T2\n\nNon lancée : couverte par T1.\n");
    expect(refusal("Agent", { subagent_type: "implementation-harness:review-orchestrator" })).toBeUndefined();
  });

  it("should not take T1 named in the merged report for T10", () => {
    writeFileSync(path.join(tasks, "planner-output.json"), JSON.stringify({ tasks: [{ id: "T1" }] }));
    writeFileSync(path.join(tasks, "developer-report.md"), "## T10\n");
    expect(refusal("Agent", { subagent_type: "implementation-harness:senior-reviewer" })).toContain("T1 ");
  });

  it("should start the review when the plan cannot be read", () => {
    writeFileSync(path.join(tasks, "planner-output.json"), "{ not json");
    expect(refusal("Agent", { subagent_type: "implementation-harness:senior-reviewer" })).toBeUndefined();
  });

  it("should refuse a commit or a publication that carries a trace of the session", () => {
    expect(refusal("Bash", { command: "git commit -m \"fix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\"" })).toContain("Co-Authored-By");
    expect(refusal("Bash", { command: "git -C /repo commit -m 'fix: x' -m 'Claude-Session: https://claude.ai/code/session_01'" })).toBeDefined();
    expect(refusal("Bash", { command: "glab mr create --description 'https://claude.ai/code/session_01'" })).toBeDefined();
    expect(refusal("Bash", { command: "git commit -m 'fix(cart): keep the total when a line is removed'" })).toBeUndefined();
    expect(refusal("Bash", { command: "git log --grep 'Co-Authored-By:'" })).toBeUndefined();
  });

  it("should say nothing outside a run of the workflow", () => {
    expect(refusal("Agent", { subagent_type: "developer" }, {})).toBeUndefined();
    expect(refusal("Bash", { command: "git commit -m 'x\n\nCo-Authored-By: someone'" }, {})).toBeUndefined();
    writeFileSync(path.join(tasks, "workflow-state.json"), "{}");
    expect(refusal("Agent", { subagent_type: "developer" }, {})).toContain("implementation-harness:developer");
  });
});
