"use client";

import { XIcon } from "@phosphor-icons/react";
import { proposalLabel } from "@/lib/run-state";
import type { TicketProposal } from "@/lib/types";

export type ProposalActions = {
  /** Queues these tickets as one batch, so tickets of one repository are compared before they start. */
  accept: (issueUrls: string[]) => void;
  dismiss: (issueUrls: string[]) => void;
};

const iconButton = "grid size-5 shrink-0 place-items-center rounded-md text-[var(--muted)] transition hover:bg-[var(--raised)] hover:text-[var(--ink)] active:translate-y-px";
const launch = "shrink-0 rounded-md border border-[var(--line)] bg-[var(--raised)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--ink)] transition hover:bg-[var(--paper)] active:translate-y-px";

/**
 * Tickets a watcher found on GitLab, waiting for a decision. Nothing here has
 * started or been analysed: a proposal costs nothing until it is launched.
 */
export function ProposalList({ proposals, actions }: { proposals: TicketProposal[]; actions: ProposalActions }) {
  if (proposals.length === 0) return null;
  return (
    <div role="group" aria-label="Tickets proposés" className="border-t border-[var(--line)]">
      <div className="flex items-center justify-between gap-2 px-3.5 pb-1 pt-2.5">
        <p className="font-mono text-[9px] uppercase tracking-[.08em] text-[var(--muted)]" title="Tickets trouvés sur GitLab par le surveillant. Rien ne démarre tant que tu ne les lances pas.">Proposés · {proposals.length}</p>
        {proposals.length > 1 && <button type="button" className={launch} onClick={() => actions.accept(proposals.map((proposal) => proposal.issueUrl))}>Tout lancer</button>}
      </div>
      <div className="divide-y divide-[var(--line)]">
        {proposals.map((proposal, index) => {
          const label = proposalLabel(proposal.issueUrl);
          return (
            <div key={proposal.issueUrl} style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }} className="reveal flex items-start gap-2 px-3.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-[var(--ink)]" title={proposal.title ?? label}>{proposal.title ?? label}</p>
                <a href={proposal.issueUrl} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-[10px] text-[var(--muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline">{label}</a>
              </div>
              <button type="button" className={launch} onClick={() => actions.accept([proposal.issueUrl])} aria-label={`Lancer ${label}`}>Lancer</button>
              <button type="button" className={iconButton} onClick={() => actions.dismiss([proposal.issueUrl])} aria-label={`Ignorer ${label}`} title="Ne plus proposer ce ticket"><XIcon size={11} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
