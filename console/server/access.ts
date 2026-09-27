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
 * binds, and, when it binds every interface, each address the machine holds.
 */
export function allowedHosts(port: number, bindHost: string, interfaceAddresses: string[] = []) {
  const names = new Set(LOOPBACK_NAMES);
  const bound = bindHost.trim().toLowerCase();
  if (bound) names.add(hostLiteral(bound));
  if (WILDCARD_HOSTS.has(bound)) for (const address of interfaceAddresses) names.add(hostLiteral(address.toLowerCase()));
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

/** Compared in constant time, so the answer does not leak how much of the token was right. */
export function tokenMatches(presented: string | null | undefined, expected: string) {
  if (!presented) return false;
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
