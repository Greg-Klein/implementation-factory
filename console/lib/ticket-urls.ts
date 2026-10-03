/**
 * Reading GitLab ticket URLs out of what a user pasted. No dependency, so the
 * launch form and the server read a paste the same way: the form to count and
 * flag while the user types, the server to decide what it accepts.
 */

const TICKET_URL = /^https?:\/\/[^/\s]+\/.+?\/-\/(?:issues|work_items)\/\d+$/;

/** A ticket URL without its query, its fragment or a trailing slash, the way a pasted URL varies. */
export function ticketIdentity(issueUrl: string) {
  return issueUrl.trim().split(/[?#]/)[0].replace(/\/+$/, "");
}

/** The URL of a GitLab issue or work item in its bare form, or undefined when the text is not one. */
export function normalizeTicketUrl(value: string) {
  const bare = ticketIdentity(value);
  return TICKET_URL.test(bare) ? bare : undefined;
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
