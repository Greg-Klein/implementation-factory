import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const NAMESPACE = "implementation-harness";
const AGENTS = ["ticket-planner", "developer", "senior-reviewer", "designer-reviewer", "qa-reviewer", "review-orchestrator", "ticket-scheduler"];
const REVIEWERS = ["senior-reviewer", "designer-reviewer", "qa-reviewer", "review-orchestrator"];
const PUBLISHING = /\bgit\b[^|;&\n]*\bcommit\b|\bglab\s+(?:mr|issue)\s+(?:create|update|note)\b/;
const SESSION_TRACE = /co-authored-by:|claude-session:|claude\.ai\/code\/session_|generated with \[claude code\]/i;

/** The task directory of the workflow, from the session's directory or one of its parents. */
function taskDirectory(cwd) {
  let directory = path.resolve(cwd || ".");
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(directory, ".claude", "tasks");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

/**
 * The guard only speaks inside a run of the workflow: the plugin's hooks fire in
 * every session that loads it, and an agent named `developer` or a commit trailer
 * is nobody's business there.
 */
function inWorkflow(env, tasks) {
  return Boolean(env.IMPL_RUN_ID) || Boolean(tasks && existsSync(path.join(tasks, "workflow-state.json")));
}

/** Plan tasks no developer reported on and the merged report does not name. */
function unreportedTasks(tasks) {
  let plan;
  try { plan = JSON.parse(readFileSync(path.join(tasks, "planner-output.json"), "utf8")); } catch { return []; }
  const ids = Array.isArray(plan?.tasks) ? plan.tasks.map((task) => task?.id).filter((id) => typeof id === "string" && id) : [];
  let merged = "";
  try { merged = readFileSync(path.join(tasks, "developer-report.md"), "utf8"); } catch { /* no merged report yet */ }
  return ids.filter((id) => {
    if (existsSync(path.join(tasks, `developer-report-${id}.md`))) return false;
    return !new RegExp(`(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(merged);
  });
}

/** The reason a tool call is refused, or undefined when it may go. */
export function guardDecision(payload, env = process.env) {
  if (payload?.hook_event_name !== "PreToolUse") return undefined;
  const tasks = taskDirectory(payload.cwd);
  if (!inWorkflow(env, tasks)) return undefined;
  const input = payload.tool_input ?? {};

  if (payload.tool_name === "Agent" || payload.tool_name === "Task") {
    const type = typeof input.subagent_type === "string" ? input.subagent_type : "";
    if (AGENTS.includes(type)) {
      return `Invoke \`${NAMESPACE}:${type}\`, not the bare name \`${type}\`: an agent of the same name installed beside this plugin wins the dispatch and the run gets another output contract.`;
    }
    const agent = type.startsWith(`${NAMESPACE}:`) ? type.slice(NAMESPACE.length + 1) : "";
    if (tasks && REVIEWERS.includes(agent)) {
      const missing = unreportedTasks(tasks);
      if (missing.length) {
        return `The review cannot start: ${missing.join(", ")} of planner-output.json ${missing.length > 1 ? "have" : "has"} no developer-report-<id>.md. Run each one now with ${NAMESPACE}:developer, or name it in developer-report.md with what covers it instead and why.`;
      }
    }
    return undefined;
  }

  if (payload.tool_name === "Bash") {
    const command = typeof input.command === "string" ? input.command : "";
    if (PUBLISHING.test(command) && SESSION_TRACE.test(command)) {
      return "Nothing this run publishes carries a trace of the session: remove the Co-Authored-By or Claude-Session trailer, the claude.ai/code/session_ link and the \"Generated with\" line, then run the command again.";
    }
  }
  return undefined;
}

export function denial(reason) {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
}
