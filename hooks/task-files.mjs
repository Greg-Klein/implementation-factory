/**
 * What the workflow's own scripts share when they read `.claude/tasks/`: the
 * plan as data, the comparison of two file scopes, and the way a file is read
 * and written. The pilot calls those scripts for the steps a rule decides
 * (`plan-batches.mjs`, `merge-outputs.mjs`, `roll-call.mjs`) and reads their
 * answer, one JSON object on standard output, instead of doing the step by hand.
 *
 * Everything here reads a file an agent wrote: nothing is trusted to have the
 * shape its contract gives it, and an unreadable file is never an absent one.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** The task directory of the workflow, from the session's directory or one of its parents. */
export function taskDirectory(cwd) {
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

/** `{ text }`, `{ missing: true }` when the file is not there, `{ error }` for anything else. */
export function readText(file) {
  try {
    return { text: readFileSync(file, "utf8") };
  } catch (error) {
    if (error?.code === "ENOENT") return { missing: true };
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** `{ value }`, `{ missing: true }` when the file is not there, `{ error }` when it cannot be read or parsed. */
export function readJson(file) {
  const read = readText(file);
  if (read.text === undefined) return read;
  try {
    return { value: JSON.parse(read.text) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Written whole then renamed, as every file of the task directory is. False when the content was already there. */
export function writeWhole(file, text) {
  if (readText(file).text === text) return false;
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
  return true;
}

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A list of texts, or the single text an agent wrote where the contract asks for a list. */
function strings(value) {
  const entries = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  return entries.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim());
}

/** Whether `text` names `id` as a whole word: `T1` is not named by `T10`. */
export function mentions(id, text) {
  return new RegExp(`(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(text);
}

/** A section of a merged report or recipe: what one suffixed file brought, between its two marker lines. */
export const SECTION = /^<!-- section: (.+?) -->\n[\s\S]*?^<!-- end section: \1 -->\n?/gm;

/** What a merged file holds outside its sections: the lines its owner wrote there, not what an agent reported. */
export function outsideSections(text) {
  return text.replace(SECTION, "");
}

/**
 * The plan of `planner-output.json`, entry by entry: a task without an id is
 * dropped with a line in `problems`, and so is the second task of an id.
 */
export function readPlan(tasks) {
  const read = readJson(path.join(tasks, "planner-output.json"));
  if (read.missing) return { problems: ["planner-output.json is missing"] };
  if (read.error) return { problems: [`planner-output.json cannot be read: ${read.error}`] };
  if (!isRecord(read.value) || !Array.isArray(read.value.tasks)) return { problems: ["planner-output.json has no `tasks` list"] };
  const problems = [];
  const entries = [];
  const seen = new Set();
  read.value.tasks.forEach((task, index) => {
    const id = isRecord(task) && typeof task.id === "string" ? task.id.trim() : "";
    if (!id) { problems.push(`task ${index + 1} of planner-output.json has no id`); return; }
    if (seen.has(id)) { problems.push(`${id} is the id of two tasks`); return; }
    seen.add(id);
    entries.push({
      id,
      title: typeof task.title === "string" ? task.title.trim() : "",
      filePaths: strings(task.file_paths),
      dependencies: strings(task.dependencies),
      criterionIds: strings(task.criterion_ids),
    });
  });
  const revision = Number.isInteger(read.value.criteria_revision) && read.value.criteria_revision > 0 ? read.value.criteria_revision : undefined;
  return { plan: { revision, tasks: entries, technicalNotes: strings(read.value.technical_notes) }, problems };
}

/** A path as two writers of the same file may spell it: no annotation after it, no line range, one case. */
function plain(entry) {
  const bare = entry.replace(/\\/g, "/").replace(/\s+\(.*\)\s*$/, "").replace(/:\d+(-\d+)?$/, "");
  return path.posix.normalize(bare).replace(/^(\.?\/)+/, "").toLowerCase();
}

/**
 * A scope as the plan writes it: the path up to its first wildcard, and
 * whether it had one. A bracket is not one: `app/[locale]/page.tsx` is a file.
 */
function scope(entry) {
  const clean = plain(entry);
  const wildcard = clean.search(/[*?{]/);
  if (wildcard >= 0) return { base: clean.slice(0, wildcard), open: true };
  return { base: clean.replace(/\/+$/, ""), open: false };
}

/**
 * Whether two paths of a plan may name the same file. A directory holds the
 * files under it, and a pattern is compared on what precedes its wildcard,
 * which errs on the side of an overlap: two tasks kept apart for nothing cost
 * minutes, two agents editing one file overwrite each other.
 */
export function pathsOverlap(left, right) {
  const a = scope(left);
  const b = scope(right);
  if (a.open || b.open) return a.base.startsWith(b.base) || b.base.startsWith(a.base);
  return a.base === b.base || a.base.startsWith(`${b.base}/`) || b.base.startsWith(`${a.base}/`);
}

/** Whether `file`, a path an agent edited and never a pattern, falls in a scope of the plan. */
export function fileInScope(file, entry) {
  const name = plain(file);
  const { base, open } = scope(entry);
  return open ? name.startsWith(base) : name === base || name.startsWith(`${base}/`);
}

/** The paths of `left` that may name a file of `right`. */
export function sharedPaths(left, right) {
  return left.filter((entry) => right.some((other) => pathsOverlap(entry, other)));
}

/** Whether the module at `url` is the script node was started on. */
export function isMain(url) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(url);
}

/**
 * Runs one of the scripts on the task directory of the current directory and
 * prints its answer. The exit code is 1 when the answer is not `ok`, so a
 * caller that reads nothing else still sees the step did not hold.
 */
export function runOnTasks(name, step) {
  try {
    const tasks = taskDirectory(process.cwd());
    const result = tasks ? step(tasks) : { ok: false, problems: [`no .claude/tasks directory at or above ${process.cwd()}`] };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${name}: ${error instanceof Error ? error.message : error}\n`);
    process.exit(2);
  }
}
