import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { REVIEW_GUIDE_CANDIDATES, REVIEW_GUIDE_FILE, renderReviewGuide, reviewGuidePath } from "./domain.js";
import { engine } from "./engine/index.js";
import { isMissingFile, reportFailure } from "./context.js";

/** The session variable the pilot reads. Set only when a guide was copied. */
export function reviewGuideEnvironment(source: string | undefined): { IMPL_REVIEW_GUIDE?: string } {
  return source ? { IMPL_REVIEW_GUIDE: source } : {};
}

/**
 * Copies the repository's review guide into the run's task directory, dated
 * before the run so the artifact watcher does not take it for a document this
 * run wrote. The first of `REVIEW.md`, `.claude/REVIEW.md` and `docs/REVIEW.md`
 * wins. Returns that path, or nothing when the repository has no guide.
 */
export async function seedReviewGuide(worktree: string, startedAt: string) {
  const existing: string[] = [];
  for (const candidate of REVIEW_GUIDE_CANDIDATES) {
    const file = await stat(path.join(worktree, candidate)).then((found) => found.isFile(), (error: unknown) => {
      if (!isMissingFile(error)) reportFailure("Review guide not found", path.join(worktree, candidate))(error);
      return false;
    });
    if (file) existing.push(candidate);
  }
  const source = reviewGuidePath(existing);
  if (!source) return undefined;
  let content: string;
  try {
    content = await readFile(path.join(worktree, source), "utf8");
  } catch (error) {
    if (!isMissingFile(error)) reportFailure("Review guide not copied", worktree)(error);
    return undefined;
  }
  const target = path.join(engine.taskDirectory(worktree), REVIEW_GUIDE_FILE);
  const notAfter = new Date(Date.parse(startedAt) - 1000);
  const stamp = Number.isNaN(notAfter.getTime()) ? new Date(0) : notAfter;
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, renderReviewGuide(source, content));
    await utimes(target, stamp, stamp);
    return source;
  } catch (error) {
    reportFailure("Review guide not copied", worktree)(error);
    return undefined;
  }
}
