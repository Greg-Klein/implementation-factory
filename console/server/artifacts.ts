import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";
import type { Stats } from "node:fs";
import { artifactWatchRoot, belongsToRun, isEvidenceReport, isPanelEvidence, isRunDocument, phaseForArtifact, plannedTasks, resolveArtifactPath, watchedForArtifacts } from "./domain.js";
import { engine } from "./engine/index.js";
import { demoArtifactContents } from "./demo-data.js";
import { dataRoot } from "./config.js";
import { attachmentArrived, confirmArchiveSync, ingestAcceptanceInput } from "./acceptance-runtime.js";
import { acceptanceInputKind, confinedPath, SYNC_REQUEST_FILE } from "./evidence-archive.js";
import { closeWorkflowIfDone } from "./hooks.js";
import { parseWorkflowState, WORKFLOW_STATE_FILE } from "./workflow-state.js";
import type { RunSession } from "./run-session.js";

const IMAGE_CONTENT_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/** A version kept by the evidence archive: served only when the archive itself wrote that path. */
async function readArchivedEvidence(session: RunSession, archivePath: string) {
  const buffer = await session.evidence.read(archivePath);
  if (!buffer) throw new Error("Document introuvable pour ce run.");
  if (buffer.byteLength > 2_000_000) throw new Error("Ce document dépasse la limite de prévisualisation de 2 Mo.");
  const contentType = IMAGE_CONTENT_TYPES[path.extname(archivePath).toLowerCase()];
  if (contentType) return { path: archivePath, content: buffer.toString("base64"), encoding: "base64" as const, contentType };
  return { path: archivePath, content: buffer.toString("utf8") };
}

export async function readArtifact(session: RunSession, artifactPath: string) {
  if (artifactPath.startsWith("evidence/")) return readArchivedEvidence(session, artifactPath);
  if (!session.state.artifacts.includes(artifactPath)) throw new Error("Document introuvable pour ce run.");
  if (session.demo) {
    const content = demoArtifactContents[artifactPath];
    if (content === undefined) throw new Error("Document de démonstration introuvable.");
    const demoContentType = IMAGE_CONTENT_TYPES[path.extname(artifactPath).toLowerCase()];
    if (demoContentType) return { path: artifactPath, content, encoding: "base64" as const, contentType: demoContentType };
    return { path: artifactPath, content };
  }
  const root = path.resolve(dataRoot, session.id, "artifacts");
  // The lexical check refuses `..`; the real path refuses a symbolic link
  // planted in the archive that points outside it.
  const target = resolveArtifactPath(root, artifactPath) ? await confinedPath(root, artifactPath) : undefined;
  if (!target) throw new Error("Chemin de document invalide.");
  const buffer = await readFile(target);
  if (buffer.byteLength > 2_000_000) throw new Error("Ce document dépasse la limite de prévisualisation de 2 Mo.");
  const contentType = IMAGE_CONTENT_TYPES[path.extname(target).toLowerCase()];
  if (contentType) return { path: artifactPath, content: buffer.toString("base64"), encoding: "base64" as const, contentType };
  return { path: artifactPath, content: buffer.toString("utf8") };
}

/**
 * A screenshot is only ever archived when a proof file names it: widening this
 * to every file under assets/ would pull in every Figma download and debug
 * capture, exactly what isRunDocument's extension filter was written to avoid.
 */
async function archiveEvidenceScreenshots(session: RunSession, evidenceSource: string, taskRoot: string) {
  let items: unknown;
  try { items = JSON.parse(await readFile(evidenceSource, "utf8")).items; } catch { return; }
  if (!Array.isArray(items)) return;
  for (const item of items) {
    const screenshot = (item as { screenshot?: unknown } | null)?.screenshot;
    if (typeof screenshot !== "string" || !screenshot) continue;
    const source = path.resolve(taskRoot, screenshot);
    const relative = path.relative(taskRoot, source);
    // Copied again when it was already: a later round may have replaced the
    // capture under the same name, and this copy is the one the latest report
    // points at. Every earlier version keeps its own in the evidence archive.
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    const target = path.join(dataRoot, session.id, "artifacts", relative);
    await mkdir(path.dirname(target), { recursive: true });
    const copied = await copyFile(source, target).then(() => true, () => false);
    if (copied && !session.state.artifacts.includes(relative)) {
      session.state.artifacts = [...session.state.artifacts, relative];
      session.activity("artifact", "Capture archivée", relative);
    }
  }
}

