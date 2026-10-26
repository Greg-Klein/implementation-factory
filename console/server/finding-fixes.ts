import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { findingFixRuns, storageRoot, workflowLanguage } from "./config.js";
import {
  type FindingFixDraft, type KeptFinding, type StoredFindingFix,
  appendFindingFix, draftFindingFix, findingFixMarker, findingFixSettled, findingFixStore,
  lintStack, mergeFindingFixes, pathIsRunWorktree, readFindingFixes, sourceFixGroups,
} from "./domain.js";
import { isMissingFile, reportFailure } from "./context.js";

const exec = promisify(execFile);

/** Files a proposal chooses from. Anything else in the repository is not a place a fix is written. */
const CANDIDATE_FILES = [
  "REVIEW.md", ".claude/REVIEW.md", "docs/REVIEW.md", "AGENTS.md", "CLAUDE.md", "package.json",
  "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts",
  ".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs",
  "biome.json", "biome.jsonc",
];

const writes = new Map<string, Promise<unknown>>();

function enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
  const run = (writes.get(key) ?? Promise.resolve()).then(work, work);
  writes.set(key, run.then(() => undefined, () => undefined));
  return run;
}

async function repositoryFiles(repository: string) {
  const existing: string[] = [];
  let packageJson: string | undefined;
  for (const relative of CANDIDATE_FILES) {
    const full = path.join(repository, relative);
    const isFile = await stat(full).then((file) => file.isFile(), (error: unknown) => {
      if (!isMissingFile(error)) reportFailure("Repository file not read", full)(error);
      return false;
    });
    if (!isFile) continue;
    existing.push(relative);
    if (relative !== "package.json") continue;
    packageJson = await readFile(full, "utf8").catch((error: unknown) => {
      reportFailure("Package manifest not read", full)(error);
      return undefined;
    });
  }
  return { existing, packageJson };
}

async function readStore(stored: string): Promise<StoredFindingFix[]> {
  try {
    const parsed = readFindingFixes(await readFile(stored, "utf8"));
    if (parsed) return parsed;
    await rename(stored, `${stored}.unreadable-${Date.now()}`).catch(reportFailure("Unreadable source fixes not kept aside", stored));
    reportFailure("Source fixes unreadable, started empty", stored)(new Error("finding-fixes.json does not follow its contract."));
    return [];
  } catch (error) {
    if (!isMissingFile(error)) {
      await rename(stored, `${stored}.unreadable-${Date.now()}`).catch(reportFailure("Unreadable source fixes not kept aside", stored));
      reportFailure("Source fixes unreadable, started empty", stored)(error);
    }
    return [];
  }
}

