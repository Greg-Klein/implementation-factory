"use client";

import { ArrowClockwiseIcon, CaretRightIcon, ChatCircleDotsIcon, HourglassMediumIcon, StopIcon, TerminalWindowIcon, WarningCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { healthNotice, incidentActions } from "@/lib/run-state";
import type { IncidentAction, IncidentResult, RunIncident, RunState } from "@/lib/types";

const time = (at: string) => new Date(at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const secondary = "flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--raised)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--ink)] transition hover:bg-[var(--paper)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Who can move this run forward, when the answer is not "it is working": an
 * incident the health monitor opened, or a wait or a doubt worth saying. One
 * compact band above the tabs: a factual title, the cause in one sentence, what
 * should happen next, and only the actions that can actually run now. The
 * observations stay folded, for whoever wants to check the diagnosis.
 */
export function IncidentPanel({ run, connected, result, onAction, onOpenTerminal, onOpenConversation }: {
  run: RunState;
  connected: boolean;
  result?: IncidentResult;
  onAction: (incident: RunIncident, action: IncidentAction, reason?: string) => void;
  onOpenTerminal: () => void;
  onOpenConversation: () => void;
}) {
  const notice = healthNotice(run);
  const incident = notice?.incident;
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => { setDismissing(false); setReason(""); setOpen(false); }, [incident?.id]);
  if (!notice) return null;

  const severe = notice.tone === "error";
  const actions = incident ? incidentActions(run, incident) : notice.actions;
  const pendingContinuation = incident?.continuation;
  const shownResult = result && incident && result.incidentId === incident.id ? result : undefined;
  const Icon = severe ? WarningCircleIcon : notice.tone === "doubt" ? HourglassMediumIcon : WarningIcon;

  return (
    <section
      aria-label={notice.title}
      className={`reveal shrink-0 border-b px-4 py-3 ${severe ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}
    >
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 shrink-0" size={15} weight="fill" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold leading-5">{notice.title}</p>
          <p className="text-[11px] leading-5 opacity-90">{notice.detail}</p>
          {incident?.expectedNextAction && <p className="mt-0.5 text-[11px] leading-5"><span className="font-medium">Expected next action:</span> {incident.expectedNextAction}</p>}
          {pendingContinuation && <p role="status" className="mt-0.5 text-[11px] leading-5">Continuation requested at {time(pendingContinuation.requestedAt)}. The incident will close once the run is seen resuming.</p>}
          {incident?.decisions.some((decision) => decision.outcome === "unknown") && <p className="mt-0.5 text-[11px] leading-5">An action was recorded just before the server stopped: its outcome is unknown, it was not replayed.</p>}

          {actions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {actions.includes("answer") && <button type="button" onClick={onOpenConversation} className={secondary}><ChatCircleDotsIcon size={12} /> Answer</button>}
              {actions.includes("request_continuation") && !pendingContinuation && (
                <button type="button" disabled={!connected} onClick={() => incident && onAction(incident, "request_continuation")} title="Asks Claude Code to read the context, the plan and the Git state again, then resume with the next action. Nothing is restarted from the beginning." className="flex items-center gap-1.5 rounded-[11px] bg-[var(--ink)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--on-ink)] transition hover:bg-[var(--ink-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40">
                  <ArrowClockwiseIcon size={12} /> Request continuation
                </button>
              )}
              {actions.includes("open_terminal") && <button type="button" onClick={onOpenTerminal} className={secondary}><TerminalWindowIcon size={12} /> Open the terminal</button>}
              {actions.includes("stop") && <button type="button" disabled={!connected} onClick={() => incident && onAction(incident, "stop")} className={secondary}><StopIcon size={12} weight="fill" /> Stop</button>}
              {actions.includes("dismiss") && !dismissing && <button type="button" disabled={!connected} onClick={() => setDismissing(true)} className={`${secondary} text-[var(--muted)]`}>Mark as false positive…</button>}
            </div>
          )}

          {dismissing && incident && (
            <form className="mt-2 flex flex-wrap items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); if (reason.trim()) onAction(incident, "dismiss", reason.trim()); }}>
              <label htmlFor={`dismiss-${incident.id}`} className="sr-only">Why is this a false positive?</label>
              <input id={`dismiss-${incident.id}`} autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this a false positive?" className="field min-w-0 flex-1 py-1.5 text-[11px]" />
              <button type="submit" disabled={!reason.trim() || !connected} className={secondary}>Mark</button>
              <button type="button" onClick={() => { setDismissing(false); setReason(""); }} className={`${secondary} text-[var(--muted)]`}>Cancel</button>
            </form>
          )}

          {shownResult && shownResult.outcome !== "done" && <p role="alert" className="mt-1.5 text-[11px] font-medium leading-5">{shownResult.message}</p>}

          {incident && incident.observations.length > 0 && (
            <div className="mt-2">
              <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex items-center gap-1 text-[10px] font-medium underline-offset-2 hover:underline">
                <CaretRightIcon size={10} className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`} aria-hidden />
                Diagnosis · {incident.observations.length} observation{incident.observations.length > 1 ? "s" : ""}
              </button>
              {open && (
                <ul className="mt-1.5 space-y-1 border-l border-current/20 pl-3">
                  {incident.observations.map((observation, index) => (
                    <li key={`${observation.kind}-${index}`} className="text-[10px] leading-4">
                      {observation.at && <span className="mr-1.5 font-mono opacity-70">{time(observation.at)}</span>}
                      {observation.detail}
                    </li>
                  ))}
                  <li className="text-[10px] leading-4 opacity-70">Detected at {time(incident.detectedAt)} · revision {incident.revision}</li>
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
