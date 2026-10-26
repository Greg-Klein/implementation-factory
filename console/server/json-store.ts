import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { reportFailure } from "./context.js";

/** Runs `work` after every earlier write queued under `key`, whether or not that one failed. */
export function queueWrite<T>(queues: Map<string, Promise<unknown>>, key: string, work: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(work, work);
  queues.set(key, run.then(() => undefined, () => undefined));
  return run;
}

/** Replaces the file in one rename, so a reader never sees half of it. */
export async function writeJsonAtomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(value, null, 1));
  await rename(`${file}.tmp`, file);
}

/**
 * Moves an unreadable store aside, so the next write does not replace what it
 * held with less. Only a writer holding the queue of that store calls it.
 */
export async function setAsideUnreadable(file: string, what: string, error: unknown) {
  await rename(file, `${file}.unreadable-${Date.now()}`).catch(reportFailure(`Unreadable ${what} not kept aside`, file));
  reportFailure(`${what[0]!.toUpperCase()}${what.slice(1)} unreadable, started empty`, file)(error);
}
