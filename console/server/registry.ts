import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { broadcast, now } from "./context.js";
import { dataRoot, healthPolicy, hookToken, hostname, maxConcurrentRuns, pluginRoot, port, queueFile } from "./config.js";
import { closeAbandonedAgents, describeQueue, exitReport, runInProgress, sessionsToReleaseForQueue, terminalExitStatus } from "./domain.js";
import { clearTaskDirectory, closeArtifactWatcher, startArtifactWatcher } from "./artifacts.js";
import { closeTranscript } from "./transcript.js";
import { hookSpoolPath } from "./hook-bridge.js";
import { clearPendingQuestion } from "./hooks.js";
import { acknowledgeDemoInstruction, demoLaunchState, resumeDemoAfterContinuation, startDemoRun, startIncidentDemoRun } from "./demo.js";
import { scheduleAutonomousReview } from "./self-improvement.js";
import { resolveProjectDirectory } from "./repository.js";
import { fetchTicketTitle } from "./ticket.js";
import { engine } from "./engine/index.js";
import { snapshotExclusions, snapshotLogPath } from "./acceptance-runtime.js";
import { snapshotScript } from "./code-snapshot.js";
import { RunSession } from "./run-session.js";
import { RunArchive } from "./run-archive.js";
import { healthInput, RunMonitor } from "./run-monitor.js";
import { checkIncidentAction, CONTINUATION_INSTRUCTION, withDecision } from "./run-incidents.js";
import { pilotActs } from "./run-health.js";
import { declaredCompletion } from "./workflow-state.js";
import type { HarnessSnapshot, IncidentAction, QueuedRun, RunIncident } from "./types.js";

