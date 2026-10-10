import { readFile } from "node:fs/promises";
import path from "node:path";
import { isLoopbackHost } from "../server/access.js";

/** Local credentials are never sent to a remote URL; remote clients supply a token explicitly. */
export async function controlHeaders(base: string): Promise<Record<string, string>> {
  let token = process.env.IMPL_CONTROL_TOKEN?.trim();
  const url = new URL(base);
  if (!token && ((isLoopbackHost(url.hostname) && url.port === (process.env.IMPL_PORT?.trim() || "3210")) || url.origin === process.env.IMPL_LOCAL_CONSOLE_URL)) {
    const directory = process.env.IMPL_CONTROL_TOKEN_FILE || (process.env.IMPL_DATA_DIR ? path.join(process.env.IMPL_DATA_DIR, "control-token") : undefined);
    token = directory ? await readFile(directory, "utf8").then((value) => value.trim(), () => undefined) : undefined;
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
}
