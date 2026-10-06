import { execFile } from "node:child_process";
import { access, appendFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { isMissingFile, now, reportFailure } from "./context.js";
import { dataRoot, pluginRoot } from "./config.js";
import { demoSessionUsage } from "./demo-data.js";
import { diffBases, isRunWorktreePath, sourceRepository } from "./domain.js";
import { engine } from "./engine/index.js";
import { normalizeArchivedRun } from "./run-incidents.js";
import { buildRunMetrics, diffFromNumstat, gateTimes } from "./run-metrics.js";
import type { RunSession } from "./run-session.js";
import { fetchMergeRequestTarget } from "./ticket.js";
import type { HarnessVersion, RunDiff, RunMetrics, RunState } from "./types.js";

const exec = promisify(execFile);

export const METRICS_FILE = "metrics.json";
/** The stop gate's log, as the hook names it in the task directory and as it is kept beside `run.json`. */
export const GATE_LOG_FILE = "gate-log.jsonl";
/** Reading every transcript of a run again is cheap, not free: the live figure moves at most this often. */
const USAGE_REFRESH_MS = 5_000;

/** The harness as it stands when a run starts: what a later comparison between two versions is keyed on. */
export async function harnessVersion(root = pluginRoot): Promise<HarnessVersion> {
  const version = await readFile(path.join(root, "console", "package.json"), "utf8").then((content) => (JSON.parse(content) as { version?: unknown }).version).catch(() => undefined);
  const commit = await exec("git", ["-C", root, "rev-parse", "--short", "HEAD"]).then((result) => result.stdout.trim()).catch(() => undefined);
  return { ...(typeof version === "string" ? { version } : {}), ...(commit ? { commit } : {}) };
}

function usageOf(state: RunState) {
  return engine.sessionUsage({ transcriptPath: state.transcriptPath, cwd: state.cwd, isolated: isRunWorktreePath(sourceRepository(state), state.cwd) });
}

/** What the run changed since the branch it was cut from, committed or not. Undefined once the worktree is gone or when no base can be read. */
async function runDiff(state: RunState): Promise<RunDiff | undefined> {
  const cwd = state.cwd;
  if (!cwd || !await access(cwd).then(() => true, () => false)) return undefined;
  const target = state.mergeRequestUrl ? await fetchMergeRequestTarget(state.mergeRequestUrl, cwd) : undefined;
  for (const base of diffBases(state, target)) {
    try {
      const mergeBase = (await exec("git", ["-C", cwd, "merge-base", base, "HEAD"])).stdout.trim();
      return diffFromNumstat((await exec("git", ["-C", cwd, "diff", "--numstat", mergeBase])).stdout);
    } catch { /* this base is not known here: the next one is tried */ }
  }
  return undefined;
}

/**
 * Keeps the lines of the stop gate's log beside `run.json`. The workflow empties
 * its task directory before it ends and a reopening starts the file again, so
 * the lines not kept yet are added to the copy, which is never rewritten from
 * the source. Queued behind the run's metrics, which read the copy.
 */
export function keepGateLog(session: RunSession, source: string) {
  const next = session.metricsChain.then(async () => {
    const target = path.join(dataRoot, session.id, GATE_LOG_FILE);
    const lines = (content: string) => content.split("\n").filter((line) => line.trim());
    const kept = new Set(lines(await readFile(target, "utf8").catch(() => "")));
    const added = lines(await readFile(source, "utf8").catch(() => "")).filter((line) => !kept.has(line));
    if (added.length === 0) return;
    await mkdir(path.dirname(target), { recursive: true });
    await appendFile(target, `${added.join("\n")}\n`);
  });
  session.metricsChain = next.then(() => undefined, () => undefined);
  return session.metricsChain;
}

async function compute(state: RunState, demo: boolean, previous: RunMetrics | undefined, directory: string, qaStatus?: string): Promise<RunMetrics> {
  const usage = demo ? demoSessionUsage(state) : await usageOf(state).catch(() => []);
  // The worktree goes once the run delivered: the size measured while it was there stays.
  const diff = demo ? undefined : await runDiff(state) ?? previous?.complexity.diff;
  const gate = demo ? undefined : gateTimes(await readFile(path.join(directory, GATE_LOG_FILE), "utf8").catch(() => ""));
  return buildRunMetrics({ state, usage, diff, gate, qaStatus, at: now() });
}

/** The figures of a run as it stands, written beside `run.json` unless the run is simulated. One computation at a time per run. */
export function recordRunMetrics(session: RunSession): Promise<RunMetrics> {
  const next = session.metricsChain.then(async () => {
    const metrics = await compute(session.archivedState(), session.demo, session.metrics ?? undefined, path.join(dataRoot, session.id), session.acceptanceView?.qa?.status);
    session.metrics = metrics;
    applyUsage(session, metrics);
    if (!session.demo) {
      const target = path.join(dataRoot, session.id, METRICS_FILE);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(`${target}.tmp`, JSON.stringify(metrics, null, 2));
      await rename(`${target}.tmp`, target);
    }
    return metrics;
  });
  session.metricsChain = next.then(() => undefined, () => undefined);
  return next;
}

/** Puts the token figures on the run state, which is what the pages read. Returns whether they moved. */
function applyUsage(session: RunSession, metrics: RunMetrics) {
  const tokens = metrics.tokens;
  if (!tokens) return false;
  const usage = { total: tokens.total.total, output: tokens.total.output, pilot: tokens.pilot.total, pilotCalls: tokens.pilot.calls, agents: tokens.agents.length };
  const known = session.state.usage;
  if (known && known.total === usage.total && known.pilotCalls === usage.pilotCalls && known.agents === usage.agents) return false;
  session.state.usage = usage;
  return true;
}

/**
 * Keeps the token count of a live run moving. Asked for on every hook and
 * every line of the dialogue, answered at most once per `USAGE_REFRESH_MS`,
 * with one last reading once the burst is over.
 */
export function refreshUsage(session: RunSession) {
  if (session.disposed || session.usageTimer) return;
  const wait = Math.max(0, session.usageReadAt + USAGE_REFRESH_MS - Date.now());
  session.usageTimer = setTimeout(() => {
    session.usageTimer = null;
    session.usageReadAt = Date.now();
    if (session.disposed) return;
    void session.metricsChain.then(async () => {
      const state = session.archivedState();
      const metrics = buildRunMetrics({ state, usage: session.demo ? demoSessionUsage(state) : await usageOf(state).catch(() => []), diff: session.metrics?.complexity.diff, at: now() });
      if (!session.disposed && applyUsage(session, metrics)) session.publish();
    });
  }, wait);
  session.usageTimer.unref?.();
}

/** Every `metrics.json` on disk, newest run first. A damaged file is skipped. */
export async function storedMetrics(runsDirectory = dataRoot): Promise<RunMetrics[]> {
  const runIds = await readdir(runsDirectory).catch(() => [] as string[]);
  const all = await Promise.all(runIds.map(async (runId) => {
    try {
      const metrics = JSON.parse(await readFile(path.join(runsDirectory, runId, METRICS_FILE), "utf8")) as RunMetrics;
      return metrics?.schemaVersion === 1 && metrics.runId ? [metrics] : [];
    } catch { return []; }
  }));
  return all.flat().sort((left, right) => (right.time.startedAt ?? "").localeCompare(left.time.startedAt ?? ""));
}

/**
 * Measures the runs of earlier processes that have a `run.json` and no figures
 * yet: those archived before metrics existed, and those a restart cut short.
 * Their waits and phases were never recorded and their worktree may be gone,
 * so they get what can still be read: the tokens, the durations and the outcome.
 */
export async function backfillRunMetrics(runsDirectory = dataRoot, live: Set<string> = new Set()) {
  for (const runId of await readdir(runsDirectory).catch(() => [] as string[])) {
    if (live.has(runId) || runId.startsWith("demo-")) continue;
    const directory = path.join(runsDirectory, runId);
    const known = await readFile(path.join(directory, METRICS_FILE), "utf8").then((content) => JSON.parse(content) as RunMetrics).catch(() => undefined);
    if (known?.final) continue;
    try {
      const state = normalizeArchivedRun(JSON.parse(await readFile(path.join(directory, "run.json"), "utf8")), runId);
      if (!state || !state.startedAt) continue;
      const metrics = await compute({ ...state, sessionActive: false }, false, known, directory);
      await writeFile(`${path.join(directory, METRICS_FILE)}.tmp`, JSON.stringify(metrics, null, 2));
      await rename(`${path.join(directory, METRICS_FILE)}.tmp`, path.join(directory, METRICS_FILE));
    } catch (error) {
      // An unreadable archive is left as it is. A directory without a run is not one.
      if (!isMissingFile(error)) reportFailure("Archived run not measured", runId)(error);
    }
  }
}
