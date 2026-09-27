import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FSWatcher } from "chokidar";
import { ARCHIVED_ACTIVITIES, broadcastToViewers, now } from "./context.js";
import { dataRoot } from "./config.js";
import { emptyState, planTaskBoard, runHoldsRepository, summarizeRun } from "./domain.js";
import type { EngineSession } from "./engine/index.js";
import type { Activity, ConversationMessage, RunState } from "./types.js";

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
  engine: EngineSession | null = null;
  artifactWatcher: FSWatcher | null = null;
  /** Where the dialogue is read from, and how far it has been read. */
  readonly transcript = { watcher: null as FSWatcher | null, path: undefined as string | undefined, offset: 0, carry: "" };
  readonly demoTimers = new Set<ReturnType<typeof setTimeout>>();
  pendingQuestionInput: Record<string, unknown> | null = null;
  /** Resolved with whatever the active engine expects back, which only that engine knows. */
  resolvePendingQuestion: ((output?: unknown) => void) | null = null;
  private archive: Activity[] = [];
  /**
   * Set by the registry. A row of the side list is drawn from a summary, so every
   * change inside a run is also a change of the list every open page is watching.
   */
  onChange: (() => void) | null = null;

  constructor(id: string, state: Partial<RunState> = {}) {
    this.id = id;
    this.state = { ...emptyState(), ...state, id };
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

  /** The run as it is archived: the same state, with the history the pages never received. */
  archivedState(): RunState {
    return { ...this.state, activities: this.archive };
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

  appendTerminal(data: string) {
    this.terminalBuffer = (this.terminalBuffer + data).slice(-TERMINAL_BUFFER);
    broadcastToViewers(this.id, { type: "terminal.output", runId: this.id, data });
  }

  publish() {
    broadcastToViewers(this.id, { type: "run", state: this.state });
    this.onChange?.();
    void this.persist();
  }

  async persist() {
    if (this.demo) return;
    const runDirectory = path.join(dataRoot, this.id);
    await mkdir(runDirectory, { recursive: true }).catch(() => undefined);
    await writeFile(path.join(runDirectory, "run.json"), JSON.stringify(this.archivedState(), null, 2)).catch(() => undefined);
  }

  clearDemoTimers() {
    for (const timer of this.demoTimers) clearTimeout(timer);
    this.demoTimers.clear();
  }

  /** Releases everything the run held. Called once, when the run leaves the registry. */
  async dispose() {
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
