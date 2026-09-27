#!/usr/bin/env node
/**
 * The identity of the code a verification ran against, shared by the workflow
 * (which records it next to every piece of evidence) and the console (which
 * compares it with the code as it stands now). Neither side makes one up: both
 * ask this file.
 *
 * The identity is the git tree of the working copy, untracked files included,
 * ignored files and the workflow's own documents excluded. It is built in a
 * throwaway index, so the real index and the working tree are never touched,
 * and it depends on content alone: committing the exact state that was measured
 * keeps the same identity, while any edit, staged or not, changes it. Writing
 * that throwaway tree stores ordinary blob and tree objects in the repository,
 * the same objects `git add` would.
 *
 * CLI: prints the snapshot as JSON. `IMPL_SNAPSHOT_EXCLUDE` (comma separated,
 * relative to the repository root) lists the workflow paths left out, and
 * `IMPL_SNAPSHOT_LOG`, when set, receives the same line appended, which is how
 * the console tells a snapshot this utility took from an identifier typed by hand.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function git(cwd, args, env) {
  return execFileSync("git", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();
}

export function codeSnapshot(cwd, { exclude = [] } = {}) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  let commit = null;
  try { commit = git(root, ["rev-parse", "--verify", "HEAD"]); } catch { /* a repository without a commit yet */ }
  const scratch = mkdtempSync(path.join(os.tmpdir(), "impl-snapshot-"));
  try {
    const index = path.join(scratch, "index");
    const realIndex = path.resolve(root, git(root, ["rev-parse", "--git-path", "index"]));
    // Starting from the real index only saves hashing unchanged files again.
    if (existsSync(realIndex)) copyFileSync(realIndex, index);
    const excluded = exclude.map((entry) => entry.trim()).filter(Boolean);
    const env = { GIT_INDEX_FILE: index };
    git(root, ["add", "--all", "--", ".", ...excluded.map((entry) => `:(exclude)${entry}`)], env);
    // A path excluded from `add` may still sit in the copied index; it must not count.
    for (const entry of excluded) git(root, ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", entry], env);
    const tree = git(root, ["write-tree"], env);
    return { schemaVersion: 1, id: `snap-${tree.slice(0, 16)}`, tree, commit, capturedAt: new Date().toISOString(), scope: { root, excluded } };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const exclude = (process.env.IMPL_SNAPSHOT_EXCLUDE ?? "").split(",");
    const snapshot = codeSnapshot(process.cwd(), { exclude });
    const line = JSON.stringify(snapshot);
    if (process.env.IMPL_SNAPSHOT_LOG) appendFileSync(process.env.IMPL_SNAPSHOT_LOG, `${line}\n`);
    process.stdout.write(`${line}\n`);
  } catch (error) {
    process.stderr.write(`code-snapshot: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}
