import { deliveryProjects, parseTicketUrls, ticketIdentity, ticketProjectPath } from "./domain.js";
import { checkoutOfProject, checkoutProject, resolveProjectDirectory } from "./repository.js";
import { mainCheckout } from "./worktree.js";
import type { ResolvedTicket, TicketProposal, UnresolvedTicket } from "./types.js";

/**
 * Where a batch comes from: a list of URLs pasted in the launch form, or the
 * tickets an outside watcher found. Either way the registry is handed
 * `ResolvedTicket[]` and never learns how the list was made.
 *
 * Every ticket is resolved before anything is queued, to the checkouts the
 * user chose for it in `targets` (keyed by ticket URL), else to the checkout
 * of its own project. One that has neither comes back in `unresolved` and
 * nothing is queued, while the user still has the form in front of them to
 * say where its merge requests go.
 */
export async function resolvePastedTickets(issueUrls: string[], targets: Record<string, string[]> = {}): Promise<{ resolved: ResolvedTicket[]; unresolved: UnresolvedTicket[] }> {
  const parsed = parseTicketUrls(issueUrls.join("\n"));
  if (parsed.invalid.length > 0) throw new Error(`Ticket URL not recognised: ${parsed.invalid.map((entry) => entry.text).join(", ")}`);
  if (parsed.tickets.length === 0) throw new Error("No ticket in the batch.");
  const chosen = new Map(Object.entries(targets).map(([issueUrl, paths]) => [ticketIdentity(issueUrl), paths]));
  const resolved: ResolvedTicket[] = [];
  const unresolved: UnresolvedTicket[] = [];
  for (const issueUrl of parsed.tickets) {
    const paths = chosen.get(ticketIdentity(issueUrl)) ?? [];
    if (paths.length > 0) {
      resolved.push(...await resolveTargets(issueUrl, paths));
      continue;
    }
    try {
      resolved.push(await resolveTicket(issueUrl));
    } catch {
      const project = ticketProjectPath(issueUrl);
      unresolved.push({ issueUrl, ...(project ? { project } : {}) });
    }
  }
  return { resolved, unresolved };
}

async function resolveTicket(issueUrl: string): Promise<ResolvedTicket> {
  // A path inside a linked worktree names the same repository as its main checkout.
  return { issueUrl, repository: await mainCheckout(await resolveProjectDirectory("", issueUrl)) };
}

/**
 * One ticket sent to checkouts chosen for it rather than detected from its
 * URL: one entry per repository, each one run and one merge request, all
 * told of the projects the others deliver in.
 */
export async function resolveTargets(issueUrl: string, paths: string[], baseBranch?: string): Promise<ResolvedTicket[]> {
  const repositories = [...new Set(await Promise.all(paths.map(async (target) => mainCheckout(await resolveProjectDirectory(target, issueUrl)))))];
  const deliveries = deliveryProjects(issueUrl, await Promise.all(repositories.map(checkoutProject)));
  return repositories.map((repository) => ({ issueUrl, repository, ...(baseBranch ? { baseBranch } : {}), ...(deliveries ? { deliveries } : {}) }));
}

/**
 * The tickets a watcher found, each resolved on its own: unlike a paste,
 * nobody is in front of a form, so one ticket without a checkout keeps only
 * itself out. Each carries the base its watcher named, and goes to the
 * projects the watcher named when there are some.
 */
export async function resolveProposedTickets(proposals: TicketProposal[]) {
  const resolved: ResolvedTicket[] = [];
  const refused: { issueUrl: string; reason: string }[] = [];
  for (const proposal of proposals) {
    try {
      if (proposal.repositories?.length) {
        const paths = await Promise.all(proposal.repositories.map(checkoutOfProject));
        resolved.push(...await resolveTargets(proposal.issueUrl, paths, proposal.baseBranch));
      } else {
        resolved.push({ ...(await resolveTicket(proposal.issueUrl)), ...(proposal.baseBranch ? { baseBranch: proposal.baseBranch } : {}) });
      }
    } catch (error) {
      refused.push({ issueUrl: proposal.issueUrl, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { resolved, refused };
}
