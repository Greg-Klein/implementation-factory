#!/usr/bin/env node
/**
 * Assembles what the developers wrote under their own suffix into the three
 * files the run is read from: `dev-evidence.json`, `developer-report.md` and
 * `browser-recipe.md`. The pilot, and the review orchestrator after a rework,
 * used to copy them by hand, and an item retyped is an item that can be
 * renumbered, merged with its neighbour or left out.
 *
 * Evidence is merged by immutable id, as `contracts/evidence.md` asks: what
 * the merged file holds stays, an unseen id is appended as written, an item
 * already there is skipped, and an id that comes back with another content is
 * refused and named, never overwritten. What a suffixed file states once at
 * its root for all its items (the method, the code version) is written on
 * each item that does not state its own, since the merged file has one root
 * for every producer. The merged file states the newest
 * criteria revision its sources read; an item read under an older one carries
 * its own `criteriaRevision`, which the console keeps out of the identity of
 * an item, so evidence gathered against an earlier wording is never restated
 * under the current one.
 *
 * A report or a recipe is one section per suffix, between two marker lines.
 * A section is replaced whole by a newer file of the same suffix, the others
 * are left as they are, and so is every line written outside a section, which
 * is where the pilot names a task it decided not to run.
 *
 * CLI: run from the repository of the run, after a batch or a rework stops
 * editing. Prints `{ ok, evidence, report, recipe, notes }`, exits 1 when
 * `ok` is false. Running it twice changes nothing.
 */
import { copyFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { isMain, isRecord, readJson, readPlan, readText, runOnTasks, SECTION, writeWhole } from "./task-files.mjs";

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Key order is not content: two producers may write the same item with its fields in another order. */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** What makes two items the same one. The revision is the file's business, see the header. */
function content(item) {
  const { criteriaRevision: _revision, ...rest } = item;
  return stable(rest);
}

/** The files `<prefix><suffix><extension>` of the task directory, plan tasks first in plan order, then the others. */
function suffixed(tasks, prefix, extension, planOrder) {
  const suffixes = readdirSync(tasks)
    .filter((name) => name.startsWith(prefix) && name.endsWith(extension) && name.length > prefix.length + extension.length)
    .map((name) => name.slice(prefix.length, name.length - extension.length));
  const rank = (suffix) => (planOrder.includes(suffix) ? planOrder.indexOf(suffix) : planOrder.length);
  return suffixes
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "en", { numeric: true }))
    .map((suffix) => ({ suffix, name: `${prefix}${suffix}${extension}` }));
}

/** An item with what its file states at the root for all of them, where the item states nothing itself. */
function withRoot(item, root) {
  const snapshot = isRecord(root.codeSnapshot) ? root.codeSnapshot : {};
  const start = snapshot.atStart ?? root.codeSnapshotId;
  const versioned = item.codeSnapshotId !== undefined || item.codeSnapshotAtEnd !== undefined;
  return {
    ...item,
    ...(item.method === undefined && typeof root.method === "string" ? { method: root.method } : {}),
    ...(!versioned && typeof start === "string" ? { codeSnapshotId: start } : {}),
    ...(!versioned && typeof snapshot.atEnd === "string" ? { codeSnapshotAtEnd: snapshot.atEnd } : {}),
  };
}

/**
 * The items of an evidence file with the revision each one was read under,
 * faulty entries named and left out. A file that states no revision was read
 * under the first, which is how the console counts it.
 */
function evidenceItems(value, name, invalid) {
  if (!isRecord(value) || !Array.isArray(value.items)) { invalid.push({ file: name, reason: "no `items` list" }); return []; }
  const root = positiveInteger(value.criteriaRevision) ?? 1;
  const entries = [];
  value.items.forEach((item, index) => {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) { invalid.push({ file: name, reason: `item ${index + 1} has no id` }); return; }
    entries.push({ item: withRoot(item, value), revision: positiveInteger(item.criteriaRevision) ?? root });
  });
  return entries;
}

