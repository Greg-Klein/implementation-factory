import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { acceptanceCountsKey, renderAcceptanceSummary } from "./acceptance.js";
import { readSnapshotLog, takeCodeSnapshot } from "./code-snapshot.js";
import { dataRoot, workflowLanguage } from "./config.js";
import { deliveredCodeSettled } from "./domain.js";
import { engine } from "./engine/index.js";
import { acceptanceInputKind, atomicWrite, SUMMARY_FILES, SYNC_ACK_FILE } from "./evidence-archive.js";
import { confidenceAtDelivery, confidenceKey } from "./review-confidence.js";
import { computeConfidence } from "./review-confidence-runtime.js";
import type { RunSession } from "./run-session.js";
import type { AcceptanceView } from "./types.js";
import { reportFailure } from "./context.js";

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
  // A worktree that is gone has no code left to identify: the last snapshot taken in it stands.
  if (session.demo || session.state.worktree?.state === "removed") return;
  for (const entry of await readSnapshotLog(snapshotLogPath(session.id))) archive.rememberSnapshot(entry.id, entry.capturedAt);
  // The archive sync closes the workflow on the code it delivered: a rebase or an edit made after it, outside a reopening, does not make that coverage stale.
  if (deliveredCodeSettled(session.state)) return;
  if (!force && Date.now() - archive.snapshotTakenAt < SNAPSHOT_INTERVAL_MS) return;
  archive.snapshotTakenAt = Date.now();
  const snapshot = await takeCodeSnapshot(session.state.cwd, snapshotExclusions(session.state.cwd));
  await archive.settleSnapshot(snapshot);
}

/**
 * The summary goes into the merge request, so it is written in the workflow
 * language, from a view derived in that language: the interface keeps its own,
 * in English, out of the same evidence.
 */
function workflowSummary(session: RunSession, view: AcceptanceView) {
  return renderAcceptanceSummary(workflowLanguage === "en" ? view : session.evidence.view(workflowLanguage), workflowLanguage, session.state.confidence);
}

async function writeSummary(session: RunSession, view: AcceptanceView) {
  const summary = workflowSummary(session, view);
  const json = `${JSON.stringify(summary.json, null, 2)}\n`;
  if (session.demo) return;
  const runDirectory = path.join(dataRoot, session.id);
  const failed = reportFailure("Acceptance summary not written", session.id);
  await atomicWrite(path.join(runDirectory, "acceptance", SUMMARY_FILES.markdown), summary.markdown).catch(failed);
  await atomicWrite(path.join(runDirectory, "acceptance", SUMMARY_FILES.json), json).catch(failed);
  // Handed back to the workflow, which reads it before the merge request. Only
  // rewritten when it says something new, since the watcher sees every write.
  const taskRoot = engine.taskDirectory(session.state.cwd);
  const previous = await readFile(path.join(taskRoot, SUMMARY_FILES.markdown), "utf8").catch(() => undefined);
  if (previous === summary.markdown) return;
  await atomicWrite(path.join(taskRoot, SUMMARY_FILES.markdown), summary.markdown).catch(failed);
  await atomicWrite(path.join(taskRoot, SUMMARY_FILES.json), json).catch(failed);
}

/**
 * Brings the review confidence of the run up to date with what the console
 * observes now. Returns whether it moved. The note the workflow first ended on
 * is kept apart: a reopening is held against that one, so it never rewrites it.
 */
async function settleConfidence(session: RunSession, forge: boolean) {
  const state = session.state;
  const confidence = await computeConfidence(session, { forge });
  const moved = confidenceKey(confidence) !== confidenceKey(state.confidence);
  if (moved) {
    if (confidence) state.confidence = confidence;
    else delete state.confidence;
  }
  const delivered = confidenceAtDelivery(state, confidence);
  if (delivered === undefined || delivered === state.confidenceAtDelivery) return moved;
  state.confidenceAtDelivery = delivered;
  return true;
}

/**
 * Recomputes the coverage and publishes it when it moved. `snapshot`: identify
 * the code again, which is what turns evidence stale once the code changed.
 * `forge`: see computeConfidence.
 */
export function refreshAcceptance(session: RunSession, { snapshot = false, forge = false }: { snapshot?: boolean; forge?: boolean } = {}): Promise<AcceptanceView> {
  return session.evidence.serialize(async () => {
    await identifyCode(session, snapshot);
    const view = session.evidence.view();
    session.acceptanceView = view;
    const key = session.evidence.hasInputs ? acceptanceCountsKey(view) : session.acceptanceKey;
    const coverageMoved = key !== session.acceptanceKey;
    if (coverageMoved) {
      session.acceptanceKey = key;
      session.state.acceptance = {
        available: view.available, revision: (session.state.acceptance?.revision ?? 0) + 1, updatedAt: view.updatedAt,
        counts: view.counts, diagnostics: view.diagnostics.filter((diagnostic) => diagnostic.level === "error").length,
        ...(view.qa ? { qa: { status: view.qa.status, consistent: view.qa.consistent, unobserved: view.qa.unobserved.length } } : {}),
      };
      session.state.evidenceUpdatedAt = view.updatedAt;
    }
    const confidenceMoved = await settleConfidence(session, forge);
    if (coverageMoved || confidenceMoved) {
      if (session.evidence.hasInputs) await writeSummary(session, view);
      session.publish();
    }
    return view;
  });
}

/**
 * What the confidence reads beside the coverage moved: the workflow's state,
 * the gate log, a finding, the end of the run. The summary the merge request
 * quotes is written again when the note did.
 */
export function refreshConfidence(session: RunSession) {
  return refreshAcceptance(session, { forge: true });
}

/** A document of the task directory changed: archive it if coverage reads it, then recompute. */
export async function ingestAcceptanceInput(session: RunSession, relativePath: string) {
  if (!acceptanceInputKind(relativePath)) return;
  const changed = await session.evidence.serialize(async () => {
    const ingested = await session.evidence.ingest(relativePath);
    const attached = await session.evidence.retryPendingAttachments();
    return ingested || attached;
  });
  if (changed) await refreshAcceptance(session, { snapshot: true, forge: true });
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
    sentence: workflowSummary(session, view).json.sentence,
  };
  await atomicWrite(path.join(taskRoot, SYNC_ACK_FILE), `${JSON.stringify(acknowledgement, null, 2)}\n`);
  // What the removal of the worktree waits for: from here on, nothing it holds is the only copy.
  session.state.archiveSyncedAt = acknowledgement.archivedAt;
  session.activity("artifact", "Evidence archive confirmed", `${acknowledgement.versions} versions kept`);
  session.publish();
}
