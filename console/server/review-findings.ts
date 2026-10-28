import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { storageRoot } from "./config.js";
import type { Language } from "../lib/i18n/index.js";
import { type KeptFinding, findingCategoryLabel, REVIEW_GUIDE_FILE, guideIgnoresFile, mergeReviewFindings, readReviewFindings, RECURRING_FINDINGS_FILE, recurringFindings, renderRecurringFindings, reviewFindingsStore, reviewGuideIgnoredPaths, sourceRepository, suppressRecurring } from "./domain.js";
import { engine } from "./engine/index.js";
import { forgetFindingFixes, readFindingFixViews, settledFindingCategories, syncFindingFixes } from "./finding-fixes.js";
import type { RunSession } from "./run-session.js";
import { broadcast, isMissingFile, now, reportFailure } from "./context.js";
import { queueWrite, setAsideUnreadable, writeJsonAtomic } from "./json-store.js";

const MAX_FINDINGS_BYTES = 256_000;

/** Two runs of one repository may finish their review together: their writes to its file go one after the other. */
const writes = new Map<string, Promise<unknown>>();

async function keptFindings(stored: string): Promise<KeptFinding[]> {
  try {
    const parsed = JSON.parse(await readFile(stored, "utf8")) as { findings?: KeptFinding[] };
    return Array.isArray(parsed.findings) ? parsed.findings.filter((finding) => finding && typeof finding.at === "string" && typeof finding.category === "string") : [];
  } catch (error) {
    // Only a missing file means no finding was kept. One that cannot be read is kept
    // aside: the next write would replace the history of the repository with one run's findings.
    if (!isMissingFile(error)) await setAsideUnreadable(stored, "review findings", error);
    return [];
  }
}

/**
 * Keeps what the senior reviewer of a run found, for the next runs of that
 * repository. Called every time the file is written: a later round adds its
 * findings to those of the earlier ones.
 */
export async function keepReviewFindings(session: RunSession, source: string) {
  const size = await stat(source).then((file) => file.size, () => 0);
  if (!size || size > MAX_FINDINGS_BYTES) return;
  const incoming = readReviewFindings(await readFile(source, "utf8").catch(() => ""));
  if (!incoming) {
    session.activity("attention", session.texts.serverRun.findingsNotKept, session.texts.serverRun.findingsContract);
    return;
  }
  // The review confidence of this run reads them too, whatever the store then keeps.
  for (const finding of incoming) session.seniorFindings.set(finding.id, { id: finding.id, severity: finding.severity, fixed: finding.fixed });
  if (!incoming.length) return;
  const patterns = await ignoredPatterns(session.state.cwd);
  // Left out before the merge, so they never take the place of a finding the store keeps.
  const counted = incoming.filter((finding) => !guideIgnoresFile(finding.file, patterns));
  const dropped = incoming.length - counted.length;
  const ignoredIds = new Set(incoming.filter((finding) => !counted.includes(finding)).map((finding) => finding.id));
  const repository = sourceRepository(session.state);
  const stored = reviewFindingsStore(storageRoot, repository);
  let merged: KeptFinding[];
  try {
    merged = await queueWrite(writes, stored, async () => {
      // An earlier round of this run may have kept a finding this round now reports under an ignored path.
      const findings = mergeReviewFindings(await keptFindings(stored), counted, { runId: session.id, ticket: session.state.issueUrl }, Date.now())
        .filter((finding) => !(finding.runId === session.id && ignoredIds.has(finding.id)));
      await writeJsonAtomic(stored, { version: 1, findings });
      return findings;
    });
  } catch (error) {
    session.activity("attention", session.texts.serverRun.findingsNotKept, error instanceof Error ? error.message : String(error));
    return;
  }
  if (dropped) session.activity("artifact", session.texts.serverRun.findingsGuideExcluded, session.texts.serverRun.findingsGuideExcludedDetail(dropped));
  if (counted.length) session.activity("artifact", session.texts.serverRun.findingsKept, session.texts.serverRun.findingsKeptDetail(counted.length));
  try {
    const proposed = await syncFindingFixes(repository, merged);
    if (proposed.length) {
      const detail = session.texts.serverRun.sourceFixProposedDetail(proposed.map((proposal) => proposal.category));
      session.activity("system", session.texts.serverRun.sourceFixProposed, detail);
      broadcast({ type: "notice", level: "info", title: session.texts.serverRun.sourceFixProposed, detail: `${path.basename(repository)}: ${detail}`, at: now() });
    }
  } catch (error) {
    session.activity("attention", session.texts.serverRun.sourceFixNotProposed, error instanceof Error ? error.message : String(error));
  }
}

/** Patterns from the guide copied into this run, or none when the repository has no guide. A guide that cannot be read excludes nothing. */
async function ignoredPatterns(worktree: string) {
  const file = path.join(engine.taskDirectory(worktree), REVIEW_GUIDE_FILE);
  try {
    return reviewGuideIgnoredPaths(await readFile(file, "utf8"));
  } catch (error) {
    if (!isMissingFile(error)) reportFailure("Review guide not read", worktree)(error);
    return [];
  }
}

/**
 * Hands a new run the kinds of defect the reviews of its repository keep
 * finding, as a file its developers read before they write code. The file is
 * dated like the latest finding it quotes, older than the run, so the artifact
 * watcher does not take it for a document this run wrote. Returns how many
 * kinds it lists.
 */
export async function seedRecurringFindings(repository: string, worktree: string, now = Date.now()) {
  const settled = await settledFindingCategories(repository, worktree);
  const recurring = suppressRecurring(recurringFindings(await keptFindings(reviewFindingsStore(storageRoot, repository)), now), settled);
  if (!recurring.length) return 0;
  const target = path.join(engine.taskDirectory(worktree), RECURRING_FINDINGS_FILE);
  const latest = new Date(Math.max(...recurring.flatMap((group) => group.examples.map((finding) => Date.parse(finding.at)))));
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, renderRecurringFindings(recurring));
    await utimes(target, latest, latest);
    return recurring.length;
  } catch {
    return 0;
  }
}

/** What is kept for a repository, for the person who wants to read it: how much, and the kinds its next run will be told about. */
export async function readReviewFindingsSummary(repository: string, language: Language, now = Date.now()) {
  const kept = await keptFindings(reviewFindingsStore(storageRoot, repository));
  return {
    kept: kept.length,
    tickets: new Set(kept.map((finding) => finding.ticket)).size,
    recurring: recurringFindings(kept, now).map(({ examples, ...group }) => ({ ...group, label: findingCategoryLabel(group.category, group.label, language), examples: examples.map(({ severity, file, summary }) => ({ severity, file, summary })) })),
    fixes: await readFindingFixViews(repository),
  };
}

/**
 * Drops the findings kept for a repository, so its next run is told nothing.
 * A run already going keeps the file it was handed. Returns whether there were any.
 */
export async function forgetReviewFindings(repository: string) {
  const stored = reviewFindingsStore(storageRoot, repository);
  const existed = await stat(stored).then((file) => file.isFile(), () => false);
  if (existed) await rm(stored, { force: true });
  await forgetFindingFixes(repository);
  return existed;
}
