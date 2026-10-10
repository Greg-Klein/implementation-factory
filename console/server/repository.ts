import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { ticketProjectPath } from "./domain.js";
import { remoteIdentities, sameProject, ticketProjectIdentity, type ProjectIdentity } from "./project-identity.js";
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
    return remoteIdentities(await readFile(path.join(directory, ".git", "config"), "utf8"));
  } catch {
    return undefined;
  }
}

async function collect(directory: string, depth: number, found: Map<string, RepositoryOption>) {
  const projects = await checkoutProjects(directory);
  if (projects) {
    for (const identity of projects) found.set(`${identity.hostname}/${identity.project} ${directory}`, { project: identity.project, identity, path: directory, resolvedPath: directory, exists: true });
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

export async function matchingRepositories(issueUrl: string, known?: RepositoryOption[]) {
  const identity = ticketProjectIdentity(issueUrl);
  if (!identity) return [];
  // Old UI or persisted rows without an identity never trigger automatic selection.
  return (known ?? await discoverRepositories()).filter((repository) => repository.identity && sameProject(repository.identity, identity));
}

export async function detectProjectDirectory(issueUrl: string, known?: RepositoryOption[]) {
  const matches = await matchingRepositories(issueUrl, known);
  return matches.length === 1 ? { ...matches[0]!, source: "git" as const } : undefined;
}

export async function resolveProjectDirectory(input: string, issueUrl: string) {
  if (input.trim()) {
    const explicit = path.resolve(expandHome(input.trim()));
    if (!existsSync(explicit)) throw new Error("The project directory does not exist.");
    return explicit;
  }
  const project = ticketProjectPath(issueUrl);
  if (!project) throw new Error("The ticket URL is not recognised: it must be a GitLab or GitHub issue.");
  // A checkout cloned a moment ago is not in the cached scan yet: look again before refusing.
  const detected = await detectProjectDirectory(issueUrl) ?? await detectProjectDirectory(issueUrl, await discoverRepositories({ fresh: true }));
  if (detected) return detected.resolvedPath;
  const matches = await matchingRepositories(issueUrl);
  if (matches.length > 1) throw new Error(`Several checkouts match this ticket: ${matches.map((entry) => entry.path).join(", ")}. Choose a repository path explicitly.`);
  throw new Error(`No checkout found for ${project}. Give its path or add its root to IMPL_SEARCH_ROOTS.`);
}

/** The project a checkout pushes to, read from its `origin` remote. */
export async function checkoutProject(directory: string) {
  try {
    const config = await readFile(path.join(directory, ".git", "config"), "utf8");
    return remoteIdentities(config, true)[0] ?? remoteIdentities(config)[0];
  } catch {
    return undefined;
  }
}

/** The checkout of a project path, as a watcher names the repositories of a ticket. */
export async function checkoutOfProject(project: string, scope?: ProjectIdentity) {
  const find = (repositories: RepositoryOption[]) => repositories.filter((repository) => repository.project.toLowerCase() === project.toLowerCase() && (!scope || repository.identity?.hostname === scope.hostname));
  let matches = find(await discoverRepositories());
  if (matches.length === 0) matches = find(await discoverRepositories({ fresh: true }));
  if (matches.length > 1) throw new Error(`Several checkouts match ${project}. Choose a repository path explicitly.`);
  const found = matches[0];
  if (!found) throw new Error(`No checkout found for ${project}. Add its root to IMPL_SEARCH_ROOTS.`);
  return found.resolvedPath;
}
