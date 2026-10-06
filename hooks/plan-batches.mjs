#!/usr/bin/env node
/**
 * Checks `planner-output.json` against `acceptance-criteria.json` and says in
 * which order its tasks run, and which ones may run together. The pilot used
 * to do both by reading the two files: whether two file scopes intersect is
 * not a matter of judgement, and a criterion no task serves is easy to miss
 * in a long plan.
 *
 * The plan holds when every task names known dependencies and known criteria,
 * its `criteria_revision` is the registry's, and every criterion is served by
 * a task or named in `technical_notes`, which is where the plan says why none
 * serves it. Tasks run together only when their `file_paths` cannot name the
 * same file and neither waits on the other, three at most; a task with no
 * path runs alone, since nothing shows its scope is its own. Two tasks that
 * share a file run in the order the plan lists them: the second may build on
 * what the first wrote there.
 *
 * CLI: run from the repository of the run, prints `{ ok, problems, notes,
 * batches, sequential }` and exits 1 when `ok` is false.
 */
import path from "node:path";
import { isMain, isRecord, mentions, readJson, readPlan, runOnTasks, sharedPaths } from "./task-files.mjs";

const BATCH_LIMIT = 3;

/** The registry's revision and criterion ids, or the reason they cannot be read. */
function readRegistry(tasks) {
  const read = readJson(path.join(tasks, "acceptance-criteria.json"));
  if (read.missing) return { problem: "acceptance-criteria.json is missing: the registry is written before the plan" };
  if (read.error) return { problem: `acceptance-criteria.json cannot be read: ${read.error}` };
  if (!isRecord(read.value) || !Array.isArray(read.value.criteria)) return { problem: "acceptance-criteria.json has no `criteria` list" };
  const ids = read.value.criteria.map((criterion) => (isRecord(criterion) && typeof criterion.id === "string" ? criterion.id : "")).filter(Boolean);
  return { revision: read.value.revision, ids };
}

export function criteriaProblems(plan, registry) {
  const problems = [];
  const notes = [];
  if (plan.revision === undefined) problems.push("planner-output.json has no `criteria_revision`");
  else if (plan.revision !== registry.revision) problems.push(`the plan was written for revision ${plan.revision} of the criteria, the registry is at revision ${registry.revision}`);
  for (const task of plan.tasks) {
    const unknown = task.criterionIds.filter((id) => !registry.ids.includes(id));
    if (unknown.length) problems.push(`${task.id} cites ${unknown.join(", ")}, which the registry does not hold`);
  }
  for (const id of registry.ids) {
    if (plan.tasks.some((task) => task.criterionIds.includes(id))) continue;
    if (plan.technicalNotes.some((note) => mentions(id, note))) notes.push(`${id} is served by no task and named in technical_notes`);
    else problems.push(`${id} is served by no task and technical_notes does not say why`);
  }
  return { problems, notes };
}

/** The batches in running order, and for each pair kept apart by its files, the paths that did it. */
export function planBatches(tasks) {
  const problems = [];
  const ids = new Set(tasks.map((task) => task.id));
  for (const task of tasks) {
    const unknown = task.dependencies.filter((id) => !ids.has(id));
    if (unknown.length) problems.push(`${task.id} depends on ${unknown.join(", ")}, which the plan does not hold`);
  }
  if (problems.length) return { problems, batches: [], sequential: [] };

  const sequential = [];
  for (const [index, task] of tasks.entries()) {
    for (const other of tasks.slice(index + 1)) {
      const paths = sharedPaths(task.filePaths, other.filePaths);
      if (paths.length) sequential.push({ tasks: [task.id, other.id], paths });
    }
  }
  const batches = [];
  const done = new Set();
  let waiting = [...tasks];
  while (waiting.length) {
    const free = waiting.filter((task) => task.dependencies.every((id) => done.has(id)));
    if (!free.length) return { problems: [`${waiting.map((task) => task.id).join(", ")} wait on each other: the dependencies form a loop`], batches: [], sequential: [] };
    const inOrder = free.filter((task) => waiting.slice(0, waiting.indexOf(task)).every((earlier) => !sharedPaths(task.filePaths, earlier.filePaths).length));
    // A dependency that points back at an earlier task of the same file leaves nothing in order: the dependency wins.
    const ready = inOrder.length ? inOrder : free;
    const batch = [ready[0]];
    for (const task of ready.slice(1)) {
      if (batch.length >= BATCH_LIMIT) break;
      const alone = !task.filePaths.length || !batch[0].filePaths.length;
      if (!alone && batch.every((member) => !sharedPaths(task.filePaths, member.filePaths).length)) batch.push(task);
    }
    batches.push(batch.map((task) => task.id));
    for (const task of batch) done.add(task.id);
    waiting = waiting.filter((task) => !done.has(task.id));
  }
  return { problems, batches, sequential };
}

export function checkPlan(tasks) {
  const { plan, problems } = readPlan(tasks);
  if (!plan) return { ok: false, problems, notes: [], batches: [], sequential: [] };
  const notes = plan.tasks.filter((task) => !task.filePaths.length).map((task) => `${task.id} names no file_paths and runs alone`);
  if (!plan.tasks.length) problems.push("planner-output.json holds no task");
  const registry = readRegistry(tasks);
  if (registry.problem) problems.push(registry.problem);
  else {
    const criteria = criteriaProblems(plan, registry);
    problems.push(...criteria.problems);
    notes.push(...criteria.notes);
  }
  const order = planBatches(plan.tasks);
  problems.push(...order.problems);
  return { ok: !problems.length, problems, notes, batches: order.batches, sequential: order.sequential };
}

if (isMain(import.meta.url)) runOnTasks("plan-batches", checkPlan);
