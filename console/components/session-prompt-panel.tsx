"use client";

import { ArrowRightIcon, FolderLockIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { SessionPrompt } from "@/lib/types";

/**
 * The folder trust dialog of Claude Code, brought into the conversation: it is
 * drawn in the terminal before any message exists, where a run would otherwise
 * look silent. Same card as a workflow question, with the two answers the
 * dialog takes. Nothing is ever answered for the user.
 */
export function SessionPromptPanel({ prompt, disabled, onAnswer }: { prompt: SessionPrompt; disabled: boolean; onAnswer: (decision: "accept" | "refuse") => void }) {
  // One answer per prompt: the card leaves as soon as the server has typed it.
  const [sent, setSent] = useState(false);
  const locked = disabled || sent;
  const answer = (decision: "accept" | "refuse") => { setSent(true); onAnswer(decision); };

  return (
    <section aria-label="Decision required" className="reveal w-full max-w-[min(680px,92%)] rounded-3 border border-[var(--callout-line)] bg-[var(--callout)] p-5 shadow-[0_10px_30px_-26px_rgba(30,42,35,.5)]">
      <div className="mb-4 flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--ink)] text-[var(--on-ink)]"><FolderLockIcon size={14} /></div>
        <div><p className="text-xs font-semibold">Decision required</p><p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">The session does not start without your answer. The terminal stays available.</p></div>
      </div>
      <div className="border-y border-[var(--line)] py-4">
        <p className="font-mono text-[9px] font-semibold uppercase tracking-[.14em] text-[var(--accent)]">Folder trust</p>
        <p className="mt-2 text-[11px] font-medium leading-4">Claude Code asks to trust this folder</p>
        <p title={prompt.directory} className="mt-2 break-all rounded-md border border-[var(--line)] bg-[var(--raised)] px-2 py-1.5 font-mono text-[10px] leading-4">{prompt.directory}</p>
        <p className="mt-3 text-[10px] leading-4 text-[var(--muted)]">If it is approved, Claude Code will be able to read, edit and run files in it. Declining closes the session and stops the run.</p>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button type="button" disabled={locked} onClick={() => answer("refuse")} className="rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3.5 py-2 text-xs font-medium text-[var(--ink)] transition hover:bg-[var(--paper)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40">Decline</button>
        <button type="button" disabled={locked} onClick={() => answer("accept")} className="flex items-center gap-2 rounded-[11px] bg-[var(--ink)] px-3 py-2.5 text-[11px] font-semibold text-[var(--on-ink)] transition hover:bg-[var(--ink-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35"><span>Trust and continue</span><ArrowRightIcon size={13} /></button>
      </div>
    </section>
  );
}