async function writeStore(stored: string, proposals: StoredFindingFix[]) {
  await mkdir(path.dirname(stored), { recursive: true });
  const temporary = `${stored}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: 1, proposals }, null, 1));
  await rename(temporary, stored);
}

/** The text of a file on HEAD, or nothing when git cannot show it. A missing path is the usual case, not a failure. */
async function committedText(repository: string, relativePath: string) {
  try {
    const { stdout } = await exec("git", ["show", `HEAD:${relativePath}`], { cwd: repository, timeout: 10_000, maxBuffer: 512_000 });
    return stdout;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
    if (code === 128 || code === "ENOENT") return undefined;
    reportFailure("Source fix not read from the branch", repository)(error);
    return undefined;
  }
}

/** Categories whose accepted block is on the branch a new run is cut from. */
export async function settledFindingCategories(repository: string) {
  const proposals = await readStore(findingFixStore(storageRoot, repository));
  const settled = new Set<string>();
  for (const proposal of proposals) {
    if (proposal.status !== "accepted") continue;
    const text = await committedText(repository, proposal.targetFile);
    if (findingFixSettled(text, proposal.category)) settled.add(proposal.category);
  }
  return settled;
}

export type FindingFixView = {
  category: string;
  label: string;
  runs: number;
  findings: number;
  kind: StoredFindingFix["kind"];
  tool?: StoredFindingFix["tool"];
  rules?: string[];
  targetFile: string;
  title: string;
  body: string;
  status: StoredFindingFix["status"];
  settled: boolean;
  examples: StoredFindingFix["examples"];
};

/** What the recipe window and `impl findings` show. `settled` is read from the branch, not stored. */
export async function readFindingFixViews(repository: string): Promise<FindingFixView[]> {
  const proposals = await readStore(findingFixStore(storageRoot, repository));
  const views: FindingFixView[] = [];
  for (const proposal of proposals) {
    const text = proposal.status === "accepted" ? await committedText(repository, proposal.targetFile) : undefined;
    views.push({
      category: proposal.category, label: proposal.label, runs: proposal.runs, findings: proposal.findings,
      kind: proposal.kind, ...(proposal.tool ? { tool: proposal.tool } : {}), ...(proposal.rules ? { rules: proposal.rules } : {}),
      targetFile: proposal.targetFile, title: proposal.title, body: proposal.body, status: proposal.status,
      settled: proposal.status === "accepted" && findingFixSettled(text, proposal.category),
      examples: proposal.examples,
    });
  }
  return views;
}

/**
 * Proposes a source fix for every category that now spans enough runs, and
 * drops a pending one that no longer does. Returns only the proposals that
 * were not there before this reading. Nothing is written into the repository.
 */
export async function syncFindingFixes(repository: string, kept: KeptFinding[], now = Date.now(), minRuns = findingFixRuns()) {
  const stored = findingFixStore(storageRoot, repository);
  return enqueue(stored, async () => {
    const { existing, packageJson } = await repositoryFiles(repository);
    const drafts: FindingFixDraft[] = sourceFixGroups(kept, now, minRuns).map((group) => draftFindingFix(group, {
      language: workflowLanguage, stack: lintStack(packageJson, existing), existingFiles: existing,
    }));
    const current = await readStore(stored);
    const merged = mergeFindingFixes(current, drafts, new Date(now).toISOString());
    if (JSON.stringify(current) !== JSON.stringify(merged.proposals)) await writeStore(stored, merged.proposals);
    return merged.added;
  });
}

/** The path the store is named after, and the real directory writes must stay inside. */
async function checkoutRoot(repository: string) {
  if (!path.isAbsolute(repository)) throw new Error("Invalid repository path.");
  const resolved = path.resolve(repository);
  if (pathIsRunWorktree(resolved)) throw new Error("A run worktree is not the place a source fix is written. Accept it on the main checkout.");
  const real = await realpath(resolved).catch((error: unknown) => {
    if (isMissingFile(error)) throw new Error("This repository is not a directory.");
    throw error;
  });
  if (pathIsRunWorktree(real)) throw new Error("A run worktree is not the place a source fix is written. Accept it on the main checkout.");
  return { resolved, real };
}

/**
 * Writes the accepted block into the repository file the proposal names.
 * The user reviews the diff and commits it. A second accept does not write
 * the block again. A run worktree is refused.
 */
export async function acceptFindingFix(repository: string, category: string) {
  const { resolved, real } = await checkoutRoot(repository);
  const stored = findingFixStore(storageRoot, resolved);
  return enqueue(stored, async () => {
    const proposals = await readStore(stored);
    const proposal = proposals.find((item) => item.category === category);
    if (!proposal) throw new Error("No source fix is waiting for this category.");
    const target = path.resolve(resolved, proposal.targetFile);
    const relative = path.relative(resolved, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("The fix would be written outside the repository.");
    const existing = await readFile(target, "utf8").catch((error: unknown) => {
      if (isMissingFile(error)) return "";
      throw error;
    });
    const appended = appendFindingFix(existing, proposal.body, category);
    if (appended.applied) {
      await mkdir(path.dirname(target), { recursive: true });
      const parentReal = await realpath(path.dirname(target));
      const confined = path.relative(real, parentReal);
      if (confined.startsWith("..") || path.isAbsolute(confined)) throw new Error("The fix would be written outside the repository.");
      if (!appended.text.includes(findingFixMarker(category))) throw new Error("The source fix has no marker, so it was not written.");
      await writeFile(target, appended.text);
    }
    const decidedAt = new Date().toISOString();
    await writeStore(stored, proposals.map((item) => item.category === category ? { ...item, status: "accepted" as const, decidedAt } : item));
    return {
      outcome: "accepted" as const,
      category,
      targetFile: proposal.targetFile,
      applied: appended.applied,
      message: appended.applied
        ? `Added the ${category} block to ${proposal.targetFile}. Review the diff and commit it. Developers keep hearing about this kind of defect until that change is on the branch new runs start from.`
        : `The ${category} block is already in ${proposal.targetFile}.`,
    };
  });
}

/** Records a no. The category is not proposed again unless the findings of the repository are forgotten. */
export async function dismissFindingFix(repository: string, category: string) {
  const { resolved } = await checkoutRoot(repository);
  const stored = findingFixStore(storageRoot, resolved);
  return enqueue(stored, async () => {
    const proposals = await readStore(stored);
    const proposal = proposals.find((item) => item.category === category);
    if (!proposal) throw new Error("No source fix is waiting for this category.");
    if (proposal.status === "accepted") throw new Error("This source fix was already accepted. Remove the block from the file if it should not stay.");
    const decidedAt = new Date().toISOString();
    await writeStore(stored, proposals.map((item) => item.category === category ? { ...item, status: "dismissed" as const, decidedAt } : item));
    return {
      outcome: "dismissed" as const,
      category,
      targetFile: proposal.targetFile,
      applied: false,
      message: `Dismissed ${category}. It will not be proposed again for this repository.`,
    };
  });
}

/** Drops the proposals of a repository along with its findings. */
export async function forgetFindingFixes(repository: string) {
  const stored = findingFixStore(storageRoot, repository);
  return enqueue(stored, async () => {
    const existed = await stat(stored).then((file) => file.isFile(), () => false);
    if (existed) await rm(stored, { force: true });
    return existed;
  });
}
