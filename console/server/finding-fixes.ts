import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { findingFixRuns, storageRoot } from "./config.js";
import { currentLanguage, currentTexts } from "./language.js";
import {
  type FindingFixDraft, type KeptFinding, type StoredFindingFix,
  appendFindingFix, draftFindingFix, findingFixMarker, findingFixSettled, findingFixStore,
  LINT_CONFIG_FILES, lintStack, mergeFindingFixes, packageDependencies, pathIsRunWorktree, readFindingFixes, sourceFixGroups,
} from "./domain.js";
import { isMissingFile, reportFailure } from "./context.js";
import { queueWrite, setAsideUnreadable, writeJsonAtomic } from "./json-store.js";

const exec = promisify(execFile);

/** Files a proposal chooses from. Anything else in the repository is not a place a fix is written. */
const CANDIDATE_FILES = [
  "REVIEW.md", ".claude/REVIEW.md", "docs/REVIEW.md", "AGENTS.md", "CLAUDE.md", "package.json",
  "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts",
  ".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs",
  "biome.json", "biome.jsonc",
];

const writes = new Map<string, Promise<unknown>>();

const enqueue = <T>(key: string, work: () => Promise<T>) => queueWrite(writes, key, work);

/** The text of a file of the checkout, or nothing when it is absent. */
async function fileText(full: string) {
  return readFile(full, "utf8").catch((error: unknown) => {
    if (!isMissingFile(error) && (error as { code?: unknown }).code !== "EISDIR") reportFailure("Repository file not read", full)(error);
    return undefined;
  });
}

async function repositoryFiles(repository: string) {
  const texts = await Promise.all(CANDIDATE_FILES.map((relative) => fileText(path.join(repository, relative))));
  const existing = CANDIDATE_FILES.filter((_, index) => texts[index] !== undefined);
  const manifest = texts[CANDIDATE_FILES.indexOf("package.json")];
  const packages = manifest === undefined ? [] : packageDependencies(manifest);
  if (!packages) reportFailure("Package manifest not read", path.join(repository, "package.json"))(new Error("package.json is not JSON."));
  return { existing, packages: packages ?? [] };
}

/**
 * The stored proposals. Only a writer holding the queue of the store passes
 * `setAside`: a reader reports an unreadable store and leaves it where it is.
 */
async function readStore(stored: string, setAside = false): Promise<StoredFindingFix[]> {
  let failure: unknown;
  try {
    const parsed = readFindingFixes(await readFile(stored, "utf8"));
    if (parsed) return parsed;
    failure = new Error("finding-fixes.json does not follow its contract.");
  } catch (error) {
    if (isMissingFile(error)) return [];
    failure = error;
  }
  if (setAside) await setAsideUnreadable(stored, "source fixes", failure);
  else reportFailure("Source fixes unreadable", stored)(failure);
  return [];
}

const writeStore = (stored: string, proposals: StoredFindingFix[]) => writeJsonAtomic(stored, { version: 1, proposals });

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

/** Whether an accepted proposal is settled in the files `read` returns, its target and the linter configs. */
async function settledIn(proposal: StoredFindingFix, read: (relative: string) => Promise<string | undefined>) {
  const [target, ...configs] = await Promise.all([
    read(proposal.targetFile),
    ...(proposal.kind === "lint" ? LINT_CONFIG_FILES.map(read) : []),
  ]);
  return findingFixSettled(proposal, target, configs.filter((text): text is string => text !== undefined));
}

/**
 * Categories whose accepted fix is in the worktree of a new run, which is the
 * commit that run starts from, whatever branch the main checkout is on.
 */
