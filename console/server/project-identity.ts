import { parseTicketUrl, type Forge } from "../lib/ticket-urls.js";

export type ProjectIdentity = { hostname: string; project: string; forge?: Forge };

export function ticketProjectIdentity(value: string): ProjectIdentity | undefined {
  const ticket = parseTicketUrl(value);
  return ticket ? { forge: ticket.forge, hostname: ticket.hostname.toLowerCase(), project: ticket.project } : undefined;
}

/** A private forge's product cannot always be inferred from its Git remote. Its host still distinguishes it. */
export function remoteProjectIdentity(value: string): ProjectIdentity | undefined {
  let hostname: string, project: string;
  try {
    if (/^[\w+.-]+:\/\//.test(value)) {
      const url = new URL(value); hostname = url.hostname; project = url.pathname;
      if (!["ssh:", "https:", "http:", "git:"].includes(url.protocol)) return undefined;
    } else {
      const match = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(value);
      if (!match) return undefined;
      hostname = match[1]!; project = match[2]!;
    }
    hostname = hostname.toLowerCase(); project = project.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
    if (!hostname || !project.includes("/") || project.split("/").some((part) => !part || part === "." || part === "..")) return undefined;
    const forge = /github/i.test(hostname) ? "github" : /gitlab/i.test(hostname) || project.split("/").length > 2 ? "gitlab" : undefined;
    return { hostname, project, ...(forge ? { forge } : {}) };
  } catch { return undefined; }
}

export function sameProject(left: ProjectIdentity, right: ProjectIdentity) {
  return left.hostname.toLowerCase() === right.hostname.toLowerCase() && left.project.toLowerCase() === right.project.toLowerCase()
    && (!left.forge || !right.forge || left.forge === right.forge);
}

export function remoteIdentities(config: string, originOnly = false): ProjectIdentity[] {
  const identities: ProjectIdentity[] = [];
  let remote = "";
  for (const line of config.split("\n")) {
    if (line.trim().startsWith("[")) { remote = /^\s*\[remote "([^"]+)"\]/.exec(line)?.[1] ?? ""; continue; }
    if (!remote || (originOnly && remote !== "origin")) continue;
    const value = /^\s*url\s*=\s*(.+)$/.exec(line)?.[1]?.trim();
    const identity = value ? remoteProjectIdentity(value) : undefined;
    if (identity && !identities.some((entry) => sameProject(entry, identity))) identities.push(identity);
  }
  return identities;
}
