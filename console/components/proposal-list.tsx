"use client";

import { PlayIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { proposalLabel } from "@/lib/run-state";
import type { RepositoryOption, TicketProposal } from "@/lib/types";
import { TargetPicker } from "./target-picker";

export type ProposalActions = {
  dismiss: (issueUrls: string[]) => void;
  /** Queues a refused ticket, one run per checkout chosen. Says whether the request left the page: the picker stays open otherwise. */
  launch: (issueUrl: string, repositories: string[]) => boolean;
};

const iconButton = "grid size-5 shrink-0 place-items-center rounded-md text-[var(--muted)] transition hover:bg-[var(--raised)] hover:text-[var(--ink)] active:translate-y-px";

/**
 * Tickets a watcher found that are not in the queue: the console could not
 * launch them, and says why, or is launching them right now. Every other
 * ticket of the watcher's file goes straight to the queue. A refused one can
 * be sent to checkouts the user chooses, for a ticket filed in a project that
 * has none.
 */
export function ProposalList({ proposals, repositories, actions }: { proposals: TicketProposal[]; repositories: RepositoryOption[]; actions: ProposalActions }) {
  const [choosing, setChoosing] = useState<string>();
  const [chosen, setChosen] = useState<string[]>([]);
  if (proposals.length === 0) return null;
  const toggle = (issueUrl: string) => {
    setChosen([]);
    setChoosing((current) => (current === issueUrl ? undefined : issueUrl));
  };
  return (
    <div role="group" aria-label="Tickets from the watcher" className="border-t border-[var(--line)]">
      <p className="px-3.5 pb-1 pt-2.5 font-mono text-[9px] uppercase tracking-[.08em] text-[var(--muted)]" title="Tickets found by the watcher that are not queued.">From the watcher · {proposals.length}</p>
      <div className="divide-y divide-[var(--line)]">
        {proposals.map((proposal, index) => {
          const label = proposalLabel(proposal.issueUrl);
          const open = choosing === proposal.issueUrl;
          return (
            <div key={proposal.issueUrl} style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }} className="reveal px-3.5 py-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-[var(--ink)]" title={proposal.title ?? label}>{proposal.title ?? label}</p>
                  <a href={proposal.issueUrl} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-[10px] text-[var(--muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline">{label}</a>
                  {proposal.baseBranch && <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--muted)]" title={`Starts from ${proposal.baseBranch}`}>from {proposal.baseBranch}</p>}
                  {proposal.refusal ? <p className="mt-0.5 text-[10px] leading-4 text-red-700">Not started: {proposal.refusal}</p> : <p className="mt-0.5 text-[10px] leading-4 text-[var(--muted)]">Starting…</p>}
                  {proposal.refusal && <button type="button" onClick={() => toggle(proposal.issueUrl)} aria-expanded={open} className="mt-1 text-[10px] text-[var(--muted)] underline decoration-[var(--line)] underline-offset-2 transition hover:text-[var(--ink)]">{open ? "Cancel" : "Choose repositories"}</button>}
                </div>
                {proposal.refusal && <button type="button" className={iconButton} onClick={() => actions.dismiss([proposal.issueUrl])} aria-label={`Dismiss ${label}`} title="Stop listing this ticket"><XIcon size={11} /></button>}
              </div>
              {open && (
                <div className="mt-2">
                  <TargetPicker compact label="Merge request repositories" selected={chosen} onChange={setChosen} repositories={repositories} />
                  <button type="button" disabled={chosen.length === 0} onClick={() => { if (actions.launch(proposal.issueUrl, chosen)) setChoosing(undefined); }} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--ink)] px-3 py-2 text-[11px] font-medium text-[var(--on-ink)] transition hover:bg-[var(--ink-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35">
                    <PlayIcon size={11} weight="fill" /> {chosen.length > 1 ? `Start in ${chosen.length} repositories` : "Start"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
