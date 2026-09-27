import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeArchivedRun, openIncident } from "./run-incidents.js";
import { RunSession } from "./run-session.js";
import type { RunSummary } from "./types.js";

/**
 * Runs of an earlier process that ended with an open incident, typically a
 * session lost to a crash or a restart. They are read back from their
 * archive so the user can see what happened, and nothing more: no session, no
 * slot, no checkout, no instruction. They never enter the registry, which is
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
        if (!state || !openIncident(state.incidents)) return;
        const session = new RunSession(runId, { ...state, archived: true });
        await session.evidence.restore().catch(() => false);
        session.acceptanceView = session.evidence.hasInputs ? session.evidence.view() : null;
        this.runs.set(runId, session);
      } catch { /* an unreadable archive stays on disk, out of the list */ }
    }));
  }

  get(runId: string | undefined) {
    return runId ? this.runs.get(runId) : undefined;
  }

  list(): RunSummary[] {
    return [...this.runs.values()].map((session) => session.summary()).sort((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? ""));
  }

  /** Once its last incident is closed, a run has nothing left to show here: its archive stays on disk. */
  release(runId: string) {
    const session = this.runs.get(runId);
    if (session && !openIncident(session.state.incidents)) this.runs.delete(runId);
  }
}
