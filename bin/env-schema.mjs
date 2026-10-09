import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function expandHome(value) {
  if (value === "~") return os.homedir();
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

export function splitRoots(value) {
  return value.split(",").map((root) => root.trim()).filter(Boolean);
}

function issue(severity, message) {
  return { severity, message };
}

function validateRoots(value) {
  const roots = splitRoots(value);
  if (roots.length === 0) return [issue("error", "at least one search root is expected")];
  return roots.flatMap((root) =>
    existsSync(path.resolve(expandHome(root))) ? [] : [issue("warning", `root not found: ${root}`)]);
}

function validateEnum(allowed) {
  return (value) => (allowed.includes(value) ? [] : [issue("error", `expected value: ${allowed.join(" or ")}`)]);
}

function validateInteger(min, max) {
  return (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      return [issue("error", `expected an integer between ${min} and ${max}`)];
    }
    return [];
  };
}

function validateText(value) {
  return value.trim() ? [] : [issue("error", "a non-empty value is expected")];
}

/** The console resolves the path as it is written, so a leading ~ would not be expanded. */
function validateOptionalAbsolutePath(value) {
  const trimmed = value.trim();
  return trimmed === "" || path.isAbsolute(trimmed) ? [] : [issue("error", "expected an absolute path, or nothing for the default file")];
}

/**
 * The permission modes Claude Code accepts, minus "plan", which answers a run
 * with a plan instead of a merge request.
 */
export const permissionModes = ["manual", "acceptEdits", "auto", "dontAsk", "bypassPermissions"];

/** The languages a run can write in. Anything else is read as English by the console. */
export const workflowLanguages = ["en", "fr"];

