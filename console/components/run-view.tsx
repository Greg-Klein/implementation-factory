"use client";

import { ChatCircleDotsIcon, FolderDashedIcon, KanbanIcon, ShieldCheckIcon, SignOutIcon, StopIcon, TerminalWindowIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState, type Ref } from "react";
import { canRemoveWorktree, holdsIdleSession, isClosable, isTranscriptStalled, runInProgress, sessionAlive } from "@/lib/run-state";
import type { IncidentAction, IncidentResult, RunIncident, RunState, WorktreeResult } from "@/lib/types";
import { ActivityPanel } from "./activity-panel";
import { ConversationPanel } from "./conversation-panel";
import { EvidencePanel } from "./evidence-panel";
import { IncidentPanel } from "./incident-panel";
import { PhaseRail } from "./phase-rail";
import { TerminalPanel, type TerminalHandle } from "./terminal-panel";
import { TrackingPanel } from "./tracking-panel";
import { WorktreePanel } from "./worktree-panel";

type Tab = "conversation" | "suivi" | "terminal" | "preuves";

export type RunViewActions = {
  terminalInput: (data: string) => void;
  terminalResize: (cols: number, rows: number) => void;
  sendInstruction: (text: string) => void;
  answer: (answers: Record<string, string>) => void;
  answerPrompt: (promptId: string, decision: "accept" | "refuse") => void;
  feedback: (body: string) => void;
  stop: () => void;
  close: () => void;
  incident: (incident: RunIncident, action: IncidentAction, reason?: string) => void;
  /** `force`: sent again once the user confirmed that uncommitted or unpushed work may go. */
  removeWorktree: (force: boolean) => void;
  dismissWorktreeResult: () => void;
  /** Opens what the console keeps about starting the app of this run's repository. */
  openRecipe: () => void;
};

