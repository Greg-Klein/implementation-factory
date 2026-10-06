import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** A repository directory with an empty `.claude/tasks`, as a run of the workflow has. */
export function taskFixture(prefix: string) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), prefix));
  const tasks = path.join(cwd, ".claude", "tasks");
  mkdirSync(tasks, { recursive: true });
  const write = (name: string, value: unknown) => writeFileSync(path.join(tasks, name), typeof value === "string" ? value : JSON.stringify(value));
  return { cwd, tasks, write };
}

/** Runs one of the workflow's scripts the way the pilot does: from the repository, reading its JSON answer. */
export function runScript(name: string, cwd: string) {
  const script = path.resolve(process.cwd(), "..", "hooks", name);
  const { stdout, stderr, status } = spawnSync(process.execPath, [script], { cwd, encoding: "utf8" });
  if (!stdout) throw new Error(`${name} printed nothing: ${stderr}`);
  return { status, answer: JSON.parse(stdout) as unknown };
}

export function task(id: string, filePaths: string[], extra: Record<string, unknown> = {}) {
  return { id, title: `Task ${id}`, file_paths: filePaths, dependencies: [], criterion_ids: ["AC1"], ...extra };
}

export const REGISTRY = { schemaVersion: 1, revision: 1, criteria: [{ id: "AC1", text: "one", revision: 1 }] };
