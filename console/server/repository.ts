import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { ticketProjectPath, gitRemoteProjects } from "./domain.js";
import type { RepositoryOption } from "./types.js";

/** A checkout nested one level below a search root, such as ~/workspace/client/app. */
const MAX_DEPTH = 2;
const CACHE_TTL_MS = 5_000;

let cache: { at: number; repositories: RepositoryOption[] } | undefined;

export function expandHome(value: string) {
  return value === "~" ? os.homedir() : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

export function findExecutable(name: string) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function searchRoots() {
  return (process.env.IMPL_SEARCH_ROOTS ?? "~/workspace")
    .split(",")
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => path.resolve(expandHome(root)));
}

async function checkoutProjects(directory: string) {
  try {
    return gitRemoteProjects(await readFile(path.join(directory, ".git", "config"), "utf8"));
  } catch {
    return undefined;
  }
}

async function collect(directory: string, depth: number, found: Map<string, RepositoryOption>) {
  const projects = await checkoutProjects(directory);
  if (projects) {
    for (const project of projects) found.set(`${project} ${directory}`, { project, path: directory, resolvedPath: directory, exists: true });
    return;
  }
  if (depth >= MAX_DEPTH) return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => collect(path.join(directory, entry.name), depth + 1, found)));
}

export async function discoverRepositories({ fresh = false }: { fresh?: boolean } = {}): Promise<RepositoryOption[]> {
  // The scan runs again on every keystroke in the project field, so a short
  // cache keeps a deep workspace from being walked over and over. `fresh`
  // walks it anyway, for a caller about to refuse a ticket on a miss.
  if (!fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.repositories;
  const found = new Map<string, RepositoryOption>();
  await Promise.all(searchRoots().map((root) => collect(root, 0, found)));
  const repositories = [...found.values()].sort((left, right) => left.project.localeCompare(right.project));
  cache = { at: Date.now(), repositories };
  return repositories;
}

export async function detectProjectDirectory(issueUrl: string, known?: RepositoryOption[]) {
  const project = ticketProjectPath(issueUrl);
  if (!project) return undefined;
  const match = (known ?? await discoverRepositories()).find((repository) => repository.project === project);
  return match ? { ...match, source: "git" as const } : undefined;
}

export async function resolveProjectDirectory(input: string, issueUrl: string) {
  if (input.trim()) {
    const explicit = path.resolve(expandHome(input.trim()));
    if (!existsSync(explicit)) throw new Error("Le répertoire du projet n'existe pas.");
    return explicit;
  }
  const project = ticketProjectPath(issueUrl);
  if (!project) throw new Error("L'URL du ticket n'est pas reconnue : il faut une issue GitLab ou GitHub.");
  // A checkout cloned a moment ago is not in the cached scan yet: look again before refusing.
  const detected = await detectProjectDirectory(issueUrl) ?? await detectProjectDirectory(issueUrl, await discoverRepositories({ fresh: true }));
  if (detected) return detected.resolvedPath;
  throw new Error(`Aucun checkout trouvé pour ${project}. Renseigne son chemin ou ajoute sa racine à IMPL_SEARCH_ROOTS.`);
}
