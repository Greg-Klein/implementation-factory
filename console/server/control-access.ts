import { createHmac, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isLoopbackHost, tokenMatches } from "./access.js";

const COOKIE = "impl_session";
const SESSION_MS = 12 * 60 * 60_000;

export function validateNetworkAccess(host: string, token: string | undefined, cert: string | undefined, key: string | undefined, publicUrl?: string) {
  if (token?.trim() && token.trim().length < 32) throw new Error("IMPL_CONTROL_TOKEN must contain at least 32 characters.");
  if (Boolean(cert) !== Boolean(key)) throw new Error("Both IMPL_TLS_CERT and IMPL_TLS_KEY are required for HTTPS.");
  if (["0.0.0.0", "::", "[::]"].includes(host) && !publicUrl) throw new Error("Wildcard binding requires IMPL_PUBLIC_URL naming the HTTPS address clients use.");
  if (publicUrl) {
    const address = new URL(publicUrl);
    if (address.protocol !== "https:" || address.username || address.password || address.pathname !== "/" || address.search || address.hash) throw new Error("IMPL_PUBLIC_URL must be an HTTPS origin without credentials, path, query or fragment.");
  }
  if (!isLoopbackHost(host) && (!token?.trim() || !cert || !key)) throw new Error("Network binding requires IMPL_CONTROL_TOKEN (at least 32 characters), IMPL_TLS_CERT and IMPL_TLS_KEY. Otherwise use loopback with an SSH tunnel.");
}

export class ControlAccess {
  readonly token: string;
  private readonly signingKey = randomBytes(32);
  constructor(token?: string, private readonly clock = () => Date.now()) { this.token = token?.trim() || randomBytes(32).toString("hex"); }

  tokenValid(value: string | undefined) { return tokenMatches(value, this.token); }
  private signature(value: string) { return createHmac("sha256", this.signingKey).update(value).digest("hex"); }
  cookie(secure: boolean) {
    const value = `${this.clock()}.${randomBytes(16).toString("hex")}`;
    return `${COOKIE}=${value}.${this.signature(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? "; Secure" : ""}`;
  }
  sessionExpiresAt(headers: IncomingMessage["headers"]) {
    const cookie = headers.cookie?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!cookie || cookie.length > 160) return undefined;
    const [stamp, nonce, signature, extra] = cookie.split(".");
    if (extra || !stamp || !nonce || !signature || !/^\d+$/.test(stamp) || !/^[a-f0-9]{32}$/.test(nonce)) return undefined;
    const age = this.clock() - Number(stamp);
    return age >= 0 && age < SESSION_MS && tokenMatches(signature, this.signature(`${stamp}.${nonce}`)) ? Number(stamp) + SESSION_MS : undefined;
  }
  authenticated(headers: IncomingMessage["headers"]) {
    const authorization = headers.authorization;
    if (authorization?.startsWith("Bearer ") && this.tokenValid(authorization.slice(7))) return true;
    return this.sessionExpiresAt(headers) !== undefined;
  }
}
