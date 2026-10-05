import { parseTicketUrls } from "./domain.js";
import { resolveProjectDirectory } from "./repository.js";
import { mainCheckout } from "./worktree.js";
import type { ResolvedTicket, TicketProposal } from "./types.js";

/**
 * Where a batch comes from: a list of URLs pasted in the launch form, or the
 * tickets an outside watcher found. Either way the registry is handed
 * `ResolvedTicket[]` and never learns how the list was made.
 *
 * Every ticket is resolved to its checkout before anything is queued: one
 * that has none refuses the whole paste, while the user still has the form
 * in front of them, rather than half of it starting.
 */
export async function resolvePastedTickets(issueUrls: string[]): Promise<ResolvedTicket[]> {
  const parsed = parseTicketUrls(issueUrls.join("\n"));
  if (parsed.invalid.length > 0) throw new Error(`Ticket URL not recognised: ${parsed.invalid.map((entry) => entry.text).join(", ")}`);
  if (parsed.tickets.length === 0) throw new Error("No ticket in the batch.");
  const resolved: ResolvedTicket[] = [];
  const failures: string[] = [];
  for (const issueUrl of parsed.tickets) {
    try {
      resolved.push(await resolveTicket(issueUrl));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length > 0) throw new Error([...new Set(failures)].join(" "));
  return resolved;
}

async function resolveTicket(issueUrl: string): Promise<ResolvedTicket> {
  // A path inside a linked worktree names the same repository as its main checkout.
  return { issueUrl, repository: await mainCheckout(await resolveProjectDirectory("", issueUrl)) };
}

/**
 * The tickets a watcher found, each resolved on its own: unlike a paste,
 * nobody is in front of a form, so one ticket without a checkout keeps only
 * itself out. Each carries the base its watcher named.
 */
export async function resolveProposedTickets(proposals: TicketProposal[]) {
  const resolved: ResolvedTicket[] = [];
  const refused: { issueUrl: string; reason: string }[] = [];
  for (const proposal of proposals) {
    try {
      resolved.push({ ...(await resolveTicket(proposal.issueUrl)), ...(proposal.baseBranch ? { baseBranch: proposal.baseBranch } : {}) });
    } catch (error) {
      refused.push({ issueUrl: proposal.issueUrl, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { resolved, refused };
}
