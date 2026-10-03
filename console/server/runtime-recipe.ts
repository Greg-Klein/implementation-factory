import { copyFile, mkdir, rename, stat, utimes } from "node:fs/promises";
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
    if (size) session.activity("attention", "Recette d'exécution non conservée", `Le fichier dépasse ${MAX_RECIPE_BYTES / 1000} ko.`);
    return;
  }
  const stored = runtimeRecipeStore(storageRoot, sourceRepository(session.state));
  try {
    await mkdir(path.dirname(stored), { recursive: true });
    await copyFile(source, `${stored}.tmp`);
    await rename(`${stored}.tmp`, stored);
    session.activity("artifact", "Recette d'exécution conservée", "Reprise au prochain run de ce dépôt.");
  } catch (error) {
    session.activity("attention", "Recette d'exécution non conservée", error instanceof Error ? error.message : String(error));
  }
}
