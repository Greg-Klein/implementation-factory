import { execFile } from "node:child_process";
import net from "node:net";
import os from "node:os";
import { clientAddress, isLoopbackHost, macAllowed, macInNeighbourEntry } from "./access.js";
import { allowedMacs } from "./config.js";

/** A page loads dozens of files: the table is asked once per device and per interval, not once per request. */
const REMEMBERED_MS = 30_000;
const remembered = new Map<string, { allowed: boolean; at: number }>();

function ownAddresses() {
  return new Set(Object.values(os.networkInterfaces()).flatMap((entries) => entries?.map((entry) => entry.address.toLowerCase()) ?? []));
}

/** The system's neighbour table is the only place a hardware address can be read from: a TCP connection carries none. */
function neighbourMac(address: string) {
  return new Promise<string | undefined>((resolve) => {
    execFile("arp", ["-n", address], { timeout: 2_000 }, (_error, stdout) => resolve(macInNeighbourEntry(String(stdout ?? ""))));
  });
}

/**
 * Whether the device behind a connection may talk to the console. This machine
 * always may. With `IMPL_ALLOWED_MACS` set, any other device must be on the
 * local network, where it has a hardware address, and be listed: a client that
 * comes through a router or a VPN has none here and is refused.
 */
export async function deviceAllowed(remoteAddress: string | undefined) {
  if (allowedMacs.size === 0) return true;
  const address = clientAddress(remoteAddress);
  if (isLoopbackHost(address) || ownAddresses().has(address)) return true;
  if (!net.isIPv4(address)) return false;
  const known = remembered.get(address);
  if (known && Date.now() - known.at < REMEMBERED_MS) return known.allowed;
  const allowed = macAllowed(await neighbourMac(address), allowedMacs);
  remembered.set(address, { allowed, at: Date.now() });
  return allowed;
}
