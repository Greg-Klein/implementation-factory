import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The review tier a diff cannot go below, decided from the paths it touches.
 * The pilot sizes the tier upward from the diff; this floor is what the guard
 * refuses to go under. The same patterns cap the review confidence in
 * console/server/review-confidence.ts, and a unit test holds the two copies
 * equal. `pathMatches` is that file's matcher, copied: the hook cannot import
 * the server.
 *
 * Sensitive paths are the owner's list (`IMPL_SENSITIVE_PATHS`) and floor the
 * tier at 1. CI workflows and migrations floor it at 2 even when that list
 * omits them: those paths always get the full review.
 */

/** What `IMPL_SENSITIVE_PATHS` falls back to. Held equal to the console's default. */
export const DEFAULT_SENSITIVE_PATHS = [
  "**/migrations/**",
  "**/migrate/**",
  "**/auth/**",
  "**/security/**",
  ".github/workflows/**",
  "**/.github/workflows/**",
  ".gitlab-ci.yml",
  "**/.gitlab-ci.yml",
  "**/Dockerfile*",
];

/** Paths that are tier 2 whatever the sensitive-path setting says. Held equal to the console's copy. */
export const TIER_TWO_PATTERNS = [
  ".github/workflows/**",
  "**/.github/workflows/**",
  ".gitlab-ci.yml",
  "**/.gitlab-ci.yml",
  "**/migrations/**",
  "**/migrate/**",
];

