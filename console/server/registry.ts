import { defined } from "../lib/defined.js";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { broadcast, broadcastToViewers, isMissingFile, now, reportFailure } from "./context.js";
import { dataRoot, demoStepDuration, healthPolicy, hookToken, hostname, maxConcurrentRuns, mergePollMs, pluginRoot, port, proposalsFile, proposalsHandledFile, proposalsPollMs, queueFile } from "./config.js";
import { admitBatch, closeAbandonedAgents, conflictingEntries, deliveryProjects, describeQueue, linkEdges, overlayEdges, exitReport, forgeOf, forgeWords, heldWatches, isSimulatedTicket, mergeWatchStep, pruneSchedule, restoreQueueFile, runInProgress, runLockKey, runTakesSlot, sessionsToReleaseForQueue, sourceRepository, startableEntries, storedQueue, terminalExitStatus, ticketIdentity, ticketReference, worktreeKeptDetail, type KnownTicket, type MergeRequestStatus, type ScheduleContext } from "./domain.js";
import { clearTaskDirectory, closeArtifactWatcher, startArtifactWatcher } from "./artifacts.js";
import { closeTranscript } from "./transcript.js";
import { seedRecurringFindings } from "./review-findings.js";
import { seedRuntimeRecipe } from "./runtime-recipe.js";
import { hookSpoolPath } from "./hook-bridge.js";
import { clearPendingQuestion } from "./hooks.js";
import { applySessionEvent, closeSessionPrompt } from "./session-prompt.js";
import { acknowledgeDemoInstruction, DEMO_BATCH, DEMO_CWD, demoBatchLaunchState, demoLaunchState, resumeDemoAfterContinuation, startDemoRun, startIncidentDemoRun } from "./demo.js";
import { scheduleAutonomousReview } from "./self-improvement.js";
import { checkoutProject, resolveProjectDirectory } from "./repository.js";
import { fetchIssueLinks, fetchMergeRequestStatus, fetchTicketTitle } from "./ticket.js";
import { analyseTickets, clearScheduleFiles, type AnalysisResult } from "./schedule-analysis.js";
import { MergeWatcher } from "./merge-watch.js";
import { TicketProposals, type ProposalLaunch } from "./ticket-proposals.js";
import { resolveProposedTickets, resolveTargets } from "./ticket-source.js";
import type { ScheduleSession } from "./engine/types.js";
import { engine } from "./engine/index.js";
import { snapshotExclusions, snapshotLogPath } from "./acceptance-runtime.js";
import { snapshotScript } from "./code-snapshot.js";
import { RunSession } from "./run-session.js";
import { RunArchive } from "./run-archive.js";
import { healthInput, RunMonitor } from "./run-monitor.js";
import { checkIncidentAction, CONTINUATION_INSTRUCTION, withDecision } from "./run-incidents.js";
import { pilotActs } from "./run-health.js";
import { declaredCompletion } from "./workflow-state.js";
import { discardRunWorktree, prepareRunWorktree, removeWorktreeOnRequest, settleRunWorktree, type WorktreeRemovalResult } from "./run-worktrees.js";
import { currentBranch, headCommit, mainCheckout } from "./worktree.js";
import { harnessVersion, recordRunMetrics, storedMetrics } from "./run-metrics-runtime.js";
import type { HarnessSnapshot, IncidentAction, MergeWatch, QueuedRun, QueuedRunView, ResolvedTicket, RunIncident, RunMetrics, ScheduledTicket, ScheduleEdge, TicketProposal } from "./types.js";

export type IncidentActionRequest = { runId: string; incidentId: string; expectedRevision: number; requestId: string; action: IncidentAction; reason?: string };
export type IncidentActionResult = { outcome: "done" | "refused" | "duplicate"; message: string };

export type LaunchRequest = { cwd: string; issueUrl: string; instruction?: string };
export type LaunchOutcome = { started: RunSession } | { queued: QueuedRunView };
/** What became of a batch: what was queued, what was left out as already known, and what started at once. */
export type BatchOutcome = { batchId: string; entries: QueuedRun[]; duplicates: string[]; started: RunSession[] };

/** A merge request nothing waits for any more is forgotten after a week: its ticket then stops being compared against. */
const WATCH_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
/** How many steps of the demonstration a simulated merge request takes to be merged. */
const DEMO_MERGE_STEPS = 4;

const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;

function mergeRequestReference(mergeRequestUrl: string) {
  const words = forgeWords(forgeOf(mergeRequestUrl));
  return `${words.short} ${words.sigil}${mergeRequestUrl.split("/").filter(Boolean).pop()}`;
}

