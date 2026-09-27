import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { broadcast, now } from "./context.js";
import { dataRoot, hookToken, hostname, maxConcurrentRuns, pluginRoot, port, promptsRoot, queueFile } from "./config.js";
import { closeAbandonedAgents, describeQueue, exitReport, runInProgress, sessionsToReleaseForQueue, terminalExitStatus } from "./domain.js";
import { clearTaskDirectory, closeArtifactWatcher, startArtifactWatcher } from "./artifacts.js";
import { closeTranscript } from "./transcript.js";
import { hookSpoolPath } from "./hook-bridge.js";
import { clearPendingQuestion } from "./hooks.js";
import { acknowledgeDemoInstruction, demoLaunchState, startDemoRun } from "./demo.js";
import { scheduleAutonomousReview } from "./self-improvement.js";
import { resolveProjectDirectory } from "./repository.js";
import { fetchTicketTitle } from "./ticket.js";
import { engine } from "./engine/index.js";
import { createPromptStore } from "./prompts.js";
import { snapshotExclusions, snapshotLogPath } from "./acceptance-runtime.js";
import { snapshotScript } from "./code-snapshot.js";
import { RunSession } from "./run-session.js";
import type { HarnessSnapshot, QueuedRun } from "./types.js";

export type LaunchRequest = { cwd: string; issueUrl: string; instruction?: string };
export type LaunchOutcome = { started: RunSession } | { queued: QueuedRun };