function mergeEvidence(tasks, planOrder, notes) {
  const target = path.join(tasks, "dev-evidence.json");
  const invalid = [];
  const conflicts = [];
  const kept = new Map();
  const existing = readJson(target);
  if (!existing.missing) {
    const faults = [];
    const entries = existing.error ? [] : evidenceItems(existing.value, "dev-evidence.json", faults);
    for (const entry of entries) if (!kept.has(entry.item.id)) kept.set(entry.item.id, entry);
    if (existing.error || faults.length) {
      // Unreadable is not absent: a copy is kept aside before the file is written again without what could not be read.
      const aside = `dev-evidence.json.unreadable-${Date.now()}`;
      copyFileSync(target, path.join(tasks, aside));
      notes.push(`dev-evidence.json could not be read whole (${existing.error ?? faults.map((fault) => fault.reason).join(", ")}): kept as ${aside}, and written again from what could be read and the suffixed files`);
    }
  }
  const before = kept.size;
  const sources = suffixed(tasks, "dev-evidence-", ".json", planOrder);
  for (const { name } of sources) {
    const read = readJson(path.join(tasks, name));
    if (read.value === undefined) { invalid.push({ file: name, reason: read.error ?? "removed while it was read" }); continue; }
    for (const entry of evidenceItems(read.value, name, invalid)) {
      const seen = kept.get(entry.item.id);
      if (!seen) kept.set(entry.item.id, entry);
      else if (content(seen.item) !== content(entry.item)) conflicts.push({ id: entry.item.id, file: name });
    }
  }
  const entries = [...kept.values()];
  const summary = { sources: sources.length, items: entries.length, added: entries.length - before, conflicts, invalid, written: false };
  if (!entries.length) return summary;
  const root = Math.max(...entries.map((entry) => entry.revision));
  const items = entries.map(({ item, revision }) => (revision !== root && item.criteriaRevision === undefined ? { ...item, criteriaRevision: revision } : item));
  const merged = { schemaVersion: 2, source: "developer", criteriaRevision: root, items };
  return { ...summary, written: writeWhole(target, `${JSON.stringify(merged, null, 2)}\n`) };
}

function section(suffix, heading, body) {
  return `<!-- section: ${suffix} -->\n# ${heading}\n\n${body.trim()}\n<!-- end section: ${suffix} -->\n`;
}

/** One section per suffixed file in `target`: the same suffix is replaced where it stands, a new one goes to the end. */
function mergeSections(tasks, target, prefix, planOrder, titles, notes) {
  const sources = suffixed(tasks, prefix, ".md", planOrder);
  const file = path.join(tasks, target);
  const existing = readText(file);
  if (existing.error) { notes.push(`${target} cannot be read: ${existing.error}`); return { sections: [], written: false, unreadable: true }; }
  let text = existing.text ?? "";
  const sections = [];
  for (const { suffix, name } of sources) {
    const read = readText(path.join(tasks, name));
    if (read.text === undefined) { notes.push(`${name} cannot be read: ${read.error ?? "removed while it was read"}`); continue; }
    const title = titles.get(suffix);
    const block = section(suffix, title ? `${suffix}: ${title}` : suffix, read.text);
    let replaced = false;
    // A function as replacement: a report may hold `$1` or `$&`, which a string replacement would expand.
    text = text.replace(SECTION, (whole, found) => {
      if (found !== suffix) return whole;
      replaced = true;
      return block;
    });
    if (!replaced) text = `${text && !text.endsWith("\n") ? `${text}\n` : text}${text.trim() ? "\n" : ""}${block}`;
    sections.push(suffix);
  }
  return { sections, written: sections.length ? writeWhole(file, text) : false };
}

export function mergeOutputs(tasks) {
  const notes = [];
  // The plan only gives the order and the titles: its own defects are `plan-batches.mjs`'s to report.
  const { plan } = readPlan(tasks);
  const planOrder = plan ? plan.tasks.map((task) => task.id) : [];
  const titles = new Map(plan ? plan.tasks.map((task) => [task.id, task.title]) : []);
  const evidence = mergeEvidence(tasks, planOrder, notes);
  const report = mergeSections(tasks, "developer-report.md", "developer-report-", planOrder, titles, notes);
  const recipe = mergeSections(tasks, "browser-recipe.md", "browser-recipe-", planOrder, titles, notes);
  const ok = !evidence.conflicts.length && !evidence.invalid.length && !report.unreadable && !recipe.unreadable;
  return { ok, evidence, report, recipe, notes };
}

if (isMain(import.meta.url)) runOnTasks("merge-outputs", mergeOutputs);
