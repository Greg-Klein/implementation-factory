/**
 * Reading ticket URLs, GitLab or GitHub, out of what a user pasted. No
 * dependency, so the launch form and the server read a paste the same way: the
 * form to count and flag while the user types, the server to decide what it
 * accepts.
 */

/** Where a ticket lives. Everything that differs between the two is decided from this. */
export type Forge = "gitlab" | "github";

/** What an address says of a ticket, or of the merge request or pull request that delivers one. */
export type ForgeAddress = { forge: Forge; hostname: string; project: string; number: string };

/**
 * GitLab puts `/-/` between the project and what is addressed inside it, under
 * any depth of groups. GitHub has exactly an owner and a repository, and no
 * `/-/`. The shape decides, not the host, so a self-hosted instance of either
 * needs no setting. A GitLab host is never read as GitHub: its addresses
 * without `/-/` are an old form this console does not take.
 */
function forgeAddress(value: string, gitlab: RegExp, github: RegExp): ForgeAddress | undefined {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (!/^https?:$/.test(url.protocol)) return undefined;
  const onGitLab = url.pathname.match(gitlab);
  if (onGitLab) return { forge: "gitlab", hostname: url.hostname, project: onGitLab[1], number: onGitLab[2] };
  const onGitHub = /gitlab/i.test(url.hostname) ? null : url.pathname.match(github);
  return onGitHub ? { forge: "github", hostname: url.hostname, project: onGitHub[1], number: onGitHub[2] } : undefined;
}

/** The ticket an address points at: a GitLab issue or work item, or a GitHub issue. */
export function parseTicketUrl(value: string) {
  return forgeAddress(value, /^\/(.+?)\/-\/(?:issues|work_items)\/(\d+)(?:\/|$)/, /^\/([^/]+\/[^/]+)\/issues\/(\d+)(?:\/|$)/);
}

/** The merge request or pull request an address points at. */
export function parseDeliveryUrl(value: string) {
  return forgeAddress(value, /^\/(.+?)\/-\/merge_requests\/(\d+)(?:\/|$)/, /^\/([^/]+\/[^/]+)\/pull\/(\d+)(?:\/|$)/);
}

/** A ticket URL without its query, its fragment or a trailing slash, the way a pasted URL varies. */
export function ticketIdentity(issueUrl: string) {
  return issueUrl.trim().split(/[?#]/)[0].replace(/\/+$/, "");
}

/** The URL of a ticket in its bare form, or undefined when the text is not one. */
export function normalizeTicketUrl(value: string) {
  const bare = ticketIdentity(value);
  return /\/\d+$/.test(bare) && parseTicketUrl(bare) ? bare : undefined;
}

/** The number a ticket is called by, `#217`, or the last segment of an address that has none. */
export function ticketReference(issueUrl: string) {
  const last = ticketIdentity(issueUrl).split("/").filter(Boolean).pop() ?? "";
  return /^\d+$/.test(last) ? `#${last}` : last;
}

export type ParsedTickets = {
  /** Recognised URLs, in the order pasted, each one once. */
  tickets: string[];
  /** What is not a ticket URL, with the line it sits on, counted from 1. */
  invalid: { line: number; text: string }[];
  /** Recognised URLs pasted more than once: kept once in `tickets`. */
  duplicates: string[];
};

/** One URL per line; several on a line, separated by spaces, commas or semicolons, are read too. */
export function parseTicketUrls(text: string): ParsedTickets {
  const tickets: string[] = [];
  const invalid: ParsedTickets["invalid"] = [];
  const duplicates: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const token of line.split(/[\s,;]+/).filter(Boolean)) {
      const ticket = normalizeTicketUrl(token);
      if (!ticket) invalid.push({ line: index + 1, text: token });
      else if (tickets.includes(ticket)) { if (!duplicates.includes(ticket)) duplicates.push(ticket); }
      else tickets.push(ticket);
    }
  });
  return { tickets, invalid, duplicates };
}
