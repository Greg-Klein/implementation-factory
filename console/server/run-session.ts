import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FSWatcher } from "chokidar";
import { ARCHIVED_ACTIVITIES, broadcastToViewers, now } from "./context.js";
import { dataRoot } from "./config.js";
import { emptyState, planTaskBoard, reviewPlanNotes, runHoldsRepository, summarizeRun } from "./domain.js";
import { engine, type EngineSession } from "./engine/index.js";
import { diskStorage, EvidenceArchive, memoryStorage } from "./evidence-archive.js";
import { createSignals, pilotActs, type RunSignals } from "./run-health.js";
import { RUN_SCHEMA_VERSION } from "./run-incidents.js";
import type { AcceptanceView, Activity, ConversationMessage, RunState } from "./types.js";

/**
 * Every event pushes the whole state to the pages showing this run, so the feed
 * they receive stays a window. The archive is the only history a later audit can
 * read, and writing that same window to it destroyed the rest: a run of an hour
 * kept eighty events and lost its first thirty-four minutes.
 */
const BROADCAST_ACTIVITIES = 80;
const TERMINAL_BUFFER = 600_000;

/**
 * One run and everything that belongs to it alone: its state, its archive, its
 * agent session, its terminal, the two watchers reading its documents and its
 * transcript, and the promise parking it on a question. All of this used to be
 * module-level state, which is exactly what made a second run impossible: two
 * runs shared one status, one terminal and one pending question, and the second
 * to start overwrote the first.
 */
export class RunSession {
  readonly id: string;
  state: RunState;
  terminalBuffer = "";
  /** Who ended the session, when it was not the workflow: a stop the user asked for, or the place given back to the queue. Neither is a crash. */
  stoppedBy: "user" | "queue" | null = null;
  /** Why the session ended by the user's own decision without a stop: they refused to trust the folder. */
  endedBy: "trust_refused" | null = null;
  engine: EngineSession | null = null;
  artifactWatcher: FSWatcher | null = null;
  /** Where the dialogue is read from, and how far it has been read. */
  readonly transcript = { watcher: null as FSWatcher | null, path: undefined as string | undefined, offset: 0, carry: "" };
  readonly demoTimers = new Set<ReturnType<typeof setTimeout>>();
  pendingQuestionInput: Record<string, unknown> | null = null;
  /** Resolved with whatever the active engine expects back, which only that engine knows. */
  resolvePendingQuestion: ((output?: unknown) => void) | null = null;
  /** What the console observed of the session beyond its state, read by the health monitor. See run-health.ts. */
  readonly signals: RunSignals = createSignals(Date.now());
  /** Set by the registry: something happened that may change who can move the run forward. */
  onSignal: (() => void) | null = null;
  /** Evaluations of this run's health one after another: a tick, a hook and a click never interleave. */
  healthChain: Promise<void> = Promise.resolve();
  /** Incident actions already answered, by request id, so a second window or a double click acts once. */
  readonly answeredRequests = new Map<string, { outcome: "done" | "refused"; message: string }>();
  /** Why the last `workflow-state.json` was not taken, until a valid one arrives. */
  workflowDiagnostic: string | undefined;
  /** Set once the run left the registry: nothing may evaluate or publish it any more. */
  disposed = false;
  /** The hooks already applied, so one posted twice (a retry, a spool replay) counts once. */
  readonly seenHooks = new Set<string>();
  /** The replay of the hook spool in flight, so two never apply the same file. */
  spoolDrain: Promise<void> | null = null;
  /** What the simulated workflow has "written" so far, since a demo run has no task directory. */
  readonly demoFiles = new Map<string, Buffer>();
  /** Every version of the documents acceptance coverage is computed from. See evidence-archive.ts. */
  readonly evidence: EvidenceArchive;
  /** The last coverage computed, served whole to the "Preuves" tab; the run state carries only its figures. */
  acceptanceView: AcceptanceView | null = null;
  /** What the figures last published were computed from, so an unchanged recomputation publishes nothing. */
  acceptanceKey = "";
  /** Writes of run.json one after another: two publications in the same tick must not race on the file. */
  private persistence: Promise<void> = Promise.resolve();
  private archive: Activity[] = [];
  /**
   * Set by the registry. A row of the side list is drawn from a summary, so every
   * change inside a run is also a change of the list every open page is watching.
   */
  onChange: (() => void) | null = null;

  constructor(id: string, state: Partial<RunState> = {}) {
    this.id = id;
    this.state = { ...emptyState(), ...state, id };
    // A run read back from its archive keeps its whole history, not just the window pages receive.
    if (state.activities?.length) {
      this.archive = state.activities.slice(0, ARCHIVED_ACTIVITIES);
      this.state.activities = this.archive.slice(0, BROADCAST_ACTIVITIES);
    }
    this.evidence = new EvidenceArchive(this.demo
      ? memoryStorage((relativePath) => this.demoFiles.get(relativePath))
      : diskStorage(() => engine.taskDirectory(this.state.cwd), path.join(dataRoot, id)));
  }

  get demo() { return this.id.startsWith("demo-"); }

  /** Whether this run still holds its slot and its checkout. See runHoldsRepository. */
  get holdsRepository() { return runHoldsRepository(this.state); }

  summary() { return summarizeRun(this.state); }

