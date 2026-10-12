import { timingSafeEqual } from "node:crypto";

/**
 * Who may talk to the console. It listens on the loopback, but a loopback
 * address is reachable from every page the user's browser opens: a browser
 * applies no same-origin policy to a WebSocket, and a DNS rebinding points a
 * foreign name at 127.0.0.1. The socket writes straight into a live agent
 * session, so the console answers only requests addressed to itself by a name
 * it answers to, and only pages it served itself.
 */

const LOOPBACK_NAMES = ["127.0.0.1", "localhost", "[::1]"];
const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);

/** An IPv6 literal is written between brackets in a Host header. */
function hostLiteral(address: string) {
  return address.includes(":") && !address.startsWith("[") ? `[${address}]` : address;
}

export function isLoopbackHost(host: string) {
  const name = host.trim().toLowerCase();
  return name === "localhost" || name === "::1" || name === "[::1]" || /^127(\.\d{1,3}){3}$/.test(name);
}

/**
 * Every `host:port` the console answers to: the loopback names, the interface it
 * binds, when it binds every interface, each address the machine holds, and the
 * names the user gave it, a local DNS name pointing at this machine for instance.
 */
export function allowedHosts(port: number, bindHost: string, interfaceAddresses: string[] = [], givenNames: string[] = []) {
  const names = new Set(LOOPBACK_NAMES);
  const bound = bindHost.trim().toLowerCase();
  if (bound) names.add(hostLiteral(bound));
  if (WILDCARD_HOSTS.has(bound)) for (const address of interfaceAddresses) names.add(hostLiteral(address.toLowerCase()));
  for (const name of givenNames) if (name.trim()) names.add(hostLiteral(name.trim().toLowerCase()));
  return new Set([...names].map((name) => `${name}:${port}`));
}

/** The Host header names the console itself, which is what a DNS rebinding cannot fake. */
export function hostAllowed(hostHeader: string | undefined, allowed: Set<string>) {
  return Boolean(hostHeader) && allowed.has(hostHeader!.trim().toLowerCase());
}

/** The page that opens the socket was served by the console, over http(s). */
export function originAllowed(originHeader: string | undefined, allowed: Set<string>) {
  if (!originHeader) return false;
  let origin: URL;
  try { origin = new URL(originHeader); } catch { return false; }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") return false;
  const port = origin.port || (origin.protocol === "https:" ? "443" : "80");
  return allowed.has(`${origin.hostname.toLowerCase()}:${port}`);
}

/** An IPv4 client of a listener bound to every interface may be reported as `::ffff:a.b.c.d`. */
export function clientAddress(remoteAddress: string | undefined) {
  return (remoteAddress ?? "").trim().toLowerCase().replace(/^::ffff:/, "");
}

/** One spelling for a hardware address: macOS prints `0:ce:39:d0:48:c`, other tools `00-CE-39-D0-48-0C`. */
export function normalizeMac(value: string) {
  const parts = value.trim().toLowerCase().split(/[:-]/);
  if (parts.length !== 6 || parts.some((part) => !/^[0-9a-f]{1,2}$/.test(part))) return undefined;
  return parts.map((part) => part.padStart(2, "0")).join(":");
}

/** The hardware address the neighbour table (`arp -n <address>`) holds for a device, when it holds one. */
export function macInNeighbourEntry(output: string) {
  const found = /(?<![0-9a-f:-])[0-9a-f]{1,2}(?:[:-][0-9a-f]{1,2}){5}(?![0-9a-f:-])/i.exec(output);
  return found ? normalizeMac(found[0]) : undefined;
}

/**
 * Whether a device is let in by its hardware address. A filter, not a proof of
 * identity: a hardware address is sent in clear on the local network and anyone
 * there can take one. An address the table does not know is refused.
 */
export function macAllowed(mac: string | undefined, allowed: Set<string>) {
  return Boolean(mac) && allowed.has(mac!);
}

/** Compared in constant time, so the answer does not leak how much of the token was right. */
export function tokenMatches(presented: string | null | undefined, expected: string) {
  if (!presented) return false;
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
