import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";

/** Local hooks pin the console's certificate, even when it listens on a wildcard address. */
export function hookTlsOptions(endpoint, certificatePath) {
  if (!endpoint?.startsWith("https:") || !certificatePath) return {};
  const ca = readFileSync(certificatePath);
  const fingerprint = new X509Certificate(ca).fingerprint256;
  return {
    ca,
    checkServerIdentity: (_hostname, peer) => peer.fingerprint256 === fingerprint ? undefined : new Error("Console hook certificate does not match."),
  };
}
