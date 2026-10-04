import { parseTicketUrls } from "./domain.js";
import { resolveProjectDirectory } from "./repository.js";
import { mainCheckout } from "./worktree.js";
import type { ResolvedTicket } from "./types.js";

/**
 * Where a batch comes from. Today the only source is a list of URLs pasted in
 * the launch form; tickets pulled from GitLab by label or assignee would be a
 * second function of this file. Either way the registry is handed
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
      // A path inside a linked worktree names the same repository as its main checkout.
      resolved.push({ issueUrl, repository: await mainCheckout(await resolveProjectDirectory("", issueUrl)) });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length > 0) throw new Error([...new Set(failures)].join(" "));
  return resolved;
}