export async function settledFindingCategories(repository: string, worktree: string) {
  const accepted = (await readStore(findingFixStore(storageRoot, repository))).filter((proposal) => proposal.status === "accepted");
  const settled = await Promise.all(accepted.map((proposal) => settledIn(proposal, (relative) => fileText(path.join(worktree, relative)))));
  return new Set(accepted.filter((_, index) => settled[index]).map((proposal) => proposal.category));
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

/** What the recipe window and `impl findings` show. `settled` is read from the branch checked out, not stored. Writes nothing. */
export async function readFindingFixViews(repository: string): Promise<FindingFixView[]> {
  const proposals = await readStore(findingFixStore(storageRoot, repository));
  const settled = await Promise.all(proposals.map((proposal) => proposal.status === "accepted" && settledIn(proposal, (relative) => committedText(repository, relative))));
  return proposals.map((proposal, index) => ({
    category: proposal.category, label: proposal.label, runs: proposal.runs, findings: proposal.findings,
    kind: proposal.kind, ...(proposal.tool ? { tool: proposal.tool } : {}), ...(proposal.rules ? { rules: proposal.rules } : {}),
    targetFile: proposal.targetFile, title: proposal.title, body: proposal.body, status: proposal.status,
    settled: Boolean(settled[index]),
    examples: proposal.examples,
  }));
}

/**
 * Proposes a source fix for every category that now spans enough runs, and
 * drops a pending one that no longer does. Returns only the proposals that
 * were not there before this reading. Nothing is written into the repository.
 */
export async function syncFindingFixes(repository: string, kept: KeptFinding[], now = Date.now(), minRuns = findingFixRuns()) {
  const stored = findingFixStore(storageRoot, repository);
  return enqueue(stored, async () => {
    const { existing, packages } = await repositoryFiles(repository);
    const drafts: FindingFixDraft[] = sourceFixGroups(kept, now, minRuns).map((group) => draftFindingFix(group, {
      language: currentLanguage(), stack: lintStack(packages, existing), existingFiles: existing,
    }));
    const current = await readStore(stored, true);
    const merged = mergeFindingFixes(current, drafts, new Date(now).toISOString());
    if (JSON.stringify(current) !== JSON.stringify(merged.proposals)) await writeStore(stored, merged.proposals);
    return merged.added;
  });
}

/** The path the store is named after, and the real directory writes must stay inside. */
async function checkoutRoot(repository: string) {
  if (!path.isAbsolute(repository)) throw new Error(currentTexts().serverRun.invalidRepositoryPath);
  const resolved = path.resolve(repository);
  if (pathIsRunWorktree(resolved)) throw new Error(currentTexts().serverRun.fixInRunWorktree);
  const real = await realpath(resolved).catch((error: unknown) => {
    if (isMissingFile(error)) throw new Error(currentTexts().serverRun.repositoryNotDirectory);
    throw error;
  });
  if (pathIsRunWorktree(real)) throw new Error(currentTexts().serverRun.fixInRunWorktree);
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
    const proposals = await readStore(stored, true);
    const proposal = proposals.find((item) => item.category === category);
    if (!proposal) throw new Error(currentTexts().serverRun.fixNoneWaiting);
    const target = path.resolve(resolved, proposal.targetFile);
    const relative = path.relative(resolved, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(currentTexts().serverRun.fixOutside);
    // The target itself may be a link: where it really leads must stay inside the checkout, before it is read or written.
    await mkdir(path.dirname(target), { recursive: true });
    const targetReal = await realpath(target).catch(async (error: unknown) => {
      if (!isMissingFile(error)) throw error;
      // A link whose destination is missing would still be followed by the write.
      if (await lstat(target).then(() => true, (missing: unknown) => { if (isMissingFile(missing)) return false; throw missing; })) {
        throw new Error(currentTexts().serverRun.fixLinkMissing);
      }
      return path.join(await realpath(path.dirname(target)), path.basename(target));
    });
    const confined = path.relative(real, targetReal);
    if (!confined || confined.startsWith("..") || path.isAbsolute(confined)) throw new Error(currentTexts().serverRun.fixOutside);
    const existing = await readFile(targetReal, "utf8").catch((error: unknown) => {
      if (isMissingFile(error)) return "";
      throw error;
    });
    const appended = appendFindingFix(existing, proposal.body, category);
    if (appended.applied) {
      if (!appended.text.includes(findingFixMarker(category))) throw new Error(currentTexts().serverRun.fixNoMarker);
      await writeFile(targetReal, appended.text);
    }
    const decidedAt = new Date().toISOString();
    await writeStore(stored, proposals.map((item) => item.category === category ? { ...item, status: "accepted" as const, decidedAt } : item));
    return {
      outcome: "accepted" as const,
      category,
      targetFile: proposal.targetFile,
      applied: appended.applied,
      message: appended.applied
        ? proposal.kind === "lint"
          ? currentTexts().serverRun.fixAcceptedLint(category, proposal.targetFile)
          : currentTexts().serverRun.fixAccepted(category, proposal.targetFile)
        : currentTexts().serverRun.fixAlreadyThere(category, proposal.targetFile),
    };
  });
}

/** Records a no. The category is not proposed again unless the findings of the repository are forgotten. */
export async function dismissFindingFix(repository: string, category: string) {
  const { resolved } = await checkoutRoot(repository);
  const stored = findingFixStore(storageRoot, resolved);
  return enqueue(stored, async () => {
    const proposals = await readStore(stored, true);
    const proposal = proposals.find((item) => item.category === category);
    if (!proposal) throw new Error(currentTexts().serverRun.fixNoneWaiting);
    if (proposal.status === "accepted") throw new Error(currentTexts().serverRun.fixAlreadyAccepted);
    const decidedAt = new Date().toISOString();
    await writeStore(stored, proposals.map((item) => item.category === category ? { ...item, status: "dismissed" as const, decidedAt } : item));
    return {
      outcome: "dismissed" as const,
      category,
      targetFile: proposal.targetFile,
      applied: false,
      message: currentTexts().serverRun.fixDismissed(category),
    };
  });
}

/** Drops the proposals of a repository along with its findings. */
export async function forgetFindingFixes(repository: string) {
  const stored = findingFixStore(storageRoot, repository);
  return enqueue(stored, async () => {
    try {
      await rm(stored);
      return true;
    } catch (error) {
      if (isMissingFile(error)) return false;
      throw error;
    }
  });
}