async function archiveArtifact(session: RunSession, source: string, stats?: Stats) {
  const writtenAt = stats?.mtimeMs ?? await stat(source).then(({ mtimeMs }) => mtimeMs, () => 0);
  if (!belongsToRun(writtenAt, session.state.startedAt)) return;
  const taskRoot = engine.taskDirectory(session.state.cwd);
  const relative = path.relative(taskRoot, source);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return;
  if (!isRunDocument(relative)) { await attachmentArrived(session); return; }
  const target = path.join(dataRoot, session.id, "artifacts", relative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  if (!session.state.artifacts.includes(relative)) {
    session.state.artifacts = [...session.state.artifacts, relative];
    session.activity("artifact", "Nouvel artefact", relative);
  }
  // Every reviewer overwrites its own file on each round, so the list of
  // artifacts is identical from one round to the next and this stamp is the
  // only thing saying the content moved. Taken from the file's own mtime, so a
  // watcher firing twice on one write does not read as a second change.
  if (isPanelEvidence(relative)) session.state.evidenceUpdatedAt = new Date(writtenAt).toISOString();
  if (isEvidenceReport(relative)) await archiveEvidenceScreenshots(session, source, taskRoot);
  if (relative === "planner-output.json") {
    const tasks = plannedTasks(await readFile(source, "utf8").catch(() => ""));
    if (tasks) session.state.planTasks = tasks;
  }
  session.refreshPlanTasks();
  if (acceptanceInputKind(relative)) await ingestAcceptanceInput(session, relative);
  if (relative === SYNC_REQUEST_FILE) await confirmArchiveSync(session, source);
  if (relative === WORKFLOW_STATE_FILE) readWorkflowState(session, await readFile(source, "utf8").catch(() => ""));
  // A document is the output of its step, so its arrival opens the next one.
  const completedPhase = phaseForArtifact(relative);
  if (completedPhase) session.state.phase = Math.max(session.state.phase, completedPhase + 1);
  // A document is progress of the workflow, whatever the terminal shows.
  session.markProgress();
  session.publish();
  session.signal();
}

/**
 * What the workflow says about itself. A malformed or older revision leaves
 * the last valid one in force; a declared end closes the run only once it
 * holds against the deliverable (see closeWorkflowIfDone).
 */
function readWorkflowState(session: RunSession, content: string) {
  const reading = parseWorkflowState(content, new Date().toISOString());
  if ("error" in reading) {
    if (session.workflowDiagnostic !== reading.error) session.activity("attention", "workflow-state.json ignoré", reading.error);
    session.workflowDiagnostic = reading.error;
    return;
  }
  session.workflowDiagnostic = undefined;
  const previous = session.state.workflow;
  if (previous && reading.state.revision < previous.revision) return;
  session.state.workflow = reading.state;
  if (!previous || previous.state !== reading.state.state) session.activity("system", `Workflow : ${reading.state.state}${reading.state.step ? `, étape ${reading.state.step}` : ""}`, reading.state.nextAction?.description);
  closeWorkflowIfDone(session);
}

/**
 * The workflow's own last step cleans this directory, but only when it gets
 * there: a run stopped from the interface or one whose `claude` process
 * crashed never reaches it, and leaves a previous ticket's files for the next
 * run to misread as its own (`ticket-context.md`, `planner-output.json`, a
 * stale `developer-report-*.md`). Every run therefore starts from an empty
 * task directory itself, rather than trusting the previous one to have ended
 * cleanly. Safe with several runs going, because a checkout is held by one run
 * at a time: see runHoldsRepository and the registry that enforces it.
 */
export async function clearTaskDirectory(cwd: string) {
  await rm(engine.taskDirectory(cwd), { recursive: true, force: true });
}

export async function startArtifactWatcher(session: RunSession) {
  await closeArtifactWatcher(session);
  const taskRoot = engine.taskDirectory(session.state.cwd);
  // chokidar stays inert on a path that does not exist yet, and a checkout that
  // has never run the workflow has no task directory to watch.
  await mkdir(taskRoot, { recursive: true });
  // Attached to the parent, never to the task directory itself: the workflow
  // deletes that directory while the run is still going, and a watch on it
  // never fires again once its inode is gone. Everything written afterwards
  // was archived nowhere, and the workflow's own final cleanup then destroyed
  // the only copy.
  const watcher = chokidar.watch(artifactWatchRoot(taskRoot), {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 80 },
    ignored: (candidate) => !watchedForArtifacts(taskRoot, candidate),
  });
  session.artifactWatcher = watcher;
  watcher.on("add", (file, stats) => void archiveArtifact(session, file, stats));
  watcher.on("change", (file, stats) => void archiveArtifact(session, file, stats));
}

export async function closeArtifactWatcher(session: RunSession) {
  await session.artifactWatcher?.close().catch(() => undefined);
  session.artifactWatcher = null;
}