function runIdentifier() {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Every run the console is holding, and the launches waiting for room. Two
 * ceilings, both enforced here and nowhere else:
 *
 * - one run per ticket of a repository. Every run works in a git worktree of
 *   its own, so two tickets of one repository no longer share a working tree,
 *   but two sessions on the same ticket would fight over its branch and its
 *   merge request;
 * - `maxConcurrentRuns` sessions in total, because each one is a full Claude
 *   Code session with its own quota and its own CPU.
 *
 * A launch that hits either one is queued rather than refused, and the queue is
 * drained the moment a run lets go of its ticket. A run whose workflow is over
 * is made to let go, rather than waited for: see releaseFinishedSessions.
 *
 * A third thing holds a queued ticket back, and takes no slot while it does:
 * the schedule. Tickets that arrive together are analysed, one headless
 * session per repository, and two tickets of one repository that would touch
 * the same code never run together: the second waits until the merge request
 * of the first is merged. The registry does not know where a batch came from:
 * `enqueueBatch` takes tickets already resolved to their checkout.
 */
export class RunRegistry {
  private readonly sessions = new Map<string, RunSession>();
  private queue: QueuedRun[] = [];
  /** What the scheduling sessions said of the tickets still queued, running or awaited, and the edges between them. */
  private tickets: ScheduledTicket[] = [];
  private edges: ScheduleEdge[] = [];
  /** The merge requests of finished runs that tickets wait for, or may have to. */
  private watches: MergeWatch[] = [];
  /** Runs whose end has been taken into account, so it is once. */
  private readonly settled = new Set<string>();
  /** One analysis at a time per repository: the next one compares against what this one predicted. */
  private readonly analysisChains = new Map<string, Promise<void>>();
  private readonly analysisSessions = new Set<ScheduleSession>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private queueWrites: Promise<void> = Promise.resolve();
  private shuttingDown = false;
  /** Asks GitLab about the merge requests the queue waits for, and only those. */
  readonly mergeWatcher = new MergeWatcher({
    held: () => heldWatches(this.queue, this.context()).filter((watch) => !isSimulatedTicket(watch.issueUrl)),
    check: (watch) => fetchMergeRequestStatus(watch.mergeRequestUrl, watch.repository),
    apply: (watch, status) => this.applyMergeStatus(watch, status),
    intervalMs: mergePollMs,
  });
  /** The tickets a watcher found: each one is queued as soon as it is read. */
  readonly proposals = new TicketProposals({
    file: proposalsFile,
    handledFile: proposalsHandledFile,
    intervalMs: proposalsPollMs,
    // By address: a proposal has no checkout until it is accepted.
    taken: () => [...this.queue.map((entry) => entry.issueUrl), ...[...this.sessions.values()].filter((session) => session.holdsRepository).map((session) => session.state.issueUrl), ...this.watches.map((watch) => watch.issueUrl)],
    changed: () => this.publishSnapshot(),
    launch: (proposals) => this.launchProposals(proposals),
  });
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

  /** The run holding each ticket right now, by lock key, which is what a queued launch waits on. */
  private holders() {
    const holders = new Map<string, string>();
    for (const session of this.sessions.values()) if (session.holdsRepository) holders.set(runLockKey(session.state), session.id);
    return holders;
  }

  private occupiedSlots() {
    return [...this.sessions.values()].filter((session) => runTakesSlot(session.state)).length;
  }

  /** What the queue is scheduled against, beside the ticket locks and the slots. */
  private context(): ScheduleContext {
    return {
      runs: [...this.sessions.values()].map(({ id, state }) => ({ id, cwd: state.cwd, issueUrl: state.issueUrl, status: state.status, ...defined({ repository: state.repository, branch: state.branch, mergeRequestUrl: state.mergeRequestUrl }) })),
      tickets: this.tickets, edges: this.edges, watches: this.watches,
    };
  }

  private describe() {
    return describeQueue(this.queue, this.holders(), this.context());
  }

  /** Every ticket the console already has: queued, held by a run, or behind an unmerged merge request. */
  private takenTickets() {
    return [
      ...this.queue.map(runLockKey), ...this.holders().keys(),
      ...this.watches.map((watch) => runLockKey({ cwd: watch.repository, issueUrl: watch.issueUrl })),
    ];
  }

  /** The tickets of a repository the console has, queued, held by a run or behind an unmerged merge request: what a blocking link can point at. */
  private repositoryTickets(repository: string) {
    const held = [...this.sessions.values()].filter((session) => session.holdsRepository || runInProgress(session.state.status)).map((session) => session.state);
    const awaited = this.watches.map((watch) => ({ cwd: watch.repository, issueUrl: watch.issueUrl }));
    return [...this.queue, ...held, ...awaited].filter((ticket) => sourceRepository(ticket) === repository).map((ticket) => ticket.issueUrl);
  }

  /**
   * The dependencies the forge states between these tickets and the others of
   * the repository, read from the blocking links of each. A ticket whose links
   * cannot be read gives none.
   */
  private async forgeEdges(repository: string, urls: string[]) {
    const edges = await Promise.all(urls.map(async (issueUrl) => {
      const links = await fetchIssueLinks(issueUrl, repository);
      return links ? linkEdges(repository, issueUrl, links, this.repositoryTickets(repository)) : [];
    }));
    return overlayEdges([], edges.flat());
  }

  /** Where each ticket the console still has stands, by lock key: running, behind an unmerged merge request, or queued. */
  private ticketStates() {
    const queued = new Set(this.queue.map(runLockKey));
    const running = new Set([...this.sessions.values()].filter((session) => runInProgress(session.state.status)).map((session) => runLockKey(session.state)));
    const awaited = new Set(this.watches.map((watch) => runLockKey({ cwd: watch.repository, issueUrl: watch.issueUrl })));
    return (key: string) => running.has(key) ? "running" as const : awaited.has(key) ? "awaiting_merge" as const : queued.has(key) ? "queued" as const : undefined;
  }

  /** The predictions a new analysis of this repository is compared against. See `known` in contracts/schedule.md. */
  private knownTickets(repository: string, except: Set<string> = new Set()): KnownTicket[] {
    const stateOf = this.ticketStates();
    return this.tickets.flatMap((ticket) => {
      const key = runLockKey({ cwd: ticket.repository, issueUrl: ticket.issueUrl });
      if (ticket.repository !== repository || ticket.analysis !== "done" || except.has(key)) return [];
      const state = stateOf(key);
      return state ? [{ ticket, state }] : [];
    });
  }

  /**
   * The tickets of this repository the console still has and whose analysis
   * failed. They have no prediction to compare against, so the next analysis of
   * the repository predicts them again instead of holding every ticket behind them.
   */
  private failedTickets(repository: string, except: Set<string>): ScheduledTicket[] {
    const stateOf = this.ticketStates();
    return this.tickets.filter((ticket) => {
      const key = runLockKey({ cwd: ticket.repository, issueUrl: ticket.issueUrl });
      return ticket.repository === repository && ticket.analysis === "failed" && !except.has(key) && stateOf(key) !== undefined;
    });
  }

  private entry(ticket: ResolvedTicket, instruction: string | undefined, extra: Partial<QueuedRun> = {}): QueuedRun {
    return { id: `queued-${crypto.randomUUID().slice(0, 8)}`, cwd: ticket.repository, repository: ticket.repository, issueUrl: ticket.issueUrl.trim(), instruction: instruction?.trim() ?? "", queuedAt: now(), ...(ticket.baseBranch ? { baseBranch: ticket.baseBranch } : {}), ...(ticket.deliveries ? { deliveries: ticket.deliveries } : {}), ...extra };
  }

  /** The figures of every run measured, newest first: those on disk, and the runs held here as they stand now. */
  async metrics(): Promise<RunMetrics[]> {
    const live = (await Promise.all([...this.sessions.values()].filter((session) => session.state.startedAt).map((session) => recordRunMetrics(session).catch(reportFailure("Run metrics not recorded", session.id))))).flatMap((metrics) => metrics ?? []);
    const held = new Set(live.map((metrics) => metrics.runId));
    return [...live, ...(await storedMetrics()).filter((metrics) => !held.has(metrics.runId))].sort((left, right) => (right.time.startedAt ?? "").localeCompare(left.time.startedAt ?? ""));
  }

  snapshot(): HarnessSnapshot {
    return {
      // Newest first, the order the side list reads in.
      runs: [...this.sessions.values()].map((session) => session.summary()).sort((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? "")),
      queued: this.describe(),
      maxConcurrentRuns,
      archived: this.archive.list(),
      proposals: this.proposals.open(),
    };
  }

  /** The list of runs as every page last received it. */
  private publishedSnapshot = "";

  /**
   * Sent to every page, and only when it says something new: every event of
   * every run asks for it, and most of them change nothing a list of runs shows.
   * A page that connects is sent the list on its own, whatever was published.
   */
  publishSnapshot() {
    const snapshot = this.snapshot();
    const serialized = JSON.stringify(snapshot);
    if (serialized === this.publishedSnapshot) return;
    this.publishedSnapshot = serialized;
    broadcast({ type: "harness", snapshot });
  }

  /**
   * Starts the run if there is room for it, queues it otherwise. The checkout is
   * resolved here, before anything is queued, so a ticket with no checkout fails
   * while the user is still looking at the form rather than an hour later.
   */
  async launch(request: LaunchRequest): Promise<LaunchOutcome> {
    if (this.shuttingDown) throw new Error("The application is shutting down.");
    if (!engine.locate()) throw new Error(`${engine.label} was not found in PATH.`);
    // A path inside a linked worktree, or below the root, names the same repository as its main checkout.
    const repository = await mainCheckout(await resolveProjectDirectory(request.cwd, request.issueUrl));
    if (this.shuttingDown) throw new Error("The application is shutting down.");
    // A checkout typed by hand may belong to another project than the ticket's: the workflow is told so.
    const deliveries = deliveryProjects(request.issueUrl, [await checkoutProject(repository)]);
    const entry = this.entry({ repository, issueUrl: request.issueUrl, ...(deliveries ? { deliveries } : {}) }, request.instruction);
    // Beside tickets that have no prediction, no session compares it. Its blocking links are read
    // here, before it may start, so the page still opens the run it asked for.
    if (!this.takenTickets().includes(runLockKey(entry)) && this.knownTickets(repository).length === 0 && this.repositoryTickets(repository).length > 0) {
      this.edges = overlayEdges(this.edges, await this.forgeEdges(repository, [entry.issueUrl]));
      if (this.shuttingDown) throw new Error("The application is shutting down.");
    }
    // A ticket added beside others already predicted is compared against them before it may start.
    const analysed = !this.takenTickets().includes(runLockKey(entry)) && this.knownTickets(repository).length > 0;
    if (!analysed && startableEntries([...this.queue, entry], this.holders(), this.context(), maxConcurrentRuns - this.occupiedSlots()).includes(entry)) {
      const started = await this.start(entry);
      this.publishSnapshot();
      return { started };
    }
    if (analysed) entry.analysing = true;
    this.queue = [...this.queue, entry];
    if (analysed) this.scheduleAnalysis(repository, [entry], true);
    const queued = this.describe().find((view) => view.id === entry.id)!;
    // What blocks it may be a run that has already finished, and draining is
    // where that is noticed and its session given up.
    await this.drain();
    return { queued };
  }

  /**
   * Several tickets at once, whatever found them. A ticket the console already
   * has, queued, running or behind an unmerged merge request, is left out. The
   * new ones are queued at once and analysed per repository, except where
   * there is nothing to compare: a single new ticket in a repository with no
   * known prediction gets no session, only its blocking links read when the
   * console has another ticket of that repository.
   */
  async enqueueBatch(tickets: ResolvedTicket[], options: { instruction?: string } = {}): Promise<BatchOutcome> {
    if (this.shuttingDown) throw new Error("The application is shutting down.");
    if (!engine.locate()) throw new Error(`${engine.label} was not found in PATH.`);
    const outcome = this.admit(tickets, options.instruction);
    const before = new Set(this.sessions.keys());
    await this.drain();
    const keys = new Set(outcome.entries.map(runLockKey));
    return { ...outcome, started: this.all().filter((session) => !before.has(session.id) && keys.has(runLockKey(session.state))) };
  }

  /** Tickets a watcher found, queued as one batch. While shutting down nothing is launched nor refused: they are tried again at the next boot. */
  private async launchProposals(proposals: TicketProposal[]): Promise<ProposalLaunch> {
    if (this.shuttingDown) return { started: [], refused: [] };
    const { resolved, refused } = await resolveProposedTickets(proposals);
    if (resolved.length === 0 || this.shuttingDown) return { started: [], refused };
    try {
      const outcome = await this.enqueueBatch(resolved);
      const queued = [...outcome.entries.map((entry) => entry.issueUrl), ...outcome.duplicates];
      if (outcome.entries.length > 0) broadcast({ type: "notice", level: "info", title: "Tickets queued from the watcher", detail: outcome.entries.map((entry) => ticketReference(entry.issueUrl)).join(", "), at: now() });
      return { started: queued, refused };
    } catch (error) {
      if (this.shuttingDown) return { started: [], refused };
      const reason = error instanceof Error ? error.message : String(error);
      return { started: [], refused: [...refused, ...resolved.map((ticket) => ({ issueUrl: ticket.issueUrl, reason }))] };
    }
  }

  /**
   * A ticket of the watcher the console could not launch, sent by the user to
   * the checkouts they chose: one run per repository, with the base the watcher
   * named. It is then handled like any accepted proposal.
   */
  async launchProposal(issueUrl: string, paths: string[]): Promise<BatchOutcome> {
    const [listed] = this.proposals.proposed([issueUrl]);
    const proposal = listed === undefined ? undefined : this.proposals.open().find((candidate) => candidate.issueUrl === listed);
    if (!proposal) throw new Error("This ticket is no longer listed.");
    if (paths.length === 0) throw new Error("Choose at least one repository.");
    const outcome = await this.enqueueBatch(await resolveTargets(proposal.issueUrl, paths, proposal.baseBranch));
    await this.proposals.handle([proposal.issueUrl]);
    return outcome;
  }

  private admit(tickets: ResolvedTicket[], instruction: string | undefined, extra: Partial<QueuedRun> = {}) {
    const { accepted, duplicates } = admitBatch(tickets, this.takenTickets());
    if (accepted.length === 0) throw new Error(tickets.length > 1 ? "These tickets are already queued, running or waiting for a merge." : "This ticket is already queued, running or waiting for a merge.");
    const batchId = `batch-${crypto.randomUUID().slice(0, 8)}`;
    const entries = accepted.map((ticket) => this.entry(ticket, instruction, { batchId, ...extra }));
    const analyses: [string, QueuedRun[], boolean][] = [];
    for (const repository of new Set(entries.map((entry) => entry.repository))) {
      const group = entries.filter((entry) => entry.repository === repository);
      const predicted = group.length > 1 || this.knownTickets(repository).length > 0;
      if (!predicted && this.repositoryTickets(repository).length === 0) continue;
      for (const entry of group) entry.analysing = true;
      analyses.push([repository, group, predicted]);
    }
    this.queue = [...this.queue, ...entries];
    for (const [repository, group, predicted] of analyses) this.scheduleAnalysis(repository, group, predicted);
    this.publishSnapshot();
    return { batchId, entries, duplicates: duplicates.map((ticket) => ticket.issueUrl) };
  }

  /** Queues the analysis of one repository's new tickets behind whatever analysis of that repository is still running. `predicted`: false to read the blocking links alone. */
  private scheduleAnalysis(repository: string, entries: QueuedRun[], predicted: boolean) {
    const next = (this.analysisChains.get(repository) ?? Promise.resolve()).then(() => this.analyse(repository, entries, predicted)).catch(reportFailure("Batch analysis not run", repository));
    this.analysisChains.set(repository, next);
    void next.then(() => { if (this.analysisChains.get(repository) === next) this.analysisChains.delete(repository); });
  }

  /**
   * Runs the scheduling session and takes its answer. A failure, whatever it
   * is, never frees the tickets to run together: each is recorded as failed,
   * which keeps it apart from every other ticket of its repository. The
   * blocking links of the forge are read beside it, by the server: what they
   * state wins over what the session said of the same two tickets, and holds
   * when the session failed or was not needed (`predicted` false).
   */
  private async analyse(repository: string, entries: QueuedRun[], predicted: boolean) {
    if (this.shuttingDown) return;
    // A ticket cancelled meanwhile is not worth a prediction; one started by force still is.
    const running = new Set([...this.sessions.values()].filter((session) => session.holdsRepository).map((session) => runLockKey(session.state)));
    const pending = entries.filter((entry) => this.queue.some((queued) => queued.id === entry.id) || running.has(runLockKey(entry)));
    if (pending.length === 0) return;
    const keys = new Set(pending.map(runLockKey));
    // An analysis that failed earlier is tried again here, with the new tickets: never on its own.
    const retried = predicted ? this.failedTickets(repository, keys) : [];
    const urls = [...pending, ...retried].map((ticket) => ticket.issueUrl);
    let inFlight: ScheduleSession | null = null;
    const track = (session: ScheduleSession | null) => {
      if (inFlight) this.analysisSessions.delete(inFlight);
      if (session) this.analysisSessions.add(session);
      inFlight = session;
    };
    const links = this.forgeEdges(repository, urls);
    const result = !predicted ? undefined : pending.every((entry) => entry.demo)
      ? await this.demoAnalysis(urls)
      : await analyseTickets(repository, urls, this.knownTickets(repository, keys), track);
    const stated = await links;
    // Left as `analysing` on disk: the next start reads it back as a failed analysis.
    if (this.shuttingDown) return;
    // A second failure leaves the retried tickets as they were: failed, with the reason they had.
    const answered = result?.ok ? new Set([...keys, ...retried.map((ticket) => runLockKey({ cwd: ticket.repository, issueUrl: ticket.issueUrl }))]) : keys;
    if (result) this.tickets = this.tickets.filter((ticket) => !answered.has(runLockKey({ cwd: ticket.repository, issueUrl: ticket.issueUrl })));
    if (result?.ok) {
      this.tickets = [...this.tickets, ...result.schedule.tickets.map((prediction) => ({ ...prediction, repository, analysis: "done" as const }))];
      const pair = (edge: { a: string; b: string }) => [ticketIdentity(edge.a), ticketIdentity(edge.b)].sort().join("\n");
      const replaced = new Set(result.schedule.edges.map(pair));
      this.edges = [...this.edges.filter((edge) => edge.repository !== repository || !replaced.has(pair(edge))), ...result.schedule.edges.map((edge) => ({ ...edge, repository }))];
    } else if (result) {
      this.tickets = [...this.tickets, ...pending.map((entry) => ({ issueUrl: entry.issueUrl, repository, analysis: "failed" as const, areas: [], files: [], failure: result.failure }))];
      broadcast({ type: "notice", level: "attention", at: now(), title: "Batch analysis failed", detail: `${path.basename(repository)}: ${result.failure}. ${pending.length > 1 ? `Its ${pending.length} tickets run` : "Its ticket runs"} one at a time, after the other tickets of the repository.` });
    }
    this.edges = overlayEdges(this.edges, stated);
    const analysed = new Set(pending.map((entry) => entry.id));
    this.queue = this.queue.map((entry) => { if (!analysed.has(entry.id)) return entry; const { analysing: _analysing, ...rest } = entry; return rest; });
    await this.drain();
  }

  /** The canned answer of the demonstration batch, after one step, so the "Analysis in progress" state shows. */
  private async demoAnalysis(urls: string[]): Promise<AnalysisResult> {
    await new Promise<void>((resolve) => this.later(demoStepDuration, resolve));
    const asked = new Set(urls);
    return { ok: true, schedule: {
      tickets: DEMO_BATCH.tickets.filter((ticket) => asked.has(ticket.issueUrl)).map(({ issueUrl, files, confidence, summary }) => ({ issueUrl, areas: [], files, confidence, summary })),
      edges: DEMO_BATCH.edges.filter((edge) => asked.has(edge.a) || asked.has(edge.b)),
    } };
  }

  private later(delay: number, callback: () => void) {
    const timer = setTimeout(() => { this.timers.delete(timer); callback(); }, delay);
    timer.unref?.();
    this.timers.add(timer);
  }

  /** The batch of the demonstration: three invented tickets, one conflict, no repository and no GitLab. */
  startDemoBatch() {
    if (this.shuttingDown) throw new Error("The application is shutting down.");
    const tickets = DEMO_BATCH.tickets.map((ticket) => ({ repository: DEMO_CWD, issueUrl: ticket.issueUrl }));
    if (admitBatch(tickets, this.takenTickets()).accepted.length === 0) throw new Error("The demo batch is already running.");
    const outcome = this.admit(tickets, "Demo mode, no repository will be modified.", { demo: true });
    void this.drain();
    return outcome;
  }

  /**
   * The simulated run, subject to the same ceilings: it takes a slot and it holds its own address.
   * `incident`: the scenario where the pilot hands back with nothing next, for the health detector.
   */
  startDemo(scenario: "workflow" | "incident" = "workflow") {
    if (this.shuttingDown) throw new Error("The application is shutting down.");
    const launch = demoLaunchState(scenario);
    if (this.holders().has(runLockKey(launch))) throw new Error("A demo is already running.");
    if (this.occupiedSlots() >= maxConcurrentRuns) throw new Error(`The harness already holds ${maxConcurrentRuns} runs. Free a slot before starting the demo.`);
    const session = this.register(new RunSession(`demo-${crypto.randomUUID().slice(0, 8)}`, launch));
    if (scenario === "incident") startIncidentDemoRun(session);
    else startDemoRun(session);
    this.publishSnapshot();
    return session;
  }

  private register(session: RunSession) {
    session.onChange = () => { this.noteRunEnd(session); this.publishSnapshot(); };
    session.onSignal = () => this.monitor.poke(session);
    this.sessions.set(session.id, session);
    return session;
  }

  /** Seen on every change of a run: the first one that finds its workflow over settles what waits behind it. */
  private noteRunEnd(session: RunSession) {
    if (this.settled.has(session.id) || runInProgress(session.state.status) || this.sessions.get(session.id) !== session) return;
    this.settled.add(session.id);
    this.runEnded(session);
  }

  /**
   * A run reached its end. With a merge request, the tickets in conflict with
   * it keep waiting, now for the merge: the merge request is watched. Without
   * one there is nothing to merge, so they are released, and told so.
   */
  private runEnded(session: RunSession) {
    const state = session.state;
    const repository = sourceRepository(state);
    const ticket = { cwd: repository, issueUrl: state.issueUrl };
    const key = runLockKey(ticket);
    const dependents = conflictingEntries(this.queue, ticket, this.context());
    const scheduled = this.tickets.some((known) => runLockKey({ cwd: known.repository, issueUrl: known.issueUrl }) === key);
    const mergeRequestUrl = state.mergeRequestUrl;
    if (mergeRequestUrl && (dependents.length > 0 || scheduled)) {
      const watch: MergeWatch = { issueUrl: ticketIdentity(state.issueUrl), repository, mergeRequestUrl, ...(state.branch ? { branch: state.branch } : {}), runId: session.id, state: "open", since: now() };
      this.watches = [...this.watches.filter((known) => runLockKey({ cwd: known.repository, issueUrl: known.issueUrl }) !== key), watch];
      // Nobody merges a simulated merge request: the demonstration does, a few steps later.
      if (isSimulatedTicket(watch.issueUrl)) this.later(demoStepDuration * DEMO_MERGE_STEPS, () => void this.applyMergeStatus(watch, "merged"));
    } else if (dependents.length > 0) {
      broadcast({ type: "notice", level: "info", at: now(), title: `Ticket finished without a ${forgeWords(forgeOf(state.issueUrl)).delivery}`, detail: `${path.basename(repository)} ${ticketReference(state.issueUrl)} opened no ${forgeWords(forgeOf(state.issueUrl)).delivery}: ${plural(dependents.length, "ticket no longer waits for it", "tickets no longer wait for it")}.` });
    }
    void this.drain();
  }

  /** What GitLab said of a watched merge request: merged or closed releases what it held, anything else keeps holding. */
  private async applyMergeStatus(watch: MergeWatch, status: MergeRequestStatus) {
    const current = this.watches.find((known) => known.mergeRequestUrl === watch.mergeRequestUrl);
    if (!current || this.shuttingDown) return;
    const step = mergeWatchStep(current, status, now());
    if (step.watch) {
      this.watches = this.watches.map((known) => known === current ? step.watch! : known);
      if (step.watch.state === current.state) return;
      await this.persistQueue();
      this.publishSnapshot();
      return;
    }
    const released = conflictingEntries(this.queue, { cwd: current.repository, issueUrl: current.issueUrl }, this.context()).length;
    this.watches = this.watches.filter((known) => known !== current);
    const subject = `${mergeRequestReference(current.mergeRequestUrl)} (${path.basename(current.repository)} ${ticketReference(current.issueUrl)})`;
    const delivery = forgeOf(current.mergeRequestUrl) === "github" ? "Pull request" : "Merge request";
    if (step.released === "merged") {
      if (released > 0) broadcast({ type: "notice", level: "info", at: now(), title: `${delivery} merged`, detail: `${subject}: ${plural(released, "ticket starts", "tickets start")} from the updated base.` });
    } else {
      broadcast({ type: "notice", level: "attention", at: now(), title: `${delivery} closed without being merged`, detail: `${subject}: ${plural(released, "ticket no longer waits for it and starts", "tickets no longer wait for it and start")} from the base.` });
    }
    await this.drain();
  }

  private async start(entry: QueuedRun) {
    if (entry.demo) {
      const session = this.register(new RunSession(`demo-${crypto.randomUUID().slice(0, 8)}`, demoBatchLaunchState(entry.issueUrl)));
      startDemoRun(session);
      return session;
    }
    const id = runIdentifier();
    const repository = sourceRepository(entry);
    // Registered before the worktree exists, so a second launch on the same
    // ticket sees this one while git is still working. `cwd` stays the
    // repository until the worktree is there: nothing may run in a path that is not.
    const session = this.register(new RunSession(id, {
      status: "starting", phase: 1, cwd: repository, repository, issueUrl: entry.issueUrl, instruction: entry.instruction, startedAt: now(),
      ...(entry.forced?.mode === "stacked" ? { baseBranch: entry.forced.baseBranch } : entry.baseBranch ? { ticketBaseBranch: entry.baseBranch } : {}),
    }));
    session.activity("system", "Session created", path.basename(repository));
    if (entry.forced?.mode === "stacked") session.activity("attention", "Stacked start", `On ${entry.forced.baseBranch}, the branch of ${ticketReference(entry.forced.onto)}: the ${forgeWords(forgeOf(entry.issueUrl)).delivery} will target this branch.`);
    else if (entry.forced) session.activity("attention", "Forced start from the base", "The batch schedule is ignored for this ticket.");
    if (entry.deliveries) session.activity("system", entry.deliveries.length > 1 ? "Ticket delivered in several repositories" : "Ticket delivered in another project", entry.deliveries.length > 1 ? `One ${forgeWords(forgeOf(entry.issueUrl)).delivery} in each of ${entry.deliveries.join(", ")}, one run each. None of them closes the ticket.` : `The ${forgeWords(forgeOf(entry.issueUrl)).delivery} goes to ${entry.deliveries[0]} and names the ticket by its full reference.`);
    if (entry.forced?.mode !== "stacked" && entry.baseBranch) session.activity("system", "Base named by the watcher", `The work starts from ${entry.baseBranch} and the ${forgeWords(forgeOf(entry.issueUrl)).delivery} targets it.`);
    session.publish();
    const abandon = async (message: string) => {
      await session.dispose().catch(reportFailure("Run not disposed", session.id));
      this.sessions.delete(id);
      this.publishSnapshot();
      return new Error(message);
    };
    let prepared: Awaited<ReturnType<typeof prepareRunWorktree>>;
    try {
      prepared = await prepareRunWorktree(repository, id);
    } catch (error) {
      // Never a silent fall back on the main checkout: the run does not start at all.
      const reason = error instanceof Error ? error.message.split("\n").filter(Boolean).pop() : String(error);
      throw await abandon(`The run worktree could not be created in ${repository}: ${reason}`);
    }
    const worktree = prepared.worktree.path;
    session.state.cwd = worktree;
    session.state.worktree = prepared.worktree;
    session.activity("system", "Worktree created", [worktree, prepared.summary].filter(Boolean).join(" · "));
    if (prepared.warning) session.activity("attention", "Dependencies not brought into the worktree", prepared.warning);
    if (prepared.stale) session.activity("attention", "Dependencies behind the lockfile, the workflow reinstalls them", prepared.stale.detail);
    if (prepared.unchecked) session.activity("attention", "Dependencies not checked against the lockfile", prepared.unchecked);
    session.publish();
    void fetchTicketTitle(entry.issueUrl, repository).then((title) => {
      if (!title) return;
      session.state.ticketTitle = title;
      session.publish();
    });
    const sourceBranch = await currentBranch(repository);
    // What the run is measured against later: the harness that drove it and the commit it started from.
    session.state.harness = await harnessVersion();
    session.state.baseCommit = await headCommit(worktree).catch(() => undefined);
    await clearTaskDirectory(worktree);
    if (await seedRuntimeRecipe(repository, worktree)) session.activity("system", "Runtime recipe restored", "Kept from a previous run of this repository.");
    const habits = await seedRecurringFindings(repository, worktree);
    if (habits) session.activity("system", "Recurring review findings restored", `${habits} ${habits > 1 ? "kinds" : "kind"} of defect the reviews of this repository keep finding.`);
    await mkdir(path.join(dataRoot, id), { recursive: true });
    await startArtifactWatcher(session);
    if (this.shuttingDown) {
      await discardRunWorktree(repository, worktree);
      throw await abandon("The application is shutting down.");
    }
    const command = engine.command(session.state.issueUrl, session.state.instruction);
    let terminalLogFailed = false;
    session.engine = engine.start({
      cwd: worktree, sessionLabel: path.basename(repository), runId: id, command, pluginDir: pluginRoot,
      hookUrl: `http://${hostname}:${port}/api/hooks?token=${hookToken}`,
      hookSpool: hookSpoolPath(id),
      // The workflow identifies the code it verified with the same utility the
      // console uses, and every snapshot it takes is logged where the console reads it.
      environment: {
        IMPL_CODE_SNAPSHOT: snapshotScript(pluginRoot),
        IMPL_SNAPSHOT_LOG: snapshotLogPath(id),
        IMPL_SNAPSHOT_EXCLUDE: snapshotExclusions(worktree).join(","),
        // Where the run works, and the checkout it was cut from: the workflow
        // stays in the first and never edits the second.
        IMPL_RUN_WORKTREE: worktree,
        IMPL_SOURCE_REPOSITORY: repository,
        ...(sourceBranch ? { IMPL_SOURCE_BRANCH: sourceBranch } : {}),
        ...(prepared.worktree.dependencies ? { IMPL_WORKTREE_DEPENDENCIES: prepared.worktree.dependencies } : {}),
        ...(prepared.stale ? { IMPL_WORKTREE_DEPENDENCIES_STALE: prepared.stale.directories.join(",") } : {}),
        // A stacked start: the workflow cuts its branch from this one and targets it, always from the run's own worktree.
        ...(entry.forced?.mode === "stacked" ? { IMPL_BASE_BRANCH: entry.forced.baseBranch } : {}),
        // The base the ticket's source named, typically its feature branch. A stacked start, on a branch already cut from it, wins.
        ...(entry.forced?.mode !== "stacked" && entry.baseBranch ? { IMPL_TICKET_BASE_BRANCH: entry.baseBranch } : {}),
        // The projects that get a merge request for this ticket when it is not only its own: the reference and the closing keyword depend on it.
        ...(entry.deliveries ? { IMPL_DELIVERY_PROJECTS: entry.deliveries.join(",") } : {}),
      },
      onData: (data) => {
        session.appendTerminal(data);
        // Given up at the first failure: a disk that is full would otherwise take one line of log per fragment.
        if (terminalLogFailed) return;
        appendFile(path.join(dataRoot, id, "terminal.log"), data).catch((error: unknown) => {
          if (!terminalLogFailed) reportFailure("Terminal log not written", id)(error);
          terminalLogFailed = true;
        });
      },
      onExit: (exitCode) => this.handleExit(session, exitCode),
      onEvent: (event) => applySessionEvent(session, event),
    });
    session.state.status = "running";
    session.state.sessionActive = true;
    session.activity("system", `${engine.label} started`, command);
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
    // A session that leaves on the folder trust prompt was refused it: the user's decision, not a crash.
    const trustRefused = closeSessionPrompt(session);
    // The workflow can already have closed the run, and how its idle session
    // then ends says nothing about the outcome it reached.
    const inProgress = runInProgress(session.state.status);
    const complete = !inProgress || declaredCompletion(session.state.workflow, session.state.mergeRequestUrl).complete;
    if (inProgress) {
      session.state.status = terminalExitStatus(exitCode, session.stoppedBy !== null || Boolean(trustRefused), complete);
      session.state.endedAt = now();
      if (trustRefused) session.state.error = trustRefused;
      else if (session.state.status === "failed") session.state.error = exitCode === 0
        ? `${engine.label} ended before the workflow reached a result.`
        : `${engine.label} stopped with code ${exitCode}.`;
    }
    session.activity("system", exitReport(session.stoppedBy, exitCode, complete, Boolean(trustRefused)), `Code ${exitCode}`);
    closeAgentsLeftBehind(session);
    session.publish();
    // Diagnosed before the self-audit reads the run, so a lost session reaches it as an incident.
    void this.monitor.evaluate(session).then(() => { if (!this.shuttingDown) scheduleAutonomousReview(session); });
    // Nothing works in the worktree any more: it goes if the run delivered, and is kept with its reason otherwise.
    if (this.shuttingDown) { this.keepWorktreeForRestart(session); void recordRunMetrics(session).catch(reportFailure("Run metrics not recorded", session.id)); }
    // Measured first: the size of the change is read in the worktree, which a delivered run then loses.
    else void session.serializeHealth(async () => { await recordRunMetrics(session).catch(reportFailure("Run metrics not recorded", session.id)); await settleRunWorktree(session); });
    // The ticket and the slot are free now, which is what the queue waits on.
    void this.drain();
  }

  /** A worktree left by a shutdown is decided at the next start, when git can be asked without racing the exit. */
  private keepWorktreeForRestart(session: RunSession) {
    const worktree = session.state.worktree;
    if (worktree?.state === "active") session.state.worktree = { ...worktree, state: "kept", detail: worktreeKeptDetail(["console stopped before the end of the run"]) };
  }

  /**
   * Removes the worktree of a run whose session is gone, live or read back
   * from its archive. One at a time per run, after whatever its health chain
   * already holds, so two windows asking together remove it once.
   */
  async removeWorktree(runId: string, force: boolean): Promise<WorktreeRemovalResult> {
    const session = this.readable(runId);
    if (!session) return { outcome: "refused", message: "This run no longer exists." };
    const result = await session.serializeHealth(() => removeWorktreeOnRequest(session, force));
    if (session.state.archived) {
      await session.persist();
      this.archive.release(session.id);
      this.publishSnapshot();
    }
    return result;
  }

  stop(runId: string) {
    const session = this.expect(runId);
    if (session.demo) {
      session.clearDemoTimers();
      session.state.pendingQuestion = undefined;
      session.state.action = undefined;
      session.state.status = "stopped";
      session.state.endedAt = now();
      session.activity("system", "Demo stopped");
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
    if (session.holdsRepository) throw new Error("This run still holds its session. Stop it before closing the run.");
    // Removing the run is the user closing its case: an incident left open would bring it back as an archive at the next start.
    await session.serializeHealth(async () => {
      const at = now();
      const incidents = session.state.incidents ?? [];
      if (!incidents.some((incident) => incident.status === "open")) return;
      session.state.incidents = incidents.map((incident) => incident.status === "open"
        ? { ...incident, status: "dismissed" as const, revision: incident.revision + 1, updatedAt: at, resolution: { at, outcome: "Run removed from the list" } }
        : incident);
      await session.persist();
    });
    // The exit of the session may still be deciding what becomes of the worktree.
    await session.serializeHealth(() => settleRunWorktree(session));
    await closeArtifactWatcher(session);
    await closeTranscript(session);
    await session.persist();
    await session.dispose();
    this.sessions.delete(runId);
    this.settled.delete(runId);
    // A worktree still on disk keeps its run within reach, or nothing would offer its removal before the next start.
    const adopted = session.state.worktree?.state === "kept" ? this.archive.adopt(session.archivedState(), session.acceptanceView) : undefined;
    if (adopted) broadcastToViewers(runId, { type: "run", state: adopted.state });
    this.publishSnapshot();
    await this.drain();
  }

  sendInstruction(runId: string, text: string) {
    const session = this.expect(runId);
    const instruction = text.trim();
    if (!instruction) throw new Error("The instruction is empty.");
    if (!session.engine && !session.demo) throw new Error(`No ${engine.label} session is active.`);
    session.engine?.submit(instruction);
    // The user gave the pilot something to do: it is no longer sitting at its prompt for nothing.
    if (session.engine) pilotActs(session.signals, Date.now());
    session.markProgress();
    session.conversationMessage({ id: `local-${crypto.randomUUID()}`, at: now(), author: "user", text: instruction, pending: session.engine !== null });
    session.activity("system", "Instruction sent", instruction);
    session.publish();
    session.signal();
    if (!session.engine) acknowledgeDemoInstruction(session);
  }

  /**
   * An action on an incident, checked again against the state the server holds
   * right before its effect. The decision is written before the effect and its
   * outcome after it: a crash in between leaves "outcome unknown", never a replay.
   */
  async incidentAction(request: IncidentActionRequest): Promise<IncidentActionResult> {
    const session = this.readable(request.runId);
    if (!session) return { outcome: "refused", message: "This run no longer exists." };
    return session.serializeHealth(async () => {
      const answered = session.answeredRequests.get(request.requestId);
      if (answered) return { outcome: "duplicate" as const, message: answered.message };
      const live = !session.state.archived && this.sessions.get(session.id) === session;
      const incident = session.state.incidents?.find((entry) => entry.id === request.incidentId);
      const check = checkIncidentAction({ ...request, incident, live, ...(live ? { input: healthInput(session) } : {}) });
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
        current = { ...current, status: "dismissed", resolution: { at, outcome: "Dismissed as a false positive", ...defined({ detail: request.reason?.trim() }) } };
        session.activity("system", `Incident dismissed as a false positive: ${current.title}`, request.reason?.trim());
        message = "Incident dismissed as a false positive.";
      } else if (request.action === "stop") {
        this.stop(session.id);
        session.activity("system", "Stop requested from the incident", current.title);
        message = "Stop requested.";
      } else {
        if (session.engine) session.engine.submit(CONTINUATION_INSTRUCTION);
        current = { ...current, continuation: { requestedAt: at, requestId: request.requestId } };
        session.conversationMessage({ id: `local-${crypto.randomUUID()}`, at, author: "user", text: CONTINUATION_INSTRUCTION, pending: session.engine !== null });
        session.activity("system", "Continuation requested", current.title);
        if (session.demo) resumeDemoAfterContinuation(session);
        message = "Continuation requested. The incident will close when the resumption is observed.";
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
    if (remaining.length === this.queue.length) throw new Error("This request is no longer queued.");
    this.queue = remaining;
    // What it was ahead of may no longer have anything to wait for.
    void this.drain();
  }

  private queued(queuedId: string) {
    const entry = this.queue.find((candidate) => candidate.id === queuedId);
    if (!entry) throw new Error("This request is no longer queued.");
    return entry;
  }

  /**
   * Starts a held ticket anyway, as soon as a place is free and nothing else
   * runs on that same ticket. `base`: from the base branch, whatever the
   * schedule says. `stacked`: on the branch of the ticket it waits for, which
   * has to exist already.
   */
  forceQueued(queuedId: string, mode: "base" | "stacked", onto?: string) {
    const entry = this.queued(queuedId);
    let forced: QueuedRun["forced"] = { mode: "base" };
    if (mode === "stacked") {
      const target = onto ?? this.describe().find((view) => view.id === queuedId)?.blocking?.issueUrl;
      if (!target) throw new Error("This ticket is not waiting for any other ticket: there is no branch to stack it on.");
      const key = runLockKey({ cwd: entry.repository, issueUrl: target });
      const branch = [...this.sessions.values()].find((session) => runLockKey(session.state) === key)?.state.branch
        ?? this.watches.find((watch) => runLockKey({ cwd: watch.repository, issueUrl: watch.issueUrl }) === key)?.branch;
      if (!branch) throw new Error(`The branch of ${ticketReference(target)} is not known yet: a stacked start is not possible.`);
      forced = { mode: "stacked", baseBranch: branch, onto: ticketIdentity(target) };
    }
    this.queue = this.queue.map((candidate) => candidate === entry ? { ...entry, forced } : candidate);
    void this.drain();
  }

  /** Moves a waiting launch right before another one, or to the end. A dependency still goes before the ticket that needs it. */
  moveQueued(queuedId: string, before: string | null) {
    const entry = this.queued(queuedId);
    const others = this.queue.filter((candidate) => candidate !== entry);
    const position = before === null ? others.length : others.findIndex((candidate) => candidate.id === before);
    if (position < 0) throw new Error("This request is no longer queued.");
    this.queue = [...others.slice(0, position), entry, ...others.slice(position)];
    void this.drain();
  }

  /**
   * Starts everything the freed room allows, in the order the launches were
   * asked for. An entry whose ticket is still held is stepped over rather than
   * blocking the ones behind it: it is waiting on a different run, and holding
   * the whole queue for it would leave free slots idle.
   */
  async drain() {
    // PTY exit callbacks may arrive while shutdown is persisting the final state.
    if (this.shuttingDown) return;
    for (;;) {
      if (this.shuttingDown) break;
      const [entry] = startableEntries(this.queue, this.holders(), this.context(), maxConcurrentRuns - this.occupiedSlots());
      if (!entry) break;
      this.queue = this.queue.filter((candidate) => candidate.id !== entry.id);
      try {
        await this.start(entry);
      } catch (error) {
        broadcast({ type: "notice", level: "attention", title: "Queued run not started", detail: error instanceof Error ? error.message : String(error), at: now() });
      }
    }
    if (this.shuttingDown) return;
    this.releaseFinishedSessions();
    this.prune();
    this.mergeWatcher.sync();
    await this.persistQueue();
    this.publishSnapshot();
  }

  /** Forgets what the schedule no longer needs: tickets that left the console, and merge requests nothing has waited on for a week. */
  private prune() {
    const held = new Set(heldWatches(this.queue, this.context()));
    this.watches = this.watches.filter((watch) => held.has(watch) || Date.now() - Date.parse(watch.since) < WATCH_RETENTION_MS);
    const live = new Set(this.takenTickets());
    for (const session of this.sessions.values()) if (runInProgress(session.state.status)) live.add(runLockKey(session.state));
    ({ tickets: this.tickets, edges: this.edges } = pruneSchedule(this.tickets, this.edges, live));
  }

  /**
   * Closes the sessions of the finished runs the queue is waiting on. The kill
   * is asynchronous: the entries they were blocking start from the exit of each
   * session, which drains the queue again.
   */
  private releaseFinishedSessions() {
    const runs = [...this.sessions.values()].map((session) => ({ id: session.id, cwd: session.state.cwd, ...defined({ repository: session.state.repository }), issueUrl: session.state.issueUrl, status: session.state.status, sessionActive: session.state.sessionActive }));
    // An entry the schedule holds waits for a merge, not for a session: no session is closed for it.
    const waiting = this.describe().filter((view) => view.reason === "ticket");
    for (const runId of sessionsToReleaseForQueue(runs, waiting)) {
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
    if (!session) throw new Error("This run no longer exists.");
    return session;
  }

  /** The queue and its schedule, written whole and renamed into place, one write after the other. */
  private persistQueue() {
    const content = JSON.stringify(storedQueue({ queue: this.queue, tickets: this.tickets, edges: this.edges, watches: this.watches }), null, 2);
    this.queueWrites = this.queueWrites.then(async () => {
      await mkdir(path.dirname(queueFile), { recursive: true });
      await writeFile(`${queueFile}.tmp`, content);
      await rename(`${queueFile}.tmp`, queueFile);
    }).catch(reportFailure("Queue not saved", queueFile));
    return this.queueWrites;
  }

  /**
   * The launches accepted before the console went down, with the schedule they
   * were held by. What was only waiting for a place starts as soon as the
   * server is listening; what waits for a merge request keeps waiting for it.
   */
  async restoreQueue() {
    let stored: unknown = [];
    // Only a missing file means no queue was left. One that cannot be read is kept
    // aside before the next write replaces it with whatever is queued by then.
    try { stored = JSON.parse(await readFile(queueFile, "utf8")) as unknown; }
    catch (error) {
      if (!isMissingFile(error)) {
        const aside = `${queueFile}.unreadable-${Date.now()}`;
        await rename(queueFile, aside).catch(reportFailure("Unreadable queue not kept aside", queueFile));
        reportFailure("Queue unreadable, started empty", `kept as ${path.basename(aside)}`)(error);
      }
    }
    ({ queue: this.queue, tickets: this.tickets, edges: this.edges, watches: this.watches } = restoreQueueFile(stored));
    // The sessions that were writing there are gone with the process that started them.
    await clearScheduleFiles();
  }

  async shutdown() {
    this.shuttingDown = true;
    this.monitor.stop();
    this.mergeWatcher.stop();
    this.proposals.stop();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    // Their tickets stay marked as being analysed, which the next start reads as a failed analysis.
    for (const session of this.analysisSessions) session.kill();
    for (const session of this.sessions.values()) {
      session.stoppedBy = "user";
      if (runInProgress(session.state.status)) {
        session.state.status = "stopped";
        session.state.endedAt = now();
        session.activity("system", "Session stopped when the application closed");
      }
      session.state.sessionActive = false;
      session.state.action = undefined;
      session.state.sessionPrompt = undefined;
      this.keepWorktreeForRestart(session);
      clearPendingQuestion(session);
      closeAgentsLeftBehind(session);
      await session.dispose().catch(reportFailure("Run not disposed", session.id));
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
  session.activity("agent", abandoned.length === 1 ? "One agent never reported its end" : `${abandoned.length} agents never reported their end`, abandoned.map((agent) => agent.name).join(" · "));
}

export const registry = new RunRegistry();
