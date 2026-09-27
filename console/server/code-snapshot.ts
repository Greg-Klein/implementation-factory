import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { pluginRoot } from "./config.js";

const exec = promisify(execFile);

/**
 * The shared utility the workflow runs too (hooks/code-snapshot.mjs), so the
 * console and the agents compute one identity the same way. Run as a child
 * process: it hashes the working tree and must not hold the server's event loop
 * meanwhile. Under Electron the executable is the application itself, which
 * behaves as plain Node with ELECTRON_RUN_AS_NODE.
 */
export function snapshotScript(root = pluginRoot) {
  return path.join(root, "hooks", "code-snapshot.mjs");
}

export async function takeCodeSnapshot(cwd: string, exclude: string[]): Promise<{ id: string; capturedAt: string } | undefined> {
  try {
    const { stdout } = await exec(process.execPath, [snapshotScript()], {
      cwd, timeout: 30_000, maxBuffer: 1_000_000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", IMPL_SNAPSHOT_EXCLUDE: exclude.join(","), IMPL_SNAPSHOT_LOG: "" },
    });
    const snapshot = JSON.parse(stdout) as { id?: unknown; capturedAt?: unknown };
    return typeof snapshot.id === "string" && typeof snapshot.capturedAt === "string" ? { id: snapshot.id, capturedAt: snapshot.capturedAt } : undefined;
  } catch {
    return undefined;
  }
}

/** The snapshots the session took through the utility, one JSON line each; a torn line is skipped. */
export async function readSnapshotLog(file: string) {
  const text = await readFile(file, "utf8").catch(() => "");
  return text.split("\n").flatMap((line) => {
    try {
      const entry = JSON.parse(line) as { id?: unknown; capturedAt?: unknown };
      return typeof entry.id === "string" ? [{ id: entry.id, capturedAt: typeof entry.capturedAt === "string" ? entry.capturedAt : "" }] : [];
    } catch { return []; }
  });
}
