import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { storageRoot } from "./config.js";
import { type KeptFinding, mergeReviewFindings, readReviewFindings, RECURRING_FINDINGS_FILE, recurringFindings, renderRecurringFindings, reviewFindingsStore, sourceRepository } from "./domain.js";
import { engine } from "./engine/index.js";
import type { RunSession } from "./run-session.js";
import { isMissingFile, reportFailure } from "./context.js";

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
    if (!isMissingFile(error)) {
      await rename(stored, `${stored}.unreadable-${Date.now()}`).catch(reportFailure("Unreadable review findings not kept aside", stored));
      reportFailure("Review findings unreadable, started empty", stored)(error);
    }
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
    session.activity("attention", "Review findings not kept", "senior-findings.json does not follow its contract.");
    return;
  }
  if (!incoming.length) return;
  const stored = reviewFindingsStore(storageRoot, sourceRepository(session.state));
  const write = (writes.get(stored) ?? Promise.resolve()).then(async () => {
    const merged = mergeReviewFindings(await keptFindings(stored), incoming, { runId: session.id, ticket: session.state.issueUrl }, Date.now());
    await mkdir(path.dirname(stored), { recursive: true });
    await writeFile(`${stored}.tmp`, JSON.stringify({ version: 1, findings: merged }, null, 1));
    await rename(`${stored}.tmp`, stored);
  });
  writes.set(stored, write.catch(() => undefined));
  try {
    await write;
    session.activity("artifact", "Review findings kept", `${incoming.length} for the next runs of this repository.`);
  } catch (error) {
    session.activity("attention", "Review findings not kept", error instanceof Error ? error.message : String(error));
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
  const recurring = recurringFindings(await keptFindings(reviewFindingsStore(storageRoot, repository)), now);
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
export async function readReviewFindingsSummary(repository: string, now = Date.now()) {
  const kept = await keptFindings(reviewFindingsStore(storageRoot, repository));
  return {
    kept: kept.length,
    tickets: new Set(kept.map((finding) => finding.ticket)).size,
    recurring: recurringFindings(kept, now).map(({ examples, ...group }) => ({ ...group, examples: examples.map(({ severity, file, summary }) => ({ severity, file, summary })) })),
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
  return existed;
}