/** `**` crosses directories, `*` stays inside one, and a pattern without a slash matches a name at any depth. */
export function pathMatches(pattern, file) {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  const anchored = trimmed.includes("/") ? trimmed : `**/${trimmed}`;
  const source = anchored.split(/(\*\*\/|\*\*|\*)/).map((part) => {
    if (part === "**/") return "(?:.*/)?";
    if (part === "**") return ".*";
    if (part === "*") return "[^/]*";
    return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return new RegExp(`^${source}$`).test(file);
}

/** The sensitive-path list of a session: an empty setting is the default, as `listSetting` reads it. */
export function sensitivePatterns(env = process.env) {
  const entries = String(env.IMPL_SENSITIVE_PATHS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 0 ? entries : DEFAULT_SENSITIVE_PATHS;
}

/**
 * The tier a list of paths cannot go below. `sensitive` is every path that
 * counts against the review confidence; `tierTwo` is the CI and migration
 * subset. A tier-two path is also sensitive.
 */
export function reviewTierFloor(files, patterns) {
  const list = [...new Set(files.filter((file) => typeof file === "string" && file && !file.endsWith("/")))];
  const owned = Array.isArray(patterns) ? patterns : [];
  const tierTwo = list.filter((file) => TIER_TWO_PATTERNS.some((pattern) => pathMatches(pattern, file)));
  const sensitive = list.filter((file) => tierTwo.includes(file) || owned.some((pattern) => pathMatches(pattern, file)));
  return { floor: tierTwo.length > 0 ? 2 : sensitive.length > 0 ? 1 : 0, sensitive, tierTwo };
}

/** A branch name that can be handed to git as a ref, and nothing else. */
export function plainBranch(name) {
  const branch = String(name ?? "").trim();
  if (!/^[\w./+-]+$/.test(branch)) return undefined;
  if (branch.startsWith("-") || branch.startsWith("/") || branch.endsWith("/") || branch.includes("..") || branch.includes("//")) return undefined;
  return branch;
}

/** Paths from `git diff -z --name-status`, both names of a rename. */
export function pathsFromNameStatus(text) {
  const fields = String(text).split("\0");
  const paths = [];
  for (let index = 0; index < fields.length; index += 1) {
    const status = fields[index];
    if (!status) continue;
    const kind = status[0];
    if (kind === "R" || kind === "C") {
      const from = fields[index + 1];
      const to = fields[index + 2];
      index += 2;
      if (from) paths.push(from);
      if (to) paths.push(to);
    } else if ("MADTUXB".includes(kind)) {
      const file = fields[index + 1];
      index += 1;
      if (file) paths.push(file);
    }
  }
  return paths;
}

/** Paths from `git status --porcelain=v1 -z`, both names of a rename, untracked included. */
export function pathsFromPorcelain(text) {
  const fields = String(text).split("\0");
  const paths = [];
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index];
    if (!entry || entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) {
      const from = fields[index + 1];
      index += 1;
      if (from) paths.push(from);
    }
  }
  return paths;
}

function gitOut(cwd, args) {
  try {
    const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
    if (result.error || result.status !== 0) return undefined;
    return result.stdout;
  } catch {
    return undefined;
  }
}

function refExists(top, ref) {
  return gitOut(top, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== undefined;
}

/**
 * The ref the diff is measured from, best first: the branch the pilot recorded
 * in `state` (the parsed `workflow-state.json`), then the ones the console
 * passed, then the remote's default. Undefined when none of them exist, which
 * the guard reads as a diff it cannot check.
 */
export function resolveBase(top, env, state) {
  const names = [];
  const recorded = plainBranch(state?.baseBranch);
  if (recorded) names.push(recorded);
  for (const key of ["IMPL_BASE_BRANCH", "IMPL_TICKET_BASE_BRANCH", "IMPL_SOURCE_BRANCH"]) {
    const branch = plainBranch(env[key]);
    if (branch) names.push(branch);
  }
  for (const name of names) {
    if (refExists(top, `origin/${name}`)) return `origin/${name}`;
    if (refExists(top, name)) return name;
  }
  const origin = gitOut(top, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])?.trim();
  if (origin && plainBranch(origin) && refExists(top, origin)) return origin;
  return undefined;
}

/**
 * The paths the branch and the working tree changed, relative to the repository
 * root. Undefined when git cannot be read or no base can be resolved: the
 * guard then lets the call through.
 */
export function changedPaths(cwd, env = process.env, state) {
  const top = gitOut(cwd || ".", ["rev-parse", "--show-toplevel"])?.trim();
  if (!top) return undefined;
  const base = resolveBase(top, env, state);
  if (!base) return undefined;
  const committed = gitOut(top, ["diff", "-z", "--name-status", "-M", `${base}...HEAD`]);
  const status = gitOut(top, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (committed === undefined || status === undefined) return undefined;
  return [...new Set([...pathsFromNameStatus(committed), ...pathsFromPorcelain(status)])];
}

/**
 * `workflow-state.json`, read once: the tier written in it and the parsed
 * state. `unreadable` is a file that is there and cannot be parsed: the guard
 * lets that call through. An absent file is readable and declares no tier.
 */
export function declaredReviewTier(tasks) {
  if (!tasks) return { tier: undefined, state: undefined, unreadable: true };
  let text;
  try {
    text = readFileSync(path.join(tasks, "workflow-state.json"), "utf8");
  } catch (error) {
    return { tier: undefined, state: undefined, unreadable: error?.code !== "ENOENT" };
  }
  try {
    const state = JSON.parse(text);
    const tier = state?.reviewTier;
    return { tier: tier === 0 || tier === 1 || tier === 2 ? tier : undefined, state, unreadable: false };
  } catch {
    return { tier: undefined, state: undefined, unreadable: true };
  }
}

/**
 * Where the "this reviewer was started" markers of a run live: outside the
 * checkout, so the pilot cannot write one, and keyed on the run, the session
 * and the task directory. The task directory is the same from any directory
 * of the checkout, and another session or run in it does not see the markers.
 */
export function reviewMarkerDirectory(tasks, env = process.env, session = "") {
  const key = [env.IMPL_RUN_ID ?? "", String(session ?? ""), path.resolve(tasks || ".")].join("\0");
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 24);
  return path.join(os.tmpdir(), "implementation-factory-review-tier", digest);
}

/** Notes that a review agent has started, so a summary written by hand does not satisfy the floor. */
export function noteReviewAgent(tasks, env, session, agent) {
  try {
    const directory = reviewMarkerDirectory(tasks, env, session);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, agent), new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

/** When that agent last started, in milliseconds: 0 when it never did, undefined when the marker cannot be read. */
export function reviewAgentStartedAt(tasks, env, session, agent) {
  try {
    return statSync(path.join(reviewMarkerDirectory(tasks, env, session), agent)).mtimeMs;
  } catch (error) {
    return error?.code === "ENOENT" ? 0 : undefined;
  }
}

function listed(files) {
  const shown = files.slice(0, 5).join(", ");
  return files.length > 5 ? `${shown} and ${files.length - 5} more` : shown;
}

/**
 * The verdict of a review file: the first line under its `## Verdict` heading
 * when it is one of `tokens` and nothing else, so `NOT READY` or the template's
 * `READY | BLOCKED` is no verdict. A file older than `since`, the start of the
 * agent that writes it, was left by an earlier round and has none either.
 * `unreadable` is a file that is there and cannot be read.
 */
export function reviewVerdict(tasks, name, tokens, since = 0) {
  const file = path.join(tasks, name);
  let text;
  let written;
  try {
    text = readFileSync(file, "utf8");
    written = statSync(file).mtimeMs;
  } catch (error) {
    return { verdict: undefined, unreadable: error?.code !== "ENOENT" };
  }
  if (written < since) return { verdict: undefined, unreadable: false };
  const lines = text.split(/\r?\n/);
  const heading = lines.findIndex((line) => /^#{1,6}\s+verdict\s*$/i.test(line.trim()));
  if (heading < 0) return { verdict: undefined, unreadable: false };
  const first = lines.slice(heading + 1).find((line) => line.trim())?.trim().replace(/^[*_`]+|[*_`]+$/g, "");
  return { verdict: tokens.includes(first) ? first : undefined, unreadable: false };
}

const SUMMARY_VERDICTS = ["READY", "BLOCKED"];
const QA_VERDICTS = ["PASS", "PASS_WITH_WARNINGS", "INCONCLUSIVE", "FAIL"];
const READY_VERDICTS = ["READY", "PASS", "PASS_WITH_WARNINGS"];

/**
 * Why a review start or a merge request publication is below the tier the diff
 * requires, or undefined when it may go. A diff or a workflow state that cannot
 * be read lets the call through. A publication whose review is not ready has
 * to be a draft.
 */
export function reviewTierRefusal({ cwd, env = process.env, tasks, session = "", publishing = false, draft = false }) {
  // The state is read before git runs: an unreadable one, or a review already at the top tier, needs no diff.
  const declared = declaredReviewTier(tasks);
  if (declared.unreadable) return undefined;
  if (!publishing && declared.tier === 2) return undefined;
  const paths = changedPaths(cwd, env, declared.state);
  if (!paths) return undefined;
  const decision = reviewTierFloor(paths, sensitivePatterns(env));
  if (decision.floor === 0) return undefined;
  if (declared.tier === undefined || declared.tier < decision.floor) {
    const reason = decision.floor === 2
      ? `touches ${listed(decision.tierTwo)}, CI or a migration, so the review tier is at least 2`
      : `touches ${listed(decision.sensitive)}, a sensitive path, so the review tier is at least 1`;
    const where = publishing ? "The merge request cannot be published below that tier" : "The review cannot start below that tier";
    return `${where}: the diff ${reason}. Write reviewTier ${decision.floor} or higher in workflow-state.json, with baseBranch set to the branch it targets, then run that tier.`;
  }
  if (!publishing) return undefined;
  const orchestrated = reviewAgentStartedAt(tasks, env, session, "review-orchestrator");
  if (decision.floor >= 2) {
    if (orchestrated === undefined) return undefined;
    const files = listed(decision.tierTwo);
    if (orchestrated === 0) {
      return `This diff is tier 2 (${files}): start \`implementation-factory:review-orchestrator\` before publishing. A review summary written without that agent does not count.`;
    }
    const summary = reviewVerdict(tasks, "review-summary.md", SUMMARY_VERDICTS, orchestrated);
    if (summary.unreadable) return `This diff is tier 2 (${files}): review-summary.md cannot be read, so its verdict cannot be checked.`;
    if (!summary.verdict) {
      return `This diff is tier 2 (${files}): publish only after the orchestrator you started last writes review-summary.md with READY or BLOCKED alone under its \`## Verdict\` heading.`;
    }
    if (summary.verdict !== "READY" && !draft) return `This diff is tier 2 (${files}) and its review is ${summary.verdict}: open the merge request as a draft.`;
    return undefined;
  }
  const checked = reviewAgentStartedAt(tasks, env, session, "qa-reviewer");
  if (checked === undefined || orchestrated === undefined) return undefined;
  const files = listed(decision.sensitive);
  if (checked === 0 && orchestrated === 0) {
    return `This diff is at least tier 1 (${files}): start \`implementation-factory:qa-reviewer\` (or the review orchestrator) before publishing. A QA report written without that agent does not count.`;
  }
  const report = checked ? reviewVerdict(tasks, "qa-report.md", QA_VERDICTS, checked) : { verdict: undefined, unreadable: false };
  const summary = orchestrated ? reviewVerdict(tasks, "review-summary.md", SUMMARY_VERDICTS, orchestrated) : { verdict: undefined, unreadable: false };
  if (report.unreadable || summary.unreadable) return `This diff is at least tier 1 (${files}): qa-report.md or review-summary.md cannot be read, so its verdict cannot be checked.`;
  const verdicts = [report.verdict, summary.verdict].filter(Boolean);
  if (verdicts.length === 0) {
    return `This diff is at least tier 1 (${files}): publish only after the QA you started last writes qa-report.md with its verdict alone under \`## Verdict\`, or the orchestrator writes READY or BLOCKED in review-summary.md.`;
  }
  if (!verdicts.some((verdict) => READY_VERDICTS.includes(verdict)) && !draft) {
    return `This diff is at least tier 1 (${files}) and its review is ${verdicts.join(", ")}: open the merge request as a draft.`;
  }
  return undefined;
}

function directRun() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (directRun()) {
  let directory = path.resolve(process.cwd());
  let tasks;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(directory, ".claude", "tasks");
    if (existsSync(candidate)) { tasks = candidate; break; }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const declared = declaredReviewTier(tasks);
  const files = changedPaths(process.cwd(), process.env, declared.state);
  const decision = files ? reviewTierFloor(files, sensitivePatterns(process.env)) : { floor: 0, sensitive: [], tierTwo: [] };
  process.stdout.write(`${JSON.stringify({ ...decision, unreadable: !files, reviewTier: declared.tier ?? null })}\n`);
}
