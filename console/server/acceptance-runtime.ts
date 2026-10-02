import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { acceptanceCountsKey, renderAcceptanceSummary } from "./acceptance.js";
import { readSnapshotLog, takeCodeSnapshot } from "./code-snapshot.js";
import { dataRoot } from "./config.js";
import { engine } from "./engine/index.js";
import { acceptanceInputKind, atomicWrite, SUMMARY_FILES, SYNC_ACK_FILE } from "./evidence-archive.js";
import type { RunSession } from "./run-session.js";
import type { AcceptanceView } from "./types.js";

/**
 * Keeps a run's acceptance coverage current: archives what the workflow
 * writes, identifies the code as it stands, recomputes, and hands the result
 * to the interface and back to the workflow as `acceptance-summary.md`.
 */

/** The code is hashed at most this often: every event would otherwise walk the whole working tree. */
const SNAPSHOT_INTERVAL_MS = 15_000;

export function snapshotLogPath(runId: string) {
  return path.join(dataRoot, runId, "snapshots.jsonl");
}

/** The workflow's own documents, relative to the checkout: left out of every code snapshot. */
export function snapshotExclusions(cwd: string) {
  return [path.relative(cwd, engine.taskDirectory(cwd)).split(path.sep).join("/")];
}

async function identifyCode(session: RunSession, force: boolean) {
  const archive = session.evidence;
  if (session.demo) return;
  for (const entry of await readSnapshotLog(snapshotLogPath(session.id))) archive.rememberSnapshot(entry.id, entry.capturedAt);
  if (!force && Date.now() - archive.snapshotTakenAt < SNAPSHOT_INTERVAL_MS) return;
  archive.snapshotTakenAt = Date.now();
  const snapshot = await takeCodeSnapshot(session.state.cwd, snapshotExclusions(session.state.cwd));
  archive.currentSnapshot = snapshot;
  if (snapshot) archive.rememberSnapshot(snapshot.id, snapshot.capturedAt);
}

async function writeSummary(session: RunSession, view: AcceptanceView) {
  const summary = renderAcceptanceSummary(view);
  const json = `${JSON.stringify(summary.json, null, 2)}\n`;
  if (session.demo) return;
  const runDirectory = path.join(dataRoot, session.id);
  await atomicWrite(path.join(runDirectory, "acceptance", SUMMARY_FILES.markdown), summary.markdown).catch(() => undefined);
  await atomicWrite(path.join(runDirectory, "acceptance", SUMMARY_FILES.json), json).catch(() => undefined);
  // Handed back to the workflow, which reads it before the merge request. Only
  // rewritten when it says something new, since the watcher sees every write.
  const taskRoot = engine.taskDirectory(session.state.cwd);
  const previous = await readFile(path.join(taskRoot, SUMMARY_FILES.markdown), "utf8").catch(() => undefined);
  if (previous === summary.markdown) return;
  await atomicWrite(path.join(taskRoot, SUMMARY_FILES.markdown), summary.markdown).catch(() => undefined);
  await atomicWrite(path.join(taskRoot, SUMMARY_FILES.json), json).catch(() => undefined);
}

/**
 * Recomputes the coverage and publishes it when it moved. `snapshot`: identify
 * the code again, which is what turns evidence stale once the code changed.
 */
export function refreshAcceptance(session: RunSession, { snapshot = false }: { snapshot?: boolean } = {}): Promise<AcceptanceView> {
  return session.evidence.serialize(async () => {
    await identifyCode(session, snapshot);
    const view = session.evidence.view();
    session.acceptanceView = view;
    if (!session.evidence.hasInputs) return view;
    const key = acceptanceCountsKey(view);
    if (key !== session.acceptanceKey) {
      session.acceptanceKey = key;
      session.state.acceptance = {
        available: view.available, revision: (session.state.acceptance?.revision ?? 0) + 1, updatedAt: view.updatedAt,
        counts: view.counts, diagnostics: view.diagnostics.filter((diagnostic) => diagnostic.level === "error").length,
        ...(view.qa ? { qa: { status: view.qa.status, consistent: view.qa.consistent, unobserved: view.qa.unobserved.length } } : {}),
      };
      session.state.evidenceUpdatedAt = view.updatedAt;
      await writeSummary(session, view);
      session.publish();
    }
    return view;
  });
}

/** A document of the task directory changed: archive it if coverage reads it, then recompute. */
export async function ingestAcceptanceInput(session: RunSession, relativePath: string) {
  if (!acceptanceInputKind(relativePath)) return;
  const changed = await session.evidence.serialize(async () => {
    const ingested = await session.evidence.ingest(relativePath);
    const attached = await session.evidence.retryPendingAttachments();
    return ingested || attached;
  });
  if (changed) await refreshAcceptance(session, { snapshot: true });
}

/** A capture landed: a report written before it may have been waiting for it. */
export async function attachmentArrived(session: RunSession) {
  if (session.evidence.pendingAttachments().length === 0) return;
  const changed = await session.evidence.serialize(() => session.evidence.retryPendingAttachments());
  if (changed) await refreshAcceptance(session);
}

async function listTaskFiles(root: string, prefix = "", depth = 0): Promise<string[]> {
  if (depth > 2) return [];
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listTaskFiles(root, relative, depth + 1));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

/**
 * The workflow asks before it deletes its task directory: everything coverage
 * reads is archived again, every capture retried, and the answer written back
 * with what was kept. The workflow waits for that answer, so the last reports
 * and captures survive the cleanup.
 */
export async function confirmArchiveSync(session: RunSession, requestPath: string) {
  let requestId: string | undefined;
  try { requestId = (JSON.parse(await readFile(requestPath, "utf8")) as { requestId?: unknown }).requestId as string | undefined; } catch { return; }
  if (typeof requestId !== "string" || !requestId) return;
  const taskRoot = engine.taskDirectory(session.state.cwd);
  for (const file of await listTaskFiles(taskRoot)) await ingestAcceptanceInput(session, file);
  await session.evidence.serialize(() => session.evidence.retryPendingAttachments());
  const view = await refreshAcceptance(session, { snapshot: true });
  await session.persist();
  const acknowledgement = {
    requestId, archivedAt: new Date().toISOString(),
    versions: session.evidence.versions.length,
    pendingAttachments: session.evidence.pendingAttachments(),
    sentence: renderAcceptanceSummary(view).json.sentence,
  };
  await atomicWrite(path.join(taskRoot, SYNC_ACK_FILE), `${JSON.stringify(acknowledgement, null, 2)}\n`);
  session.activity("artifact", "Archive des preuves confirmée", `${acknowledgement.versions} versions conservées`);
  session.publish();
}
