import { copyFile, mkdir, readFile, rename, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { storageRoot } from "./config.js";
import { RUNTIME_RECIPE_FILE, runtimeRecipeStore, sourceRepository } from "./domain.js";
import { engine } from "./engine/index.js";
import type { RunSession } from "./run-session.js";

const MAX_RECIPE_BYTES = 64_000;

/**
 * Hands a new run what an earlier run of the same repository learnt about
 * starting and reaching its app. The copy keeps the date of the stored file,
 * older than the run, so the artifact watcher does not take it for a document
 * this run wrote. Returns whether there was one to hand over.
 */
export async function seedRuntimeRecipe(repository: string, worktree: string) {
  const stored = runtimeRecipeStore(storageRoot, repository);
  const written = await stat(stored).catch(() => undefined);
  if (!written?.isFile()) return false;
  const target = path.join(engine.taskDirectory(worktree), RUNTIME_RECIPE_FILE);
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(stored, target);
    await utimes(target, written.atime, written.mtime);
    return true;
  } catch {
    return false;
  }
}

/** Keeps the recipe the workflow wrote or updated, for the next run of that repository. */
export async function keepRuntimeRecipe(session: RunSession, source: string) {
  const size = await stat(source).then((file) => file.size, () => 0);
  if (!size || size > MAX_RECIPE_BYTES) {
    if (size) session.activity("attention", "Runtime recipe not kept", `The file exceeds ${MAX_RECIPE_BYTES / 1000} kB.`);
    return;
  }
  const stored = runtimeRecipeStore(storageRoot, sourceRepository(session.state));
  try {
    await mkdir(path.dirname(stored), { recursive: true });
    await copyFile(source, `${stored}.tmp`);
    await rename(`${stored}.tmp`, stored);
    session.activity("artifact", "Runtime recipe kept", "Reused at the next run of this repository.");
  } catch (error) {
    session.activity("attention", "Runtime recipe not kept", error instanceof Error ? error.message : String(error));
  }
}

/** The recipe kept for a repository and when it was last written, for the person who wants to read it. */
export async function readRuntimeRecipe(repository: string) {
  const stored = runtimeRecipeStore(storageRoot, repository);
  try {
    const [content, written] = await Promise.all([readFile(stored, "utf8"), stat(stored)]);
    return { content, updatedAt: written.mtime.toISOString() };
  } catch {
    return undefined;
  }
}

/**
 * Drops the recipe of a repository, so its next run starts from none and
 * writes a new one. A run already going keeps the copy it was handed. Returns
 * whether there was one.
 */
export async function forgetRuntimeRecipe(repository: string) {
  const stored = runtimeRecipeStore(storageRoot, repository);
  const existed = await stat(stored).then((file) => file.isFile(), () => false);
  if (existed) await rm(stored, { force: true });
  return existed;
}
