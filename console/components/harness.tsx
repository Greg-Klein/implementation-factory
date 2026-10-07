"use client";

import { CodeIcon, MoonIcon, SpeakerHighIcon, SpeakerSlashIcon, SunIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { launchAnswer } from "@/lib/launch";
import { documentTitle, faviconColor, faviconDataUri, runAlerts } from "@/lib/notifications";
import { isWriting, noticeIsStale, sessionAlive, sourceRepository } from "@/lib/run-state";
import { isSoundEnabled, playCue, setSoundEnabled, unlockSound } from "@/lib/sound";
import { appendTerminalOutput } from "@/lib/terminal-output";
import { parseTicketUrl, parseTicketUrls } from "@/lib/ticket-urls";
import { applyTheme, followSystemTheme, setStoredTheme, storedTheme, systemTheme, type Theme } from "@/lib/theme";
import type { HarnessSnapshot, IncidentResult, Notice, PendingImprovementsResponse, PendingSelfImprovementReview, RepositoryOption, RepositoryResponse, RunState, RunSummary, ServerMessage, UnresolvedTicket, WorktreeResult } from "@/lib/types";
import { LaunchForm } from "./launch-form";
import { MetricsPanel } from "./metrics-panel";
import { NoticeStrip } from "./notice-strip";
import { RecipeDialog } from "./recipe-dialog";
import { RunRail } from "./run-rail";
import { RunView, type RefusedFeedback } from "./run-view";
import { SelfImprovementReviewPanel } from "./self-improvement-review-panel";
import type { TerminalHandle } from "./terminal-panel";

function batchNotice(accepted: number, duplicates: number): Notice {
  const left = duplicates > 0 ? ` ${duplicates} already queued, running or waiting for merge ${duplicates > 1 ? "were skipped" : "was skipped"}.` : "";
  return { level: "info", at: new Date().toISOString(), title: "Batch queued", detail: `${accepted} ticket${accepted > 1 ? "s" : ""} added. The queue shows which start and which wait.${left}` };
}
// Independent of any run, so a slow improvement agent is caught however long it takes.
const PENDING_IMPROVEMENTS_POLL_MS = 20_000;

/** `crypto.randomUUID` only exists in a secure context, and a console reached by its network address is not one. */
function requestIdentifier() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Said when a command could not leave the page: nothing was sent, so nothing is shown as done. */
const NOT_CONNECTED = "Not connected to the console. Nothing was sent. Try again in a moment.";

const emptySnapshot: HarnessSnapshot = { runs: [], queued: [], maxConcurrentRuns: 1, archived: [] };

export function Harness() {
  const [snapshot, setSnapshot] = useState<HarnessSnapshot>(emptySnapshot);
  const [run, setRun] = useState<RunState | null>(null);
  const [connected, setConnected] = useState(false);
  const [cwd, setCwd] = useState("");
  const [issueUrl, setIssueUrl] = useState("");
  const [instruction, setInstruction] = useState("");
  /** The ticket field holds one URL or several: two or more are sent as a batch. */
  const parsedTickets = useMemo(() => parseTicketUrls(issueUrl), [issueUrl]);
  const singleTicket = parsedTickets.tickets.length + parsedTickets.invalid.length <= 1;
  const [repositories, setRepositories] = useState<RepositoryOption[]>([]);
  const [pendingImprovements, setPendingImprovements] = useState<PendingSelfImprovementReview[]>([]);
  const [detectedProject, setDetectedProject] = useState<string>();
  const [detectingProject, setDetectingProject] = useState(false);
  /** The project of the single ticket in the field when no checkout of it was found: the user then chooses where its merge requests go. */
  const [missedProject, setMissedProject] = useState<string>();
  /** The checkouts chosen per ticket URL, for the tickets that have none of their own. */
  const [targets, setTargets] = useState<Record<string, string[]>>({});
  /** The tickets of the last batch the server could not place, as long as they are still in the field. */
  const [unresolved, setUnresolved] = useState<UnresolvedTicket[]>([]);
  const pendingUnresolved = useMemo(() => unresolved.filter((ticket) => parsedTickets.tickets.includes(ticket.issueUrl)), [unresolved, parsedTickets]);
  const chooseTargets = useCallback((ticketUrl: string, paths: string[]) => setTargets((current) => ({ ...current, [ticketUrl]: paths })), []);
  const [notice, setNotice] = useState<Notice>();
  const [error, setError] = useState<string>();
  /** What became of the last incident action this page sent: a refusal is said next to the incident, not in a banner. */
  const [incidentResult, setIncidentResult] = useState<IncidentResult>();
  /** What the server answered to a worktree removal: a confirmation to give, or a refusal. */
  const [worktreeResult, setWorktreeResult] = useState<WorktreeResult>();
  /** The repository whose runtime recipe is open, and a count that moves each time the server answered a request to forget one. */
  const [recipeRepository, setRecipeRepository] = useState<string>();
  const [recipeRevision, setRecipeRevision] = useState(0);
  // Read after mount: the server renders this page and has no localStorage.
  const [sound, setSound] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [writing, setWriting] = useState(false);
  const cwdRef = useRef("");
  const lastOutputRef = useRef(0);
  const demoStartedRef = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<TerminalHandle>(null);
  /**
   * The output replayed on opening a run arrives with the run itself, before
   * React has mounted the view that holds the terminal. Kept until it mounts.
   */
  const pendingOutputRef = useRef("");
  const attachTerminal = useCallback((handle: TerminalHandle | null) => {
    terminalRef.current = handle;
    if (handle && pendingOutputRef.current) { handle.write(pendingOutputRef.current); pendingOutputRef.current = ""; }
  }, []);
  const clearTerminal = useCallback(() => {
    pendingOutputRef.current = "";
    terminalRef.current?.clear();
  }, []);
  const previousRunsRef = useRef<RunSummary[]>([]);
  /**
   * The run this page is showing. Held in a ref as well as in state because the
   * socket handler reads it: the server only pushes a run to the pages that
   * opened it, and a message still in flight for the previous one must not
   * overwrite the one the user just clicked.
   */
  const openRunRef = useRef<string | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  /**
   * The request id of the launch this page sent and has no answer to yet. The
   * page opens the run the server names with that id and no other: the server
   * answers the messages of one connection out of order, so the next run state
   * to arrive may be that of a run opened in the meantime. In a ref for the
   * socket handler, in state for the button that would send a second launch.
   */
  const pendingLaunchRef = useRef<string | undefined>(undefined);
  const [launching, setLaunching] = useState(false);
  const setPendingLaunch = useCallback((requestId: string | undefined) => {
    pendingLaunchRef.current = requestId;
    setLaunching(requestId !== undefined);
  }, []);
  /**
   * The user asked for the launch form and is looking at it. Without this, the
   * rule below would reopen the only run of the console the instant they asked
   * to start a second one. It holds until the launch is answered, for the same reason.
   */
  const [composingRun, setComposingRun] = useState(false);
  /** The table of measures covers the run view, which stays mounted under it: it is about every run, not the open one. */
  const [showMetrics, setShowMetrics] = useState(false);
  /** The feedback last sent, kept until the next one: the server says nothing when it saves it, and names it when it refuses it. */
  const sentFeedbackRef = useRef<RefusedFeedback | undefined>(undefined);
  const [refusedFeedback, setRefusedFeedback] = useState<RefusedFeedback>();

  const openRun = useCallback((runId: string | null) => {
    openRunRef.current = runId;
    setOpenRunId(runId);
    setComposingRun(runId === null);
    setShowMetrics(false);
    if (runId === null) setRun(null);
    setWorktreeResult(undefined);
    clearTerminal();
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "run.subscribe", runId }));
  }, []);

  const clearLaunchForm = useCallback(() => {
    cwdRef.current = "";
    setCwd("");
    setDetectedProject(undefined);
    setIssueUrl("");
    setInstruction("");
    setTargets({});
    setUnresolved([]);
  }, []);
  const clearLaunchFormRef = useRef(clearLaunchForm);

  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socketRef.current = socket;
      socket.onopen = () => {
        if (socketRef.current !== socket) return;
        setConnected(true);
        setError((current) => (current === NOT_CONNECTED ? undefined : current));
        // A reconnection has to say again which run this page is reading.
        if (openRunRef.current) socket.send(JSON.stringify({ type: "run.subscribe", runId: openRunRef.current }));
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === "harness") setSnapshot(message.snapshot);
        const answer = launchAnswer(pendingLaunchRef.current, message);
        if (answer) setPendingLaunch(undefined);
        // A refusal is read on the form that has to be corrected. A queued launch is no longer being
        // composed: the page goes back to the only run of the console, or opens this one if it starts alone.
        if (answer?.outcome === "queued") setComposingRun(false);
        if (answer?.outcome === "started") {
          // What the run printed before this page was told about it reached no one:
          // asking for the run replays it.
          pendingOutputRef.current = "";
          terminalRef.current?.clear();
          openRunRef.current = answer.runId;
          setOpenRunId(answer.runId);
          setComposingRun(false);
          setShowMetrics(false);
          setWorktreeResult(undefined);
          socket.send(JSON.stringify({ type: "run.subscribe", runId: answer.runId }));
        }
        if (message.type === "run" && message.state.id === openRunRef.current) setRun(message.state);
        if (message.type === "terminal.output" && message.runId === openRunRef.current) {
          lastOutputRef.current = Date.now();
          if (terminalRef.current) terminalRef.current.write(message.data);
          else pendingOutputRef.current = appendTerminalOutput(pendingOutputRef.current, message.data);
        }
        if (message.type === "notice") setNotice({ level: message.level, title: message.title, detail: message.detail, at: message.at });
        if (message.type === "error") {
          setError(message.message);
          const feedback = sentFeedbackRef.current;
          if (feedback && message.requestId === feedback.requestId) setRefusedFeedback(feedback);
        }
        // The batch went in: the form is free for the next one, and the queue says the rest.
        if (message.type === "batch.result") { clearLaunchFormRef.current(); setNotice(batchNotice(message.accepted, message.duplicates.length)); }
        if (message.type === "batch.unresolved") setUnresolved(message.tickets);
        if (message.type === "worktree.result") setWorktreeResult({ runId: message.runId, outcome: message.outcome, message: message.message, risks: message.risks });
        if (message.type === "recipe.result" || message.type === "findings.result") setRecipeRevision((revision) => revision + 1);
        if (message.type === "incident.result") setIncidentResult({ incidentId: message.incidentId, requestId: message.requestId, outcome: message.outcome, message: message.message });
      };
      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        setConnected(false);
        // The answer to a launch only comes on the connection that sent it. The page stops waiting for it:
        // the list of runs says what became of the launch, and the form can send another.
        if (pendingLaunchRef.current) { setPendingLaunch(undefined); setComposingRun(false); }
        if (!disposed) retry = setTimeout(connect, 1200);
      };
    };
    const initialConnection = window.setTimeout(connect, 0);
    return () => { disposed = true; window.clearTimeout(initialConnection); if (retry) clearTimeout(retry); socketRef.current?.close(); };
  }, [setPendingLaunch]);

  // A run the console no longer holds cannot stay open in front of the user.
  useEffect(() => {
    if (!openRunId || snapshot.runs.some((summary) => summary.id === openRunId) || snapshot.archived?.some((summary) => summary.id === openRunId)) return;
    openRun(null);
    clearLaunchForm();
  }, [snapshot.runs, openRunId, openRun, clearLaunchForm]);

  // The queue itself says what is still waiting, so a message announcing a wait
  // goes as soon as the wait does, without the user having to close it.
  useEffect(() => {
    if (noticeIsStale(notice, snapshot.queued)) setNotice(undefined);
  }, [snapshot.queued, notice]);

  /**
   * A page showing nothing, next to a console holding exactly one run, is
   * showing the wrong thing: that run is what the user came for, and a reload
   * or a second tab would otherwise land on the launch form. Only for a single
   * run: with several, picking one for the user would be guessing.
   */
  useEffect(() => {
    const only = snapshot.runs.length === 1 ? snapshot.runs[0] : undefined;
    if (openRunId !== null || composingRun || !only) return;
    openRun(only.id);
  }, [snapshot.runs, openRunId, composingRun, openRun]);

  const refreshPendingImprovements = useCallback(() => {
    fetch("/api/self-improvement/pending")
      .then((response) => response.json() as Promise<PendingImprovementsResponse>)
      .then((result) => setPendingImprovements(result.items ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshPendingImprovements();
    const timer = window.setInterval(refreshPendingImprovements, PENDING_IMPROVEMENTS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshPendingImprovements]);

  // A ticket with no checkout makes the page ask where its merge requests go: the list is read again then, so a repository cloned since the page opened can be picked.
  const choosingTargets = pendingUnresolved.length > 0 || (snapshot.proposals ?? []).some((proposal) => proposal.refusal);
  useEffect(() => {
    const controller = new AbortController();
    fetch(choosingTargets ? "/api/repositories?fresh" : "/api/repositories", { signal: controller.signal })
      .then((response) => response.json() as Promise<RepositoryResponse>)
      .then((result) => setRepositories(result.repositories))
      .catch(() => undefined);
    return () => controller.abort();
  }, [choosingTargets]);

  useEffect(() => {
    setMissedProject(undefined);
    // A batch resolves each ticket to its own checkout on the server: nothing to detect here.
    if (!singleTicket || !parseTicketUrl(issueUrl) || cwdRef.current.trim()) {
      setDetectingProject(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setDetectingProject(true);
      fetch(`/api/repositories?issueUrl=${encodeURIComponent(issueUrl.trim())}`, { signal: controller.signal })
        .then((response) => response.json() as Promise<RepositoryResponse>)
        .then((result) => {
          setRepositories(result.repositories);
          if (result.detected && !cwdRef.current.trim()) {
            cwdRef.current = result.detected.path;
            setCwd(result.detected.path);
            setDetectedProject(result.detected.project);
          }
          if (!result.detected && !cwdRef.current.trim()) setMissedProject(parseTicketUrl(issueUrl)?.project);
        })
        .catch(() => undefined)
        .finally(() => { if (!controller.signal.aborted) setDetectingProject(false); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [issueUrl, singleTicket]);

  /**
   * The tab, the favicon and the alerts speak for every run at once, not for the
   * one on screen: the run that needs the user is rarely the one they are
   * reading, and an alert raised only for the open run left the others silent.
   * The title is the `<title>` rendered below, not written here.
   */
  useEffect(() => {
    const previous = previousRunsRef.current;
    previousRunsRef.current = snapshot.runs;
    const icon = document.querySelector<HTMLLinkElement>("link[rel='icon']") ?? document.head.appendChild(Object.assign(document.createElement("link"), { rel: "icon" }));
    icon.href = faviconDataUri(faviconColor(snapshot.runs));
    for (const alert of runAlerts(previous, snapshot.runs)) {
      playCue(alert.cue);
      if (!document.hidden || typeof Notification === "undefined" || Notification.permission !== "granted") continue;
      new Notification(alert.title, { body: alert.body, tag: alert.tag });
    }
  }, [snapshot.runs]);

  useEffect(() => {
    const alive = run ? sessionAlive(run.status, run.sessionActive) : false;
    if (!alive) { setWriting(false); return; }
    const timer = window.setInterval(() => setWriting(isWriting(alive, lastOutputRef.current, Date.now())), 500);
    return () => window.clearInterval(timer);
  }, [run?.status, run?.sessionActive]);

  useEffect(() => {
    setSound(isSoundEnabled());
    const unlock = () => unlockSound();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    setTheme(storedTheme() ?? systemTheme());
    return followSystemTheme(setTheme);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setStoredTheme(next);
    setTheme(next);
  };

  /** Turning it on plays the cue straight away, so the setting proves itself. */
  const toggleSound = () => {
    const enabled = !sound;
    setSoundEnabled(enabled);
    setSound(enabled);
    if (enabled) { unlockSound(); playCue("attention"); }
  };

  /** Whether the message was written to an open connection. Nothing queues it otherwise: it is lost. */
  const send = useCallback((message: object) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return false;
    socketRef.current.send(JSON.stringify(message));
    return true;
  }, []);
  /** A gesture of the user: when it could not leave, they are told, and the caller shows nothing as done. */
  const command = useCallback((message: object) => {
    const sent = send(message);
    if (!sent) setError(NOT_CONNECTED);
    return sent;
  }, [send]);

  /** Sends a launch that creates one run and waits for its answer on the form, where a refusal is read. */
  const launch = useCallback((message: object) => {
    const requestId = requestIdentifier();
    setComposingRun(true);
    if (command({ ...message, requestId })) setPendingLaunch(requestId);
  }, [command, setPendingLaunch]);

  useEffect(() => {
    const demo = new URLSearchParams(window.location.search).get("demo");
    if (!connected || demoStartedRef.current || (demo !== "1" && demo !== "incident" && demo !== "batch")) return;
    demoStartedRef.current = true;
    // The batch of the demonstration opens no run: its tickets show in the queue, then in the list.
    if (demo === "batch") { setComposingRun(true); command({ type: "demo.start", scenario: demo }); }
    else launch({ type: "demo.start", ...(demo === "1" ? {} : { scenario: demo }) });
    window.history.replaceState({}, "", window.location.pathname);
  }, [connected, command, launch]);

  // The strip goes only once the decision left the page: removed before, it came
  // back at the next poll and invited a second click on a merge already asked for.
  const approveImprovement = useCallback((worktreeName: string) => {
    if (command({ type: "selfImprovement.approve", worktreeName })) setPendingImprovements((items) => items.filter((item) => item.worktreeName !== worktreeName));
  }, [command]);
  const rejectImprovement = useCallback((worktreeName: string) => {
    if (command({ type: "selfImprovement.reject", worktreeName })) setPendingImprovements((items) => items.filter((item) => item.worktreeName !== worktreeName));
  }, [command]);

  const changeCwd = useCallback((value: string, project?: string) => {
    cwdRef.current = value;
    setCwd(value);
    setDetectedProject(project);
  }, []);

  const newRun = useCallback(() => {
    openRun(null);
    clearLaunchForm();
    setError(undefined);
  }, [openRun, clearLaunchForm]);

  const start = () => {
    setError(undefined);
    if (parsedTickets.tickets.length > 1) {
      // Stays on the form: a batch starts several runs, or none yet, and the list shows them.
      setComposingRun(true);
      unlockSound();
      if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
      command({ type: "batch.submit", issueUrls: parsedTickets.tickets, instruction, targets: Object.fromEntries(pendingUnresolved.map((ticket) => [ticket.issueUrl, targets[ticket.issueUrl] ?? []])) });
      return;
    }
    const ticketUrl = parsedTickets.tickets[0];
    const chosen = missedProject && ticketUrl ? targets[ticketUrl] ?? [] : [];
    if (ticketUrl && chosen.length > 1) {
      // One run per repository: like a batch, the list shows them and the form stays.
      setComposingRun(true);
      unlockSound();
      command({ type: "batch.submit", issueUrls: [ticketUrl], instruction, targets: { [ticketUrl]: chosen } });
      return;
    }
    unlockSound();
    if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
    launch({ type: "run.start", cwd: chosen[0] ?? cwd, issueUrl: issueUrl.trim(), instruction });
  };

  // One line is sent as it is, and the server says what is wrong with it; a batch goes only when every line is a ticket.
  const singleTicketUrl = parsedTickets.tickets[0];
  const targetsMissing = singleTicket
    ? Boolean(missedProject) && !cwd.trim() && ((singleTicketUrl ? targets[singleTicketUrl] : undefined) ?? []).length === 0
    : pendingUnresolved.some((ticket) => (targets[ticket.issueUrl] ?? []).length === 0);
  const canStart = connected && !launching && issueUrl.trim().length > 0 && (singleTicket || parsedTickets.invalid.length === 0) && !targetsMissing;
  const runId = run?.id ?? "";

  return (
    <main className="min-h-[100dvh] bg-[var(--paper)] p-3 md:p-5">
      {/* The only title of the page. One written to `document.title` beside a title of the layout's metadata was put back to the bare name when that one hydrated late, and stayed so until the list of runs changed again. */}
      <title>{documentTitle(snapshot.runs)}</title>
      {/* A sidebar of runs on the left, the one that is open on the right. */}
      <div className="mx-auto grid max-w-425 grid-cols-1 items-start gap-3 lg:grid-cols-[224px_minmax(0,1fr)] lg:gap-4">
        <RunRail
          runs={snapshot.runs}
          queued={snapshot.queued}
          archived={snapshot.archived}
          proposals={snapshot.proposals}
          repositories={repositories}
          maxConcurrentRuns={snapshot.maxConcurrentRuns}
          selectedRunId={openRunId}
          onOpen={openRun}
          onNew={newRun}
          metricsOpen={showMetrics}
          onMetrics={() => setShowMetrics((shown) => !shown)}
          onClose={(closedRunId) => { command({ type: "run.close", runId: closedRunId }); }}
          queueActions={{
            cancel: (queuedId) => { command({ type: "queue.cancel", queuedId }); },
            force: (queuedId, mode, onto) => { command({ type: "queue.force", queuedId, mode, ...(onto ? { onto } : {}) }); },
            move: (queuedId, before) => { command({ type: "queue.move", queuedId, before }); },
          }}
          proposalActions={{
            dismiss: (issueUrls) => { command({ type: "proposal.dismiss", issueUrls }); },
            launch: (proposalUrl, paths) => command({ type: "proposal.launch", issueUrl: proposalUrl, repositories: paths }),
          }}
        />

        <div className="flex min-w-0 flex-col overflow-hidden rounded-6.5 border border-[var(--line)] bg-[var(--surface)] shadow-[0_26px_70px_-42px_rgba(38,50,43,.42)] lg:h-[calc(100dvh-40px)]">
          <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-[var(--line)] px-5 md:px-7">
            <div className="flex items-center gap-3">
              <div className="grid size-8 place-items-center rounded-2.5 bg-[var(--ink)] text-[var(--on-ink)]"><CodeIcon size={18} weight="bold" /></div>
              <div>
                <h1 className="text-[15px] font-semibold tracking-[-.02em]">Implementation Harness</h1>
                <p className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]"><span className="hidden sm:inline">Claude Code workflow harness</span><span aria-hidden="true" className="hidden text-[var(--line)] sm:inline">/</span><span className="text-[var(--faint)]">by Gregory Klein</span></p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <button type="button" role="switch" aria-checked={theme === "dark"} aria-label="Dark theme" onClick={toggleTheme} title={theme === "dark" ? "Dark theme, click to switch to light" : "Light theme, click to switch to dark"} className="mr-1 grid size-7 place-items-center rounded-lg border border-[var(--line)] text-[var(--muted)] transition hover:bg-[var(--raised)] hover:text-[var(--ink)] active:translate-y-px">
                {theme === "dark" ? <SunIcon size={14} /> : <MoonIcon size={14} />}
              </button>
              <button type="button" role="switch" aria-checked={sound} aria-label="Alert sound" onClick={toggleSound} title={sound ? "Alert sound on, click to mute" : "Alert sound off, click to turn on"} className={`mr-1 grid size-7 place-items-center rounded-lg border border-[var(--line)] transition hover:bg-[var(--raised)] active:translate-y-px ${sound ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>
                {sound ? <SpeakerHighIcon size={14} /> : <SpeakerSlashIcon size={14} />}
              </button>
              <span title="Live connection between this page and the local server of the harness" className={`size-1.5 rounded-full ${connected ? "bg-[var(--accent)] status-breathe" : "bg-red-500"}`} />
              <span className="hidden sm:inline">Local server</span><span aria-hidden="true" className="hidden text-[var(--line)] sm:inline">·</span><span className={connected ? "text-[var(--accent)]" : "text-red-600"}>{connected ? "connected" : "reconnecting…"}</span>
            </div>
          </header>

          <div className="shrink-0">
            {error && (
              <div role="alert" className="flex items-start justify-between gap-3 border-b border-red-200 bg-red-50 px-5 py-3 text-red-800 md:px-7">
                <p className="flex min-w-0 items-start gap-2.5 text-[11px] leading-5"><WarningIcon className="mt-0.5 shrink-0" size={14} weight="fill" />{error}</p>
                <button type="button" onClick={() => setError(undefined)} aria-label="Hide the error" className="grid size-6 shrink-0 place-items-center rounded-md transition hover:bg-[var(--raised)]/70 active:translate-y-px"><XIcon size={12} /></button>
              </div>
            )}
            <NoticeStrip notice={notice} onDismiss={() => setNotice(undefined)} />
            <SelfImprovementReviewPanel reviews={pendingImprovements} onApprove={approveImprovement} onReject={rejectImprovement} />
          </div>

          {showMetrics && <MetricsPanel />}
          {run ? (
            <RunView
              run={run}
              visible={!showMetrics}
              connected={connected}
              writing={writing}
              terminalRef={attachTerminal}
              actions={{
                terminalInput: (data) => { command({ type: "terminal.input", runId, data }); },
                // Sent by the layout, not by a gesture: a size that could not leave is sent again at the next one.
                terminalResize: (cols, rows) => { send({ type: "terminal.resize", runId, cols, rows }); },
                sendInstruction: (text) => command({ type: "instruction.send", runId, text }),
                answer: (answers) => { command({ type: "question.answer", runId, answers }); },
                answerPrompt: (promptId, decision) => { command({ type: "sessionPrompt.answer", runId, promptId, decision }); },
                feedback: (body) => {
                  const feedback = { runId, requestId: requestIdentifier(), body };
                  setRefusedFeedback(undefined);
                  if (!command({ type: "feedback.submit", runId, body, requestId: feedback.requestId })) return false;
                  sentFeedbackRef.current = feedback;
                  return true;
                },
                stop: () => { command({ type: "run.stop", runId }); },
                close: () => { command({ type: "run.close", runId }); },
                removeWorktree: (force) => {
                  if (command({ type: "worktree.remove", runId, ...(force ? { force: true } : {}) })) setWorktreeResult(undefined);
                },
                dismissWorktreeResult: () => setWorktreeResult(undefined),
                openRecipe: () => setRecipeRepository(sourceRepository(run)),
                // Sent with the revision the page was shown, and an id of its own: the server
                // refuses an action on a state that moved, and runs one request once.
                incident: (incident, action, reason) => {
                  setIncidentResult(undefined);
                  command({ type: "incident.action", runId, incidentId: incident.id, expectedRevision: incident.revision, requestId: requestIdentifier(), action, ...(reason ? { reason } : {}) });
                },
              }}
              incidentResult={incidentResult}
              worktreeResult={worktreeResult}
              refusedFeedback={refusedFeedback}
            />
          ) : !showMetrics && (
            <LaunchForm cwd={cwd} setCwd={changeCwd} issueUrl={issueUrl} setIssueUrl={setIssueUrl} parsed={parsedTickets} instruction={instruction} setInstruction={setInstruction} repositories={repositories} detectedProject={detectedProject} detectingProject={detectingProject} missedProject={missedProject} unresolved={pendingUnresolved} targets={targets} chooseTargets={chooseTargets} canStart={canStart} onStart={start} onOpenRecipe={setRecipeRepository} />
          )}
        </div>
      </div>
      {recipeRepository && <RecipeDialog repository={recipeRepository} revision={recipeRevision} connected={connected} onForget={() => { command({ type: "recipe.forget", repository: recipeRepository }); }} onForgetFindings={() => { command({ type: "findings.forget", repository: recipeRepository }); }} onClose={() => setRecipeRepository(undefined)} />}
    </main>
  );
}
