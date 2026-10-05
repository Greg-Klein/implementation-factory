"use client";

import { XIcon } from "@phosphor-icons/react";
import { proposalLabel } from "@/lib/run-state";
import type { TicketProposal } from "@/lib/types";

export type ProposalActions = {
  dismiss: (issueUrls: string[]) => void;
};

const iconButton = "grid size-5 shrink-0 place-items-center rounded-md text-[var(--muted)] transition hover:bg-[var(--raised)] hover:text-[var(--ink)] active:translate-y-px";

/**
 * Tickets a watcher found that are not in the queue: the console could not
 * launch them, and says why, or is launching them right now. Every other
 * ticket of the watcher's file goes straight to the queue.
 */
export function ProposalList({ proposals, actions }: { proposals: TicketProposal[]; actions: ProposalActions }) {
  if (proposals.length === 0) return null;
  return (
    <div role="group" aria-label="Tickets from the watcher" className="border-t border-[var(--line)]">
      <p className="px-3.5 pb-1 pt-2.5 font-mono text-[9px] uppercase tracking-[.08em] text-[var(--muted)]" title="Tickets found by the watcher that are not queued.">From the watcher · {proposals.length}</p>
      <div className="divide-y divide-[var(--line)]">
        {proposals.map((proposal, index) => {
          const label = proposalLabel(proposal.issueUrl);
          return (
            <div key={proposal.issueUrl} style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }} className="reveal flex items-start gap-2 px-3.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-[var(--ink)]" title={proposal.title ?? label}>{proposal.title ?? label}</p>
                <a href={proposal.issueUrl} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-[10px] text-[var(--muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline">{label}</a>
                {proposal.baseBranch && <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--muted)]" title={`Starts from ${proposal.baseBranch}`}>from {proposal.baseBranch}</p>}
                {proposal.refusal ? <p className="mt-0.5 text-[10px] leading-4 text-red-700">Not started: {proposal.refusal}</p> : <p className="mt-0.5 text-[10px] leading-4 text-[var(--muted)]">Starting…</p>}
              </div>
              {proposal.refusal && <button type="button" className={iconButton} onClick={() => actions.dismiss([proposal.issueUrl])} aria-label={`Dismiss ${label}`} title="Stop listing this ticket"><XIcon size={11} /></button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