function runIdentifier() {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Every run the console is holding, and the launches waiting for room. Two
 * ceilings, both enforced here and nowhere else:
 *
 * - one run per checkout, because two agent sessions in the same working tree
 *   fight over the branch, over `.claude/tasks` and over each other's edits;
 * - `maxConcurrentRuns` sessions in total, because each one is a full Claude
 *   Code session with its own quota and its own CPU.
 *
 * A launch that hits either one is queued rather than refused, and the queue is
 * drained the moment a run lets go of its checkout. A run whose workflow is over
 * is made to let go, rather than waited for: see releaseFinishedSessions.
 */
export class RunRegistry {
  private readonly sessions = new Map<string, RunSession>();
  private queue: QueuedRun[] = [];
  private shuttingDown = false;

  get(runId: string | undefined) {
    return runId ? this.sessions.get(runId) : undefined;
  }

  all() {
    return [...this.sessions.values()];
  }

  /** The run holding each checkout right now, which is what a queued launch waits on. */
  private holders() {
    const holders = new Map<string, string>();
    for (const session of this.sessions.values()) if (session.holdsRepository) holders.set(session.state.cwd, session.id);
    return holders;
  }

  private occupiedSlots() {
    return [...this.sessions.values()].filter((session) => session.holdsRepository).length;
  }

  snapshot(): HarnessSnapshot {
    return {
      // Newest first, the order the side list reads in.
      runs: [...this.sessions.values()].map((session) => session.summary()).sort((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? "")),
      queued: describeQueue(this.queue, this.holders()),
      maxConcurrentRuns,
    };
  }

  publishSnapshot() {
    broadcast({ type: "harness", snapshot: this.snapshot() });
  }

  /**
   * Starts the run if there is room for it, queues it otherwise. The checkout is
   * resolved here, before anything is queued, so a ticket with no checkout fails
   * while the user is still looking at the form rather than an hour later.
   */
  async launch(request: LaunchRequest): Promise<LaunchOutcome> {
    if (this.shuttingDown) throw new Error("L'application est en cours de fermeture.");
    if (!engine.locate()) throw new Error(`${engine.label} est introuvable dans PATH.`);
    const cwd = await resolveProjectDirectory(request.cwd, request.issueUrl);
    if (this.shuttingDown) throw new Error("L'application est en cours de fermeture.");
    const entry: QueuedRun = {
      id: `queued-${crypto.randomUUID().slice(0, 8)}`,
      cwd,
      issueUrl: request.issueUrl.trim(),
      instruction: request.instruction?.trim() ?? "",
      queuedAt: now(),
    };
    if (this.holders().has(cwd) || this.occupiedSlots() >= maxConcurrentRuns) {
      this.queue = [...this.queue, entry];
      // What blocks it may be a run that has already finished, and draining is
      // where that is noticed and its session given up.
      await this.drain();
      return { queued: entry };
    }
    const started = await this.start(entry);
    this.publishSnapshot();
    return { started };
  }

  /** The simulated run, subject to the same ceilings: it takes a slot and it holds its own address. */
  startDemo() {
    if (this.shuttingDown) throw new Error("L'application est en cours de fermeture.");
    const launch = demoLaunchState();
    if (this.holders().has(launch.cwd)) throw new Error("Une démonstration est déjà en cours.");
    if (this.occupiedSlots() >= maxConcurrentRuns) throw new Error(`Le harnais tient déjà ${maxConcurrentRuns} runs. Libère une place avant de lancer la démonstration.`);
    const session = this.register(new RunSession(`demo-${crypto.randomUUID().slice(0, 8)}`, launch));
    startDemoRun(session);
    this.publishSnapshot();
    return session;
  }

  private register(session: RunSession) {
    session.onChange = () => this.publishSnapshot();
    this.sessions.set(session.id, session);
    return session;
  }

  private async start(entry: QueuedRun) {
    const id = runIdentifier();
    const session = this.register(new RunSession(id, {
      status: "starting", phase: 1, cwd: entry.cwd, issueUrl: entry.issueUrl, instruction: entry.instruction, startedAt: now(),
    }));
    session.activity("system", "Session créée", path.basename(entry.cwd));
    session.publish();
    void fetchTicketTitle(entry.issueUrl, entry.cwd).then((title) => {
      if (!title) return;
      session.state.ticketTitle = title;
      session.publish();
    });
    await clearTaskDirectory(entry.cwd);
    await mkdir(path.join(dataRoot, id), { recursive: true });
    await startArtifactWatcher(session);
    if (this.shuttingDown) { await session.dispose(); throw new Error("L'application est en cours de fermeture."); }
    const command = engine.command(session.state.issueUrl, session.state.instruction);
    const plugin = createPromptStore({ pluginRoot: () => pluginRoot, promptsRoot }).sessionPlugin(path.join(dataRoot, id, "plugin"));
    if (plugin.customized.length) session.activity("system", "Prompts personnalisés", plugin.customized.join(", "));
    session.engine = engine.start({
      cwd: entry.cwd, runId: id, command, pluginDir: plugin.pluginDir, systemPrompt: plugin.systemPrompt,
      hookUrl: `http://${hostname}:${port}/api/hooks?token=${hookToken}`,
      hookSpool: hookSpoolPath(id),
      // The workflow identifies the code it verified with the same utility the
      // console uses, and every snapshot it takes is logged where the console reads it.
      environment: {
        IMPL_CODE_SNAPSHOT: snapshotScript(plugin.pluginDir),
        IMPL_SNAPSHOT_LOG: snapshotLogPath(id),
        IMPL_SNAPSHOT_EXCLUDE: snapshotExclusions(entry.cwd).join(","),
      },
      onData: (data) => {
        session.appendTerminal(data);
        void appendFile(path.join(dataRoot, id, "terminal.log"), data).catch(() => undefined);
      },
      onExit: (exitCode) => this.handleExit(session, exitCode),
    });
    session.state.status = "running";
    session.state.sessionActive = true;
    session.activity("system", `${engine.label} démarré`, command);
    session.publish();
    return session;
  }

  private handleExit(session: RunSession, exitCode: number) {
    session.engine = null;
    session.state.sessionActive = false;
    // Whatever the session was doing when it went away, it is not doing it now.
    session.state.action = undefined;
    clearPendingQuestion(session);
    // The workflow can already have closed the run, and how its idle session
    // then ends says nothing about the outcome it reached.
    if (runInProgress(session.state.status)) {
      session.state.status = terminalExitStatus(exitCode, session.stoppedBy !== null);
      session.state.endedAt = now();
      if (session.state.status === "failed") session.state.error = `${engine.label} s'est arrêté avec le code ${exitCode}.`;
    }
    session.activity("system", exitReport(session.stoppedBy, exitCode), `Code ${exitCode}`);
    closeAgentsLeftBehind(session);
    session.publish();
    if (!this.shuttingDown) scheduleAutonomousReview(session);
    // The checkout and the slot are free now, which is what the queue waits on.
    void this.drain();
  }

  stop(runId: string) {
    const session = this.expect(runId);
    if (session.demo) {
      session.clearDemoTimers();
      session.state.pendingQuestion = undefined;
      session.state.action = undefined;
      session.state.status = "stopped";
      session.state.endedAt = now();
      session.activity("system", "Démonstration arrêtée");
      closeAgentsLeftBehind(session);
      session.publish();
      void this.drain();
      return;
    }
    if (!session.engine) return;
    session.stoppedBy = "user";
    clearPendingQuestion(session);
    session.engine.kill();
    session.engine = null;
  }

  /**
   * Removes a finished run from the console. Refused while its session is still
   * up: the run would vanish from the list with a live agent session behind it,
   * reachable from nowhere.
   */
  async close(runId: string) {
    const session = this.expect(runId);
    if (session.holdsRepository) throw new Error("Ce run tient encore sa session. Arrête-la avant de le fermer.");
    await closeArtifactWatcher(session);
    await closeTranscript(session);
    await session.dispose();
    this.sessions.delete(runId);
    this.publishSnapshot();
    await this.drain();
  }

  sendInstruction(runId: string, text: string) {
    const session = this.expect(runId);
    const instruction = text.trim();
    if (!instruction) throw new Error("L'instruction est vide.");
    if (!session.engine && !session.demo) throw new Error(`Aucune session ${engine.label} n'est active.`);
    session.engine?.submit(instruction);
    session.conversationMessage({ id: `local-${crypto.randomUUID()}`, at: now(), author: "user", text: instruction, pending: session.engine !== null });
    session.activity("system", "Instruction transmise", instruction);
    session.publish();
    if (!session.engine) acknowledgeDemoInstruction(session);
  }

  cancelQueued(queuedId: string) {
    const remaining = this.queue.filter((entry) => entry.id !== queuedId);
    if (remaining.length === this.queue.length) throw new Error("Cette demande n'est plus en file.");
    this.queue = remaining;
    void this.persistQueue();
    this.publishSnapshot();
  }

  /**
   * Starts everything the freed room allows, in the order the launches were
   * asked for. An entry whose checkout is still held is stepped over rather than
   * blocking the ones behind it: it is waiting on a different run, and holding
   * the whole queue for it would leave free slots idle.
   */
  async drain() {
    // PTY exit callbacks may arrive while shutdown is persisting the final state.
    if (this.shuttingDown) return;
    for (;;) {
      if (this.shuttingDown) break;
      if (this.occupiedSlots() >= maxConcurrentRuns) break;
      const holders = this.holders();
      const index = this.queue.findIndex((entry) => !holders.has(entry.cwd));
      if (index < 0) break;
      const [entry] = this.queue.splice(index, 1);
      try {
        await this.start(entry);
      } catch (error) {
        broadcast({ type: "notice", level: "attention", title: "Run en file non démarré", detail: error instanceof Error ? error.message : String(error), at: now() });
      }
    }
    this.releaseFinishedSessions();
    await this.persistQueue();
    this.publishSnapshot();
  }

  /**
   * Closes the sessions of the finished runs the queue is waiting on. The kill
   * is asynchronous: the entries they were blocking start from the exit of each
   * session, which drains the queue again.
   */
  private releaseFinishedSessions() {
    const runs = [...this.sessions.values()].map((session) => ({ id: session.id, cwd: session.state.cwd, status: session.state.status, sessionActive: session.state.sessionActive, endedAt: session.state.endedAt }));
    for (const runId of sessionsToReleaseForQueue(runs, this.queue, maxConcurrentRuns)) {
      const session = this.sessions.get(runId);
      if (!session?.engine) continue;
      session.stoppedBy = "queue";
      clearPendingQuestion(session);
      session.engine.kill();
      session.engine = null;
    }
  }

  private expect(runId: string) {
    const session = this.sessions.get(runId);
    if (!session) throw new Error("Ce run n'existe plus.");
    return session;
  }

  private async persistQueue() {
    await mkdir(path.dirname(queueFile), { recursive: true }).catch(() => undefined);
    await writeFile(queueFile, JSON.stringify(this.queue, null, 2)).catch(() => undefined);
  }

  /**
   * The launches accepted before the console went down. They were queued because
   * something else was running, and that something else did not survive the
   * restart, so they start as soon as the server is listening.
   */
  async restoreQueue() {
    try {
      const stored = JSON.parse(await readFile(queueFile, "utf8")) as unknown;
      this.queue = Array.isArray(stored) ? stored.filter((entry): entry is QueuedRun =>
        Boolean(entry) && typeof entry === "object"
        && typeof (entry as QueuedRun).id === "string"
        && typeof (entry as QueuedRun).cwd === "string"
        && typeof (entry as QueuedRun).issueUrl === "string") : [];
    } catch {
      this.queue = [];
    }
  }

  async shutdown() {
    this.shuttingDown = true;
    for (const session of this.sessions.values()) {
      session.stoppedBy = "user";
      if (runInProgress(session.state.status)) {
        session.state.status = "stopped";
        session.state.endedAt = now();
        session.activity("system", "Session arrêtée à la fermeture de l’application");
      }
      session.state.sessionActive = false;
      session.state.action = undefined;
      clearPendingQuestion(session);
      closeAgentsLeftBehind(session);
      await session.dispose().catch(() => undefined);
      await session.persist();
    }
    this.sessions.clear();
    await this.persistQueue();
  }
}

/**
 * Called on every path that ends a run, and before the self-audit reads the
 * state: an agent the session can no longer report on must stop reading as
 * running, in the console and in the signals the improvement loop is given.
 */
function closeAgentsLeftBehind(session: RunSession) {
  const { agents, abandoned } = closeAbandonedAgents(session.state.agents, now());
  if (abandoned.length === 0) return;
  session.state.agents = agents;
  session.activity("agent", abandoned.length === 1 ? "Un agent n'a jamais rapporté sa fin" : `${abandoned.length} agents n'ont jamais rapporté leur fin`, abandoned.map((agent) => agent.name).join(" · "));
}

export const registry = new RunRegistry();
