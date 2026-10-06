import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeArchivedRun, openIncident } from "./run-incidents.js";
import { RunSession } from "./run-session.js";
import type { AcceptanceView, RunState, RunSummary } from "./types.js";
import { isMissingFile, reportFailure } from "./context.js";

/** What keeps a run of an earlier session in the list: an incident nobody closed, or a worktree still on disk. */
function worthShowing(state: RunState) {
  return Boolean(openIncident(state.incidents)) || state.worktree?.state === "kept";
}

/**
 * Runs of an earlier process that ended with an open incident, typically a
 * session lost to a crash or a restart, or that left a worktree on disk. They
 * are read back from their archive so the user can see what happened and
 * remove that worktree, and nothing more: no session, no slot, no instruction. They never enter the registry, which is
 * what keeps them out of the queue and the concurrency ceiling.
 */
export class RunArchive {
  private readonly runs = new Map<string, RunSession>();

  /** One damaged archive is skipped, never allowed to stop the others from loading. */
  async load(runsDirectory: string, live: Set<string> = new Set()) {
    let runIds: string[];
    try { runIds = await readdir(runsDirectory); } catch { return; }
    await Promise.all(runIds.map(async (runId) => {
      if (live.has(runId) || runId.startsWith("demo-")) return;
      try {
        const state = normalizeArchivedRun(JSON.parse(await readFile(path.join(runsDirectory, runId, "run.json"), "utf8")), runId);
        if (!state || !worthShowing(state)) return;
        const session = new RunSession(runId, { ...state, archived: true });
        await session.evidence.restore().catch(() => false);
        session.acceptanceView = session.evidence.hasInputs ? session.evidence.view() : null;
        this.runs.set(runId, session);
      } catch (error) {
        // An unreadable archive stays on disk, out of the list. A directory without a run is not one.
        if (!isMissingFile(error)) reportFailure("Archived run unreadable", runId)(error);
      }
    }));
  }

  /** A run the user closed while its worktree is still on disk: it stays readable, with the removal on offer. */
  adopt(state: RunState, acceptanceView: AcceptanceView | null = null) {
    if (!state.id || !worthShowing(state)) return undefined;
    const session = new RunSession(state.id, { ...state, archived: true, sessionActive: false, pendingQuestion: undefined });
    // Its evidence archive starts empty: the coverage the live run last showed is what it serves until the next start reads the files back.
    session.acceptanceView = acceptanceView;
    this.runs.set(state.id, session);
    return session;
  }

  get(runId: string | undefined) {
    return runId ? this.runs.get(runId) : undefined;
  }

  list(): RunSummary[] {
    return [...this.runs.values()].map((session) => session.summary()).sort((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? ""));
  }

  /** Once its last incident is closed and its worktree gone, a run has nothing left to show here: its archive stays on disk. */
  release(runId: string) {
    const session = this.runs.get(runId);
    if (session && !worthShowing(session.state)) this.runs.delete(runId);
  }
}