  activity(kind: Activity["kind"], title: string, detail?: string) {
    const entry: Activity = { id: crypto.randomUUID(), at: now(), kind, title, detail };
    this.archive = [entry, ...this.archive].slice(0, ARCHIVED_ACTIVITIES);
    this.state.activities = [entry, ...this.state.activities].slice(0, BROADCAST_ACTIVITIES);
  }

  /**
   * Records when a document was first seen and what that says about the
   * reviewers' order of work. Only the first arrival counts: a later round
   * rewriting a report does not make its plan look early.
   */
  artifactArrived(relativePath: string, at: string) {
    if (this.state.artifactArrivals?.[relativePath]) return;
    this.state.artifactArrivals = { ...this.state.artifactArrivals, [relativePath]: at };
    const notes = reviewPlanNotes(this.state.artifactArrivals);
    if (notes.length > 0 || this.state.reviewNotes?.length) this.state.reviewNotes = notes;
  }

  /** The run as it is archived: the same state, with the history the pages never received. */
  archivedState(): RunState {
    return { ...this.state, activities: this.archive, schemaVersion: RUN_SCHEMA_VERSION };
  }

  /** Late transcript reads can repeat a message the input already showed, so the local echo is replaced rather than doubled. */
  conversationMessage(message: ConversationMessage) {
    const echoed = message.author === "user"
      ? this.state.messages.findLast((entry) => entry.id.startsWith("local-") && entry.text === message.text)
      : undefined;
    this.state.messages = echoed
      ? this.state.messages.map((entry) => (entry === echoed ? message : entry))
      : [...this.state.messages, message].slice(-400);
  }

  /** Moves the cards of the "Suivi" board after anything they are read from changed: the plan, a delegation, an agent or a report. */
  refreshPlanTasks() {
    if (!this.state.planTasks) return;
    this.state.planTasks = planTaskBoard(this.state.planTasks, this.state.planDelegations ?? [], this.state.agents, this.state.artifacts);
  }

  /** The session executed something: a hook, the transcript growing. Terminal output is not execution. */
  markExecution() {
    this.signals.lastExecutionAt = Date.now();
  }

  /** The workflow produced something: an agent, a document, an answer, a merge request. */
  markProgress() {
    const now = Date.now();
    this.signals.lastProgressAt = now;
    this.signals.lastExecutionAt = Math.max(this.signals.lastExecutionAt, now);
  }

  /**
   * A line of the dialogue landed. Written after the pilot's last turn ended,
   * it means the pilot, or the user typing in the terminal, took the session
   * up again: the transcript lags, so an older line proves nothing.
   */
  noteDialogue(at: string) {
    this.markExecution();
    const written = new Date(at).getTime();
    if (this.signals.pilotIdleSince !== undefined && Number.isFinite(written) && written > this.signals.pilotIdleSince) pilotActs(this.signals, Date.now());
  }

  /** Runs one step after every health evaluation or incident action already queued for this run. */
  serializeHealth<T>(step: () => Promise<T> | T): Promise<T> {
    const next = this.healthChain.then(step, step);
    this.healthChain = next.then(() => undefined, () => undefined);
    return next;
  }

  /** Asks the health monitor to look at this run again, soon. */
  signal() {
    this.onSignal?.();
  }

  /** Whether this hook is seen for the first time. One without an identifier always is. */
  firstDelivery(hookId: unknown) {
    if (typeof hookId !== "string" || !hookId) return true;
    if (this.seenHooks.has(hookId)) return false;
    this.seenHooks.add(hookId);
    // Only a retry or a replay repeats a hook, and neither comes long after.
    if (this.seenHooks.size > 2_000) this.seenHooks.delete(this.seenHooks.values().next().value!);
    return true;
  }

  appendTerminal(data: string) {
    this.signals.lastOutputAt = Date.now();
    this.terminalBuffer = (this.terminalBuffer + data).slice(-TERMINAL_BUFFER);
    broadcastToViewers(this.id, { type: "terminal.output", runId: this.id, data });
  }

  publish() {
    broadcastToViewers(this.id, { type: "run", state: this.state });
    this.onChange?.();
    void this.persist();
  }

  /**
   * Written whole and renamed into place, one write after the other: a reader
   * never sees half a file, and the last state published is the one that stays.
   */
  persist() {
    if (this.demo) return Promise.resolve();
    const snapshot = JSON.stringify(this.archivedState(), null, 2);
    this.persistence = this.persistence.then(async () => {
      const runDirectory = path.join(dataRoot, this.id);
      const target = path.join(runDirectory, "run.json");
      const temporary = `${target}.tmp`;
      await mkdir(runDirectory, { recursive: true });
      await writeFile(temporary, snapshot);
      await rename(temporary, target);
    }).catch(() => undefined);
    return this.persistence;
  }

  clearDemoTimers() {
    for (const timer of this.demoTimers) clearTimeout(timer);
    this.demoTimers.clear();
  }

  /** Releases everything the run held. Called once, when the run leaves the registry. */
  async dispose() {
    this.disposed = true;
    this.clearDemoTimers();
    this.resolvePendingQuestion?.();
    this.resolvePendingQuestion = null;
    this.pendingQuestionInput = null;
    this.engine?.kill();
    this.engine = null;
    await this.artifactWatcher?.close().catch(() => undefined);
    this.artifactWatcher = null;
    await this.transcript.watcher?.close().catch(() => undefined);
    this.transcript.watcher = null;
  }
}
