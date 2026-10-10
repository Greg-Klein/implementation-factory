import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

export const PREVIEW_BYTES = 2_000_000;
export const ARCHIVE_BYTES = 20_000_000;

/** Refuse symlinks at every component below the root, including links within it. */
export async function regularFilePath(root: string, relative: string) {
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  const suffix = path.relative(base, target);
  if (!suffix || suffix === ".." || suffix.startsWith(`..${path.sep}`) || path.isAbsolute(suffix)) return undefined;
  try {
    if ((await lstat(base)).isSymbolicLink()) return undefined;
    let current = base;
    const parts = suffix.split(path.sep);
    for (let index = 0; index < parts.length; index += 1) {
      current = path.join(current, parts[index]!);
      const entry = await lstat(current);
      if (entry.isSymbolicLink() || (index === parts.length - 1 ? !entry.isFile() : !entry.isDirectory())) return undefined;
    }
    const [actualBase, actualTarget] = await Promise.all([realpath(base), realpath(target)]);
    return actualTarget.startsWith(`${actualBase}${path.sep}`) ? actualTarget : undefined;
  } catch { return undefined; }
}

/** Read at most limit + 1 bytes, even if the file grows after its stat. */
export async function readBoundedFile(target: string, limit: number) {
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error("Document is not a regular file.");
    if (stats.size > limit) throw new Error(`This document exceeds the ${limit === PREVIEW_BYTES ? "2 MB preview" : `${Math.round(limit / 1_000_000)} MB archive`} limit.`);
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= limit) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, limit + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    if (total > limit) throw new Error("Document grew beyond its size limit.");
    return Buffer.concat(chunks, total);
  } finally { await handle.close(); }
}

export async function readConfinedFile(root: string, relative: string, limit = ARCHIVE_BYTES) {
  const target = await regularFilePath(root, relative);
  return target ? readBoundedFile(target, limit) : undefined;
}