export type IncidentActionRequest = { runId: string; incidentId: string; expectedRevision: number; requestId: string; action: IncidentAction; reason?: string };
export type IncidentActionResult = { outcome: "done" | "refused" | "duplicate"; message: string };

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
  /** Watches every run this registry holds, and only those. */
  readonly monitor = new RunMonitor(() => this.all(), healthPolicy);
  /** Runs of an earlier process left with an open incident: readable, never live. */
  readonly archive = new RunArchive();

  get(runId: string | undefined) {
    return runId ? this.sessions.get(runId) : undefined;
  }

  /** A run to read, live or archived. Only a live one can be acted upon. */
  readable(runId: string | undefined) {
    return this.get(runId) ?? this.archive.get(runId);
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
      archived: this.archive.list(),
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

  /**
   * The simulated run, subject to the same ceilings: it takes a slot and it holds its own address.
   * `incident`: the scenario where the pilot hands back with nothing next, for the health detector.
   */
  startDemo(scenario: "workflow" | "incident" = "workflow") {
    if (this.shuttingDown) throw new Error("L'application est en cours de fermeture.");
    const launch = demoLaunchState(scenario);
    if (this.holders().has(launch.cwd)) throw new Error("Une démonstration est déjà en cours.");
    if (this.occupiedSlots() >= maxConcurrentRuns) throw new Error(`Le harnais tient déjà ${maxConcurrentRuns} runs. Libère une place avant de lancer la démonstration.`);
    const session = this.register(new RunSession(`demo-${crypto.randomUUID().slice(0, 8)}`, launch));
    if (scenario === "incident") startIncidentDemoRun(session);
    else startDemoRun(session);
    this.publishSnapshot();
    return session;
  }

  private register(session: RunSession) {
    session.onChange = () => this.publishSnapshot();
    session.onSignal = () => this.monitor.poke(session);
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
    session.engine = engine.start({
      cwd: entry.cwd, runId: id, command, pluginDir: pluginRoot,
      hookUrl: `http://${hostname}:${port}/api/hooks?token=${hookToken}`,
      hookSpool: hookSpoolPath(id),
      // The workflow identifies the code it verified with the same utility the
      // console uses, and every snapshot it takes is logged where the console reads it.
      environment: {
        IMPL_CODE_SNAPSHOT: snapshotScript(pluginRoot),
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
    session.signals.exit = { at: Date.now(), code: exitCode };
    // Whatever the session was doing when it went away, it is not doing it now.
    session.state.action = undefined;
    clearPendingQuestion(session);
    // The workflow can already have closed the run, and how its idle session
    // then ends says nothing about the outcome it reached.
    const inProgress = runInProgress(session.state.status);
    const complete = !inProgress || declaredCompletion(session.state.workflow, session.state.mergeRequestUrl).complete;
    if (inProgress) {
      session.state.status = terminalExitStatus(exitCode, session.stoppedBy !== null, complete);
      session.state.endedAt = now();
      if (session.state.status === "failed") session.state.error = exitCode === 0
        ? `${engine.label} s'est terminé avant que le workflow n'atteigne un résultat.`
        : `${engine.label} s'est arrêté avec le code ${exitCode}.`;
    }
    session.activity("system", exitReport(session.stoppedBy, exitCode, complete), `Code ${exitCode}`);
    closeAgentsLeftBehind(session);
    session.publish();
    // Diagnosed before the self-audit reads the run, so a lost session reaches it as an incident.
    void this.monitor.evaluate(session).then(() => { if (!this.shuttingDown) scheduleAutonomousReview(session); });
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
    // Removing the run is the user closing its case: an incident left open would bring it back as an archive at the next start.
    await session.serializeHealth(async () => {
      const at = now();
      const incidents = session.state.incidents ?? [];
      if (!incidents.some((incident) => incident.status === "open")) return;
      session.state.incidents = incidents.map((incident) => incident.status === "open"
        ? { ...incident, status: "dismissed" as const, revision: incident.revision + 1, updatedAt: at, resolution: { at, outcome: "Run retiré de la liste" } }
        : incident);
      await session.persist();
    });
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
    // The user gave the pilot something to do: it is no longer sitting at its prompt for nothing.
    if (session.engine) pilotActs(session.signals, Date.now());
    session.markProgress();
    session.conversationMessage({ id: `local-${crypto.randomUUID()}`, at: now(), author: "user", text: instruction, pending: session.engine !== null });
    session.activity("system", "Instruction transmise", instruction);
    session.publish();
    session.signal();
    if (!session.engine) acknowledgeDemoInstruction(session);
  }

  /**
   * An action on an incident, checked again against the state the server holds
   * right before its effect. The decision is written before the effect and its
   * outcome after it: a crash in between leaves "issue inconnue", never a replay.
   */
  async incidentAction(request: IncidentActionRequest): Promise<IncidentActionResult> {
    const session = this.readable(request.runId);
    if (!session) return { outcome: "refused", message: "Ce run n'existe plus." };
    return session.serializeHealth(async () => {
      const answered = session.answeredRequests.get(request.requestId);
      if (answered) return { outcome: "duplicate" as const, message: answered.message };
      const live = !session.state.archived && this.sessions.get(session.id) === session;
      const incident = session.state.incidents?.find((entry) => entry.id === request.incidentId);
      const check = checkIncidentAction({ ...request, incident, live, input: live ? healthInput(session) : undefined });
      if (!check.ok) {
        if (!check.duplicate) session.answeredRequests.set(request.requestId, { outcome: "refused", message: check.message });
        return { outcome: check.duplicate ? "duplicate" as const : "refused" as const, message: check.message };
      }
      const at = now();
      const replace = (next: RunIncident) => { session.state.incidents = (session.state.incidents ?? []).map((entry) => entry.id === next.id ? next : entry); };
      let current = withDecision({ ...incident!, revision: incident!.revision + 1, updatedAt: at }, { requestId: request.requestId, action: request.action, at, outcome: "pending" });
      replace(current);
      await session.persist();
      let message: string;
      if (request.action === "dismiss") {
        current = { ...current, status: "dismissed", resolution: { at, outcome: "Classé comme faux positif", detail: request.reason?.trim() } };
        session.activity("system", `Incident classé comme faux positif : ${current.title}`, request.reason?.trim());
        message = "Incident classé comme faux positif.";
      } else if (request.action === "stop") {
        this.stop(session.id);
        session.activity("system", "Arrêt demandé depuis l'incident", current.title);
        message = "Arrêt demandé.";
      } else {
        if (session.engine) session.engine.submit(CONTINUATION_INSTRUCTION);
        current = { ...current, continuation: { requestedAt: at, requestId: request.requestId } };
        session.conversationMessage({ id: `local-${crypto.randomUUID()}`, at, author: "user", text: CONTINUATION_INSTRUCTION, pending: session.engine !== null });
        session.activity("system", "Continuation demandée", current.title);
        if (session.demo) resumeDemoAfterContinuation(session);
        message = "Continuation demandée. L'incident se fermera quand la reprise sera observée.";
      }
      current = withDecision(current, { requestId: request.requestId, action: request.action, at, outcome: "done", detail: message });
      replace(current);
      session.answeredRequests.set(request.requestId, { outcome: "done", message });
      session.publish();
      await session.persist();
      if (session.state.archived) this.archive.release(session.id);
      if (session.state.archived) this.publishSnapshot();
      session.signal();
      return { outcome: "done" as const, message };
    });
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
    this.monitor.stop();
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
