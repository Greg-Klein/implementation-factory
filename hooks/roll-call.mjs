#!/usr/bin/env node
/**
 * Closes the implementation step: every task of the plan against the reports
 * that exist, and for each task what the stop gate found on its files. The
 * pilot used to establish both by listing the task directory and reading
 * `gate-log.jsonl` line by line.
 *
 * A plan id is `missing` when no `developer-report-<id>.md` exists and the
 * merged report does not name it outside the sections the reports brought,
 * which is the rule the guard applies before a reviewer may start
 * (`unreportedTasks`). It is `named` when only the merged report speaks of it:
 * the pilot wrote there what covers it instead. A report is `unknown` when its
 * suffix is not a plan id, a plan id with a letter or a dash after it (the
 * fresh suffix a continuation asks for) or a rework label, and the merged
 * report does not say which task it implemented: the ids drifted.
 *
 * Each agent the gate judged has the verdict of its last stop: `pass` when
 * every check that ran passed, `fail` when one failed after the agent had been
 * sent back, `sent_back` when it failed and the agent has not stopped again,
 * `unchecked` when nothing conclusive ran (an inconclusive or skipped check,
 * or no check to run). A file belongs to the last agent that edited it, and a
 * task takes the worst verdict among the agents its `file_paths` belong to,
 * so a peer that passed on its own file never covers a failure next to it.
 * With no line on its files a task is `unchecked`, and the repository-wide
 * gates decide. An agent that failed on files no task claims is listed in
 * `unattributed`: a failure is never dropped for want of a task to pin it on.
 *
 * CLI: run from the repository of the run, once nothing edits any more.
 * Prints `{ ok, missing, named, unknown, gates, unattributed, notes }`. `ok`
 * and the exit code speak for the roll call alone (1 when a task is missing or
 * a report unknown): a gate verdict is acted on, it is not a state the script
 * could see cleared when the failure turns out to be the base's own.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { unreportedTasks } from "./guard.mjs";
import { fileInScope, isMain, isRecord, mentions, outsideSections, readPlan, readText, runOnTasks } from "./task-files.mjs";

const REPORT = /^developer-report-(.+)\.md$/;
const REWORK = /^rework\d+$/;
const SEVERITY = ["pass", "unchecked", "sent_back", "fail"];

/** The lines of the gate's ledger that can be read, and how many could not. */
function gateLines(tasks, notes) {
  const read = readText(path.join(tasks, "gate-log.jsonl"));
  if (read.error) notes.push(`gate-log.jsonl cannot be read: ${read.error}`);
  if (read.text === undefined) return [];
  const lines = [];
  let unreadable = 0;
  for (const raw of read.text.split("\n")) {
    if (!raw.trim()) continue;
    let line;
    try { line = JSON.parse(raw); } catch { unreadable += 1; continue; }
    if (!isRecord(line) || typeof line.agentId !== "string" || typeof line.result !== "string") { unreadable += 1; continue; }
    lines.push({ ...line, files: Array.isArray(line.files) ? line.files.filter((file) => typeof file === "string") : [] });
  }
  if (unreadable) notes.push(`${unreadable} line${unreadable > 1 ? "s" : ""} of gate-log.jsonl could not be read`);
  return lines;
}

/** What the gate found at the last stop of each agent, in the order the agents first appear. */
export function agentVerdicts(lines) {
  const byAgent = new Map();
  for (const line of lines) byAgent.set(line.agentId, [...(byAgent.get(line.agentId) ?? []), line]);
  return [...byAgent].map(([agentId, own]) => {
    // A stop that follows a send-back carries `retry`; the first line without it after one opens the next stop.
    let from = 0;
    own.forEach((line, index) => { if (index > 0 && line.retry !== true && own[index - 1].retry === true) from = index; });
    const stop = own.slice(from);
    const sentBack = stop.some((line) => line.retry === true);
    const last = stop.filter((line) => (line.retry === true) === sentBack);
    const steps = (result) => last.filter((line) => line.result === result).map((line) => ({ step: line.step, ...(line.root ? { root: line.root } : {}), ...(line.command ? { command: line.command } : {}), ...(line.detail ? { detail: line.detail } : {}) }));
    const about = { agent: own[0].agent, agentId };
    const failed = steps("fail");
    if (failed.length) return { ...about, verdict: sentBack ? "fail" : "sent_back", steps: failed };
    const open = [...steps("inconclusive"), ...steps("skipped")];
    if (open.length) return { ...about, verdict: "unchecked", reason: "a check was inconclusive or skipped", steps: open };
    if (!last.some((line) => line.result === "pass")) return { ...about, verdict: "unchecked", reason: "no check ran" };
    return { ...about, verdict: "pass" };
  });
}

export function rollCall(tasks) {
  const { plan, problems } = readPlan(tasks);
  if (!plan) return { ok: false, missing: [], named: [], unknown: [], gates: [], unattributed: [], notes: problems };
  const notes = [...problems];
  const ids = plan.tasks.map((task) => task.id);
  const reported = readdirSync(tasks).map((name) => REPORT.exec(name)?.[1]).filter(Boolean);
  const merged = readText(path.join(tasks, "developer-report.md"));
  if (merged.error) notes.push(`developer-report.md cannot be read: ${merged.error}`);
  const written = outsideSections(merged.text ?? "");
  const missing = unreportedTasks(tasks);
  const named = ids.filter((id) => !reported.includes(id) && !missing.includes(id));
  const expected = (suffix) => REWORK.test(suffix) || ids.some((id) => suffix === id || (suffix.startsWith(id) && /^[^\d]/.test(suffix.slice(id.length))));
  const unknown = reported.filter((suffix) => !expected(suffix) && !mentions(suffix, written)).map((suffix) => `developer-report-${suffix}.md`);

  const lines = gateLines(tasks, notes);
  const verdicts = new Map(agentVerdicts(lines).map((verdict) => [verdict.agentId, verdict]));
  // The ledger is appended to, so the last line naming a file is from the last agent that edited it.
  const owner = new Map();
  for (const line of lines) for (const file of line.files) owner.set(file, line.agentId);
  const claimed = new Set();
  const gates = plan.tasks.filter((task) => !missing.includes(task.id) && !named.includes(task.id)).map((task) => {
    const agents = new Set([...owner].filter(([file]) => task.filePaths.some((scope) => fileInScope(file, scope))).map(([, agentId]) => agentId));
    for (const agentId of agents) claimed.add(agentId);
    if (!agents.size) return { task: task.id, verdict: "unchecked", reason: "no gate line names a file of this task" };
    const worst = [...agents].map((agentId) => verdicts.get(agentId)).sort((a, b) => SEVERITY.indexOf(b.verdict) - SEVERITY.indexOf(a.verdict))[0];
    return { task: task.id, ...worst };
  });
  const unattributed = [...verdicts.values()]
    .filter((verdict) => !claimed.has(verdict.agentId) && (verdict.verdict === "fail" || verdict.verdict === "sent_back"))
    .map((verdict) => ({ ...verdict, files: [...new Set(lines.filter((line) => line.agentId === verdict.agentId).flatMap((line) => line.files))] }));
  return { ok: !missing.length && !unknown.length, missing, named, unknown, gates, unattributed, notes };
}

if (isMain(import.meta.url)) runOnTasks("roll-call", rollCall);