export function RunView({ run, connected, writing, terminalRef, actions, incidentResult, worktreeResult }: {
  run: RunState;
  connected: boolean;
  writing: boolean;
  terminalRef: Ref<TerminalHandle>;
  actions: RunViewActions;
  incidentResult?: IncidentResult;
  worktreeResult?: WorktreeResult;
}) {
  const [tab, setTab] = useState<Tab>("conversation");
  const [tabList, setTabList] = useState<HTMLDivElement | null>(null);
  const tabButtonRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0 });
  // What the user was last shown in each tab. A review round overwrites the same
  // evidence files, so the write stamp is the only thing that says the Evidence
  // tab holds something new; for the dialogue it is the last message.
  const [seenEvidenceAt, setSeenEvidenceAt] = useState<string>();
  const [seenMessageId, setSeenMessageId] = useState<string>();
  const lastMessage = run.messages.at(-1);
  /**
   * The dot on a tab the user is not reading, and what it is about. Read in
   * render, not in an effect: it widens the tab button, so it has to be gone in
   * the very commit that selects the tab, before the measurement below runs on
   * a button that is about to get narrower. A message the user typed themselves
   * is not news to them.
   */
  const unread: Partial<Record<Tab, string>> = {
    conversation: tab === "conversation" ? undefined : run.pendingQuestion || run.sessionPrompt ? "pending decision" : lastMessage?.author === "claude" && lastMessage.id !== seenMessageId ? "new message" : undefined,
    preuves: tab !== "preuves" && Boolean(run.evidenceUpdatedAt) && run.evidenceUpdatedAt !== seenEvidenceAt ? "new evidence" : undefined,
  };

  // Switching run switches subject: what had been read in the previous one says
  // nothing about this one, and the tab returns to the dialogue.
  useEffect(() => {
    setTab("conversation");
    setSeenEvidenceAt(undefined);
    setSeenMessageId(undefined);
  }, [run.id]);

  useEffect(() => {
    if (tab === "preuves") setSeenEvidenceAt(run.evidenceUpdatedAt);
  }, [tab, run.evidenceUpdatedAt]);

  useEffect(() => {
    if (tab === "conversation") setSeenMessageId(lastMessage?.id);
  }, [tab, lastMessage?.id]);

  // Measured from the DOM rather than hardcoded, so the pill lines up whatever
  // the label width ends up being (font load, locale, a tab added later).
  useLayoutEffect(() => {
    const button = tabButtonRefs.current[tab];
    if (!tabList || !button) return;
    const measure = () => {
      const listRect = tabList.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      setTabIndicator({ left: buttonRect.left - listRect.left, width: buttonRect.width });
    };
    measure();
    window.addEventListener("resize", measure);
    document.fonts?.addEventListener("loadingdone", measure);
    return () => {
      window.removeEventListener("resize", measure);
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, [tab, tabList, unread.conversation, unread.preuves]);

  const active = runInProgress(run.status);
  const idleSession = holdsIdleSession(run);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[196px_minmax(0,1fr)_300px]">
      <PhaseRail run={run} onOpenRecipe={actions.openRecipe} />
      <section className="flex min-h-135 flex-col border-b border-[var(--line)] bg-[var(--surface)] lg:min-h-0 lg:border-b-0 lg:border-r xl:border-l">
        <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-2">
          <div ref={setTabList} role="tablist" aria-label="Session view" className="relative flex items-center gap-0.5 rounded-full border border-[var(--line)] bg-[var(--sunken)] p-0.5">
            {tabIndicator.width > 0 && <span aria-hidden className="absolute inset-y-0.5 left-0 rounded-full bg-[var(--tab-selected)] transition-[transform,width] duration-200 ease-out" style={{ width: tabIndicator.width, transform: `translateX(${tabIndicator.left}px)` }} />}
            {([["conversation", "Conversation"], ["suivi", "Tracking"], ["terminal", "Terminal"], ["preuves", "Evidence"]] as const).map(([value, label]) => {
              const fresh = unread[value];
              return (
                <button key={value} ref={(el) => { tabButtonRefs.current[value] = el; }} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`relative z-10 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors duration-200 ${tab === value ? "text-[var(--on-tab-selected)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
                  {value === "conversation" ? <ChatCircleDotsIcon size={13} /> : value === "suivi" ? <KanbanIcon size={13} /> : value === "terminal" ? <TerminalWindowIcon size={13} /> : <ShieldCheckIcon size={13} />}{label}
                  {fresh && <span role="img" aria-label={fresh} title={`${fresh[0].toUpperCase()}${fresh.slice(1)} since your last visit to this tab`} className="status-breathe size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/*
              A workflow that reached its end still holds its slot while the
              session sits at its prompt. The queue takes it back on its own as
              soon as a launch waits on it; until then the session is the user's
              to keep or to give up, hence an action of its own, named for what
              it frees rather than for what it stops.
            */}
            {idleSession && <button type="button" disabled={!connected} onClick={actions.stop} title="The run is finished and takes no slot. Its session stays open on the ticket and closes on its own if a queued run waits for that ticket." className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--ink)] transition hover:bg-[var(--raised)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"><SignOutIcon size={12} /> Close the session</button>}
            {active && <button type="button" disabled={!connected} onClick={actions.stop} className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--ink)] transition hover:bg-[var(--raised)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"><StopIcon size={12} weight="fill" /> Stop</button>}
            {run.archived && <span title="Run from a previous session, read back from its archive: it has no session any more and takes no instruction." className="rounded-full bg-[var(--line)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">Archive</span>}
            {canRemoveWorktree(run) && <button type="button" disabled={!connected} onClick={() => actions.removeWorktree(false)} title="Removes the working directory of this run. The branch and its commits stay in the repository. A confirmation is asked if some work is neither committed nor pushed." className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted)] transition hover:bg-[var(--raised)] hover:text-[var(--ink)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"><FolderDashedIcon size={12} className="shrink-0" /> Remove the worktree</button>}
            {isClosable(run) && !run.archived && <button type="button" disabled={!connected} onClick={actions.close} title="Remove this run from the list. Its documents stay archived on disk." className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted)] transition hover:bg-[var(--raised)] hover:text-[var(--ink)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"><TrashIcon size={12} /> Close</button>}
          </div>
        </div>
        <WorktreePanel result={worktreeResult && worktreeResult.runId === run.id && canRemoveWorktree(run) ? worktreeResult : undefined} connected={connected} onConfirm={() => actions.removeWorktree(true)} onDismiss={actions.dismissWorktreeResult} />
        <IncidentPanel run={run} connected={connected} result={incidentResult} onAction={actions.incident} onOpenTerminal={() => setTab("terminal")} onOpenConversation={() => setTab("conversation")} />
        <div className={tab === "conversation" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <ConversationPanel messages={run.messages} pendingQuestion={run.pendingQuestion} sessionPrompt={run.sessionPrompt} connected={connected} onAnswerPrompt={actions.answerPrompt} writing={writing} action={run.action} stalled={isTranscriptStalled(run.messages.length, run.phase, run.agents.length, run.artifacts.length)} live={!run.archived && sessionAlive(run.status, run.sessionActive)} canSend={sessionAlive(run.status, run.sessionActive) && connected} visible={tab === "conversation"} onSend={actions.sendInstruction} onAnswer={actions.answer} onCheckTerminal={() => setTab("terminal")} />
        </div>
        <div className={tab === "suivi" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <TrackingPanel run={run} />
        </div>
        <div className={tab === "terminal" ? "min-h-0 flex-1 bg-[var(--terminal)]" : "hidden"}>
          <TerminalPanel ref={terminalRef} onInput={actions.terminalInput} onResize={actions.terminalResize} />
        </div>
        <div className={tab === "preuves" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <EvidencePanel run={run} />
        </div>
      </section>
      <ActivityPanel run={run} onFeedback={actions.feedback} onShowQuestion={() => setTab("conversation")} />
    </div>
  );
}