export const schema = [
  {
    key: "IMPL_SEARCH_ROOTS",
    label: "Repository search roots",
    comment: "Comma-separated directories scanned, up to two levels deep, for the checkout of a GitLab or GitHub issue.",
    help: "Directories scanned, up to two levels deep, to find the checkout of a ticket. Comma-separated.",
    fallback: "~/workspace",
    kind: "list",
    readBy: "console",
    validate: validateRoots,
  },
  {
    key: "IMPL_PERMISSION_MODE",
    label: "Permission mode of the runs",
    comment: "Permission mode every run is started with; 'manual' asks before each tool and stops an unattended run.",
    help: "Permission mode of every run. 'manual' asks before each tool and blocks an unattended run.",
    fallback: "auto",
    kind: "choice",
    options: permissionModes,
    readBy: "console",
    validate: validateEnum(permissionModes),
  },
  {
    key: "IMPL_LANGUAGE",
    label: "Language of what the workflow writes",
    comment: "Language of what the workflow writes for people (questions, reports, merge request text): 'en' or 'fr'. The interface itself is in English.",
    help: "Language of the questions, the reports and the merge request text a run writes: 'en' for English, 'fr' for French. The interface stays in English.",
    fallback: "en",
    kind: "choice",
    options: workflowLanguages,
    readBy: "console",
    validate: validateEnum(workflowLanguages),
  },
  {
    key: "IMPL_SELF_IMPROVEMENT_AUTORUN",
    label: "Self-improvement on a run that went wrong",
    comment: "Open a self-improvement session at the end of a run that proved something went wrong.",
    help: "Opens a self-improvement session at the end of a run that proved something went wrong, or when feedback is waiting.",
    fallback: "true",
    kind: "boolean",
    readBy: "console",
    validate: validateEnum(["true", "false"]),
  },
  {
    key: "IMPL_SELF_IMPROVEMENT_AUTOMERGE",
    label: "Merge self-improvements without review",
    comment: "'judged' merges a finished self-improvement branch on its own once mechanical rules, the checks rerun by the console and an independent judge (Opus) agree; 'off' leaves every branch to you.",
    help: "'judged': a finished improvement branch is merged without you when it touches no protected file, stays small, passes the checks the console reruns and convinces an independent judge. Anything else is held for you. The console restarts itself once no run is working when the merge changes its code. 'off': every branch waits for your click.",
    fallback: "judged",
    kind: "choice",
    options: ["off", "judged"],
    readBy: "console",
    validate: validateEnum(["off", "judged"]),
  },
  {
    key: "IMPL_REMOTE_CONTROL",
    label: "Remote Control on the terminal of a run",
    comment: "Set to 'false' to start a run without Remote Control, which makes its terminal reachable from claude.ai on your own account.",
    help: "Makes the terminal of a run reachable from claude.ai, on the account already authenticated.",
    fallback: "true",
    kind: "boolean",
    readBy: "console",
    validate: validateEnum(["true", "false"]),
  },
  {
    key: "IMPL_PORT",
    label: "Listening port",
    comment: "Port the local server and the browser use.",
    help: "Port of the local server and the interface.",
    fallback: "3210",
    kind: "port",
    readBy: "both",
    validate: validateInteger(1, 65535),
  },
  {
    key: "IMPL_HOST",
    label: "Listening interface",
    comment: "Network interface the local server binds to.",
    help: "Network interface of the local server.",
    fallback: "127.0.0.1",
    kind: "text",
    readBy: "console",
    validate: validateText,
  },
  {
    key: "IMPL_NO_OPEN",
    label: "Start without opening the browser",
    comment: "Set to 1 to start without opening the browser.",
    help: "1 to start without opening the browser.",
    fallback: "0",
    kind: "flag",
    readBy: "launcher",
    validate: validateEnum(["0", "1"]),
  },
  {
    key: "IMPL_MAX_CONCURRENT_RUNS",
    label: "Runs held in parallel",
    comment: "How many Claude Code sessions the console holds at once; further launches wait in a queue.",
    help: "Number of Claude Code sessions held at once. Past it, launches wait in the queue.",
    fallback: "3",
    kind: "text",
    readBy: "console",
    validate: validateInteger(1, 10),
  },
  {
    key: "IMPL_SCHEDULE_TIMEOUT_MINUTES",
    label: "Time allowed for the analysis of a batch, in minutes",
    comment: "Minutes the analysis of a batch of tickets may take per repository; past it, the tickets of that repository run one at a time.",
    help: "Minutes allowed for the analysis of a batch of tickets, per repository. Past it, the tickets of that repository run one at a time.",
    fallback: "5",
    kind: "text",
    readBy: "console",
    validate: validateInteger(1, 60),
  },
  {
    key: "IMPL_TICKET_PROPOSALS_FILE",
    label: "File of the ticket proposals",
    comment: "Absolute path of the file an outside watcher keeps up to date with the tickets to propose; leave empty for ticket-proposals.json in the data directory.",
    help: "Absolute path of the file an outside watcher writes the tickets to propose in. Empty for ticket-proposals.json in the data directory.",
    fallback: "",
    kind: "text",
    readBy: "console",
    validate: validateOptionalAbsolutePath,
  },
  {
    key: "IMPL_WORKTREE_DEPENDENCY_DIRS",
    label: "Dependency directories brought into the worktree of a run",
    comment: "Comma-separated names of ignored dependency directories the worktree of a run takes from the main checkout, at any depth: cloned copy-on-write, symlinked where a clone is not possible. Never list build outputs.",
    help: "Names of the dependency directories ignored by git that the worktree of a run takes from the main checkout, at any depth. Comma-separated. No build outputs.",
    fallback: "node_modules",
    kind: "list",
    readBy: "console",
    validate: validateText,
  },
  {
    key: "IMPL_WORKTREE_COPY_FILES",
    label: "Configuration files copied into the worktree of a run",
    comment: "Comma-separated ignored files copied from the main checkout into the worktree of a run: a name pattern such as .env*, or a path from the repository root.",
    help: "Files ignored by git copied from the main checkout into the worktree of a run: a name pattern such as .env*, or a path from the repository root. Comma-separated.",
    fallback: ".env*,.claude/settings.local.json",
    kind: "list",
    readBy: "console",
    validate: validateText,
  },
  {
    key: "IMPL_STALL_MINUTES",
    label: "Silence before a doubt, in minutes",
    comment: "Minutes without any progress before the console voices a doubt about a run in progress. A doubt only: it never stops nor restarts anything.",
    help: "Minutes without any progress before the console voices a doubt about a run in progress. A doubt only: nothing is stopped or restarted.",
    fallback: "10",
    kind: "text",
    readBy: "console",
    validate: validateInteger(1, 1440),
  },
  {
    key: "IMPL_DEMO_STEP_MS",
    label: "Duration of a demo mode step, in milliseconds",
    comment: "Duration of each step of the simulated scenario, in milliseconds.",
    help: "Duration of each step of the simulated scenario, in milliseconds.",
    fallback: "5000",
    kind: "duration",
    readBy: "console",
    validate: validateInteger(1, 3_600_000),
  },
];

export function descriptorFor(key) {
  return schema.find((entry) => entry.key === key);
}

/** Anything the console reads only reaches it through a restart. */
export function needsRestart(descriptor) {
  return descriptor.readBy !== "launcher";
}
