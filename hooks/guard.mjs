import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const NAMESPACE = "implementation-harness";
const AGENTS = ["ticket-planner", "developer", "senior-reviewer", "designer-reviewer", "qa-reviewer", "review-orchestrator", "ticket-scheduler"];
const REVIEWERS = ["senior-reviewer", "designer-reviewer", "qa-reviewer", "review-orchestrator"];
// The model the developer declares, and the one the pilot may pass for a task the plan sizes `L`.
const DEVELOPER_MODELS = ["sonnet", "opus"];
const PUBLISHING = /\bgit\b[^|;&\n]*\bcommit\b|\bglab\s+(?:mr|issue)\s+(?:create|update|note)\b|\bgh\s+(?:pr|issue)\s+(?:create|edit|comment)\b/;
/** A call that writes on the forge through its API: how a merge request and its review comment are published on GitLab. */
const API_WRITE = /\b(?:glab|gh)\s+api\b[^|;&\n]*(?:--method|-X)[\s=]*(?:POST|PUT|PATCH)\b/i;
/**
 * What a credential looks like, by the shape its issuer gives it. Shapes only,
 * and long ones: a word such as "password" or a short example in a sentence
 * would refuse descriptions that publish nothing secret.
 * @type {[string, RegExp][]}
 */
const SECRETS = [
  ["a GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/],
  ["a GitLab token", /\bgl(?:pat|ptt|dt|rt|cbt)-[A-Za-z0-9_-]{20,}/],
  ["a Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["an AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["an API key", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/],
  ["a signed token (JWT)", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["a bearer token", /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/],
];
/** A file whose content the command sends: `key=@file`, `--body-file file`, `-F file`, `$(cat file)`. A file it only mentions is not read. */
const PUBLISHED_FILE = /(?:@|(?:--body-file|--file|-F|\bcat)[\s=]+["']?)((?:\.{0,2}\/)?[\w.@/-]+)/g;
const MAX_PUBLISHED_BYTES = 1_000_000;
const SESSION_TRACE = /co-authored-by:|claude-session:|claude\.ai\/code\/session_|generated with \[claude code\]/i;

/** The task directory of the workflow, from the session's directory or one of its parents. */
export function taskDirectory(cwd) {
  let directory = path.resolve(cwd || ".");
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(directory, ".claude", "tasks");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

/**
 * The guard only speaks inside a run of the workflow: the plugin's hooks fire in
 * every session that loads it, and an agent named `developer` or a commit trailer
 * is nobody's business there.
 */
export function inWorkflow(env, tasks) {
  return Boolean(env.IMPL_RUN_ID) || Boolean(tasks && existsSync(path.join(tasks, "workflow-state.json")));
}

/** Plan tasks no developer reported on and the merged report does not name. */
function unreportedTasks(tasks) {
  let plan;
  try { plan = JSON.parse(readFileSync(path.join(tasks, "planner-output.json"), "utf8")); } catch { return []; }
  const ids = Array.isArray(plan?.tasks) ? plan.tasks.map((task) => task?.id).filter((id) => typeof id === "string" && id) : [];
  let merged = "";
  try { merged = readFileSync(path.join(tasks, "developer-report.md"), "utf8"); } catch { /* no merged report yet */ }
  return ids.filter((id) => {
    if (existsSync(path.join(tasks, `developer-report-${id}.md`))) return false;
    return !new RegExp(`(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(merged);
  });
}

/** Whether the session works in a linked git worktree: every run the console starts, and a session opened in one by hand. */
function inLinkedWorktree(cwd, env) {
  if (env.IMPL_RUN_WORKTREE) return true;
  let directory = path.resolve(cwd || ".");
  for (let depth = 0; depth < 12; depth += 1) {
    try { return statSync(path.join(directory, ".git")).isFile(); } catch { /* not the root of a checkout */ }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return false;
}

/**
 * The simple commands of a shell line, each as its words with the quotes
 * removed. Enough to read a git invocation typed on the line, and nothing more:
 * what a quoted string, a substitution or a script runs is not looked at, so a
 * commit message that quotes a forbidden command is never taken for one.
 */
export function shellCommands(text) {
  const source = String(text).replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2(?=\n|$)/g, " ");
  const commands = [];
  let words = [];
  let word = "";
  let started = false;
  let quote = "";
  const endWord = () => { if (started) words.push(word); word = ""; started = false; };
  const endCommand = () => { endWord(); if (words.length) commands.push(words); words = []; };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = "";
      else if (char === "\\" && quote === "\"" && index + 1 < source.length) { index += 1; word += source[index]; }
      else word += char;
    } else if (char === "'" || char === "\"") { quote = char; started = true; }
    else if (char === "\\" && index + 1 < source.length) { index += 1; if (source[index] !== "\n") { word += source[index]; started = true; } }
    else if (/\s/.test(char) && char !== "\n") endWord();
    else if (";\n|&(){}`".includes(char)) endCommand();
    else { word += char; started = true; }
  }
  endCommand();
  return commands;
}

const GIT_OPTIONS_WITH_VALUE = ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix", "--config-env", "--attr-source"];

/**
 * The subcommand and arguments of a git invocation, or undefined when the words
 * run something else. Git is looked for among the words, not only in front: a
 * shell keyword (`then`, `do`, `!`), a wrapper (`sudo`, `xargs`, `timeout 5`)
 * or an absolute path put it anywhere, and a list of the prefixes that may come
 * first is a list something is always missing from. The price is a line that
 * only mentions such a command without quoting it (`echo run git reset --hard`),
 * refused too: the refusal says why, and quoting the text lets it through. An
 * assignment is never the command, whatever its value ends with. A redirection
 * glued to an argument is not part of it.
 */
function gitInvocation(words) {
  let index = words.findIndex((word) => !/^\w+=/.test(word) && (word === "git" || word.endsWith("/git")));
  if (index < 0) return undefined;
  index += 1;
  while (index < words.length && words[index].startsWith("-")) index += GIT_OPTIONS_WITH_VALUE.includes(words[index]) ? 2 : 1;
  const args = words.slice(index + 1).map((arg) => arg.replace(/\d*[<>].*$/, "")).filter(Boolean);
  return index < words.length ? { subcommand: words[index], args } : undefined;
}

/** Whether a path given to git covers the whole tree: the directory the command runs in, one above it, or a pattern that matches everything. */
function coversWholeTree(arg, cwd) {
  if (arg.startsWith("-")) return false;
  // `:/` and `:(top)` name the root of the tree only when nothing, or everything, follows them: `:/src/a.ts` is one file.
  const fromRoot = /^(?::\/|:\(top[^)]*\))(.*)$/.exec(arg);
  if (fromRoot) return ["", ".", "./", "*", "**"].includes(fromRoot[1]);
  if (["*", "**", "./*", "./**"].includes(arg)) return true;
  const here = path.resolve(cwd || ".");
  const target = path.resolve(here, arg);
  return target === here || here.startsWith(target.endsWith(path.sep) ? target : `${target}${path.sep}`);
}

/** A short option among the arguments, alone or in a cluster: `-f`, `-fd`, `-xfd`. */
function hasFlag(args, letter, long) {
  return args.some((arg) => arg === long || (/^-[A-Za-z]+$/.test(arg) && arg.includes(letter)));
}

/** Why a git command typed on the line is refused, or undefined when it may run. */
function gitRefusal({ subcommand, args }, { cwd, env, linked }) {
  const wholeTree = args.some((arg) => coversWholeTree(arg, cwd));
  switch (subcommand) {
    case "reset":
      if (args.includes("--hard")) return "`git reset --hard` destroys uncommitted work with no way back. Commit what is yours, or stop and report the git state.";
      break;
    case "clean":
      if (hasFlag(args, "f", "--force") && !hasFlag(args, "n", "--dry-run")) return "`git clean -f` deletes untracked files with no way back. List them with `git clean -n`, then remove by absolute path the ones this run created.";
      break;
    case "checkout":
      if (wholeTree || hasFlag(args, "f", "--force")) return "This checkout discards every uncommitted change of the tree. Name the files this run owns, or stop and report the git state.";
      if (linked && (args.includes("-B") || args.includes("--ignore-other-worktrees"))) return "An existing branch is never overwritten or taken from another worktree. Create the branch with `git switch -c`, under a suffixed name when it exists.";
      break;
    case "restore":
      if (wholeTree && (!args.some((arg) => arg === "--staged" || arg === "-S") || args.some((arg) => arg === "--worktree" || arg === "-W"))) return "This restore discards every uncommitted change of the tree. Name the files this run owns, or stop and report the git state.";
      break;
    case "switch":
      if (args.includes("--discard-changes") || hasFlag(args, "f", "--force")) return "This switch discards uncommitted changes. Commit what is yours first, or stop and report the git state.";
      if (linked && (args.includes("-C") || args.includes("--force-create") || args.includes("--ignore-other-worktrees"))) return "An existing branch is never overwritten or taken from another worktree. Create the branch with `git switch -c`, under a suffixed name when it exists.";
      break;
    case "push":
      if (hasFlag(args, "f", "--force") || args.some((arg) => /^\+[^\s]/.test(arg))) return "A bare forced push overwrites whatever the remote holds. When the user asked for it, use `--force-with-lease` after checking the remote holds nothing you lack.";
      break;
    case "worktree": {
      if (args[0] === "prune") return "`git worktree prune` is never run by the workflow: the console owns the run worktrees.";
      const run = env.IMPL_RUN_WORKTREE ? path.resolve(env.IMPL_RUN_WORKTREE) : undefined;
      const targets = args.slice(1).filter((arg) => !arg.startsWith("-")).map((arg) => path.resolve(cwd || ".", arg));
      if (args[0] === "remove" && targets.some((target) => target === run || target.split(path.sep).join("/").includes("/.claude/worktrees/"))) {
        return "A run worktree is never removed by the workflow: the console removes it after the session ends. Only the throwaway QA worktree, outside `.claude/worktrees/`, is yours to remove.";
      }
      break;
    }
    case "stash":
      if (linked && !["list", "show"].includes(args[0])) return "Nothing is stashed in worktree mode: the stash list is shared with the main checkout and every other run. Commit what is yours, or stop and report.";
      break;
    case "branch":
      if (linked && args.some((arg) => ["-D", "-d", "--delete", "-M", "-C", "-f", "--force"].includes(arg))) return "In worktree mode a branch is never deleted or overwritten: the ticket branch stays in place for the console and the user.";
      break;
    default:
  }
  return undefined;
}

/** The first credential a text shows, as its kind and its line, never the value. */
function secretIn(text) {
  for (const [kind, shape] of SECRETS) {
    const found = shape.exec(text);
    if (found) return { kind, line: text.slice(0, found.index).split("\n").length };
  }
  return undefined;
}

/**
 * Why a publication is refused for a credential it would make public: one typed
 * in the command, or one in a text file the command names, which is how a
 * description and a review comment reach the forge.
 */
function publishedSecret(command, cwd) {
  const typed = secretIn(command);
  if (typed) return `This publication carries what looks like ${typed.kind}, typed in the command. Replace it with \`<redacted>\` and run the command again.`;
  const files = new Set([...command.matchAll(PUBLISHED_FILE)].map((match) => path.resolve(cwd || ".", match[1])));
  for (const file of files) {
    let text;
    try {
      const stats = statSync(file);
      if (!stats.isFile() || stats.size > MAX_PUBLISHED_BYTES) continue;
      text = readFileSync(file, "utf8");
    } catch { continue; }
    const found = secretIn(text);
    if (found) return `This publication carries what looks like ${found.kind}, in ${path.basename(file)} line ${found.line}. Replace it with \`<redacted>\` in that file and run the command again. A signed address counts: it lets anyone who reads the page open what it points to.`;
  }
  return undefined;
}

/** What a forge API call of the scheduling session may ask for: the links of one issue, and nothing that is sent. */
const SCHEDULE_API_ENDPOINT = /^(?:projects\/[^/\s]+|repos\/[^/\s]+\/[^/\s]+)\/issues\/\d+(?:\/links|\/dependencies\/(?:blocked_by|blocking))?$/;

/** Whether the arguments of `glab api` or `gh api` only read one issue or its links: one endpoint, and no option but the ones that shape the answer. */
function readsIssueLinks(args) {
  const endpoints = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (["--hostname", "--jq", "-q"].includes(arg)) index += 1;
    else if (arg === "--paginate" || /^--(?:hostname|jq)=/.test(arg)) continue;
    else if (arg.startsWith("-")) return false;
    else endpoints.push(arg);
  }
  return endpoints.length === 1 && SCHEDULE_API_ENDPOINT.test(endpoints[0]);
}

/**
 * Why a call of the headless scheduling session is refused. That session reads
 * the text of tickets anyone who can file one controls, with the user's forge
 * credentials and nobody to answer a prompt, and its list of allowed tools
 * matches a command by its first words: `gh api` allowed is `gh api -X DELETE`
 * allowed. So what it may do is decided here, on the input of each call: write
 * its one output file, start its one agent, read an issue and its links.
 */
function scheduleRefusal(payload, output) {
  const input = payload.tool_input ?? {};
  const tool = payload.tool_name;
  const target = path.resolve(output);
  if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool)) {
    const file = typeof input.file_path === "string" ? path.resolve(payload.cwd || ".", input.file_path) : undefined;
    if (tool !== "Write" || file !== target) return `The scheduling session writes its output file and nothing else: ${target}.`;
  }
  if ((tool === "Agent" || tool === "Task") && input.subagent_type !== `${NAMESPACE}:ticket-scheduler`) {
    return `The scheduling session starts \`${NAMESPACE}:ticket-scheduler\` and no other agent.`;
  }
  if (tool !== "Bash") return undefined;
  for (const words of shellCommands(typeof input.command === "string" ? input.command : "")) {
    // The command is the first word past the assignments: the session's list of allowed tools
    // refuses any other first word (a wrapper, a keyword), so nothing hides the command here,
    // and a later word that merely reads `gh` or `rm` (`git grep -n gh src`) is an argument.
    const [command, ...args] = words.slice(words.findIndex((word) => !/^\w+=/.test(word)));
    const name = path.basename(command ?? "");
    if (name === "glab" || name === "gh") {
      const [group, action, ...rest] = args;
      const reads = (group === "issue" && action === "view") || (group === "api" && readsIssueLinks([action, ...rest].filter((word) => word !== undefined)));
      if (!reads) return "The scheduling session only reads tickets: `glab issue view` or `gh issue view`, and an API call that names one issue or its links, with no method, field or input option.";
    }
    if (name === "rm" && args.some((word) => word.startsWith("-") || path.resolve(payload.cwd || ".", word) !== target)) {
      return `The scheduling session removes its own output file and nothing else: ${target}.`;
    }
  }
  return undefined;
}

/** The reason a tool call is refused, or undefined when it may go. */
export function guardDecision(payload, env = process.env) {
  if (payload?.hook_event_name !== "PreToolUse") return undefined;
  // The scheduling session is not a run of the workflow: it has rules of its own, and only those.
  if (env.IMPL_SCHEDULE_OUTPUT) return scheduleRefusal(payload, env.IMPL_SCHEDULE_OUTPUT);
  const tasks = taskDirectory(payload.cwd);
  if (!inWorkflow(env, tasks)) return undefined;
  const input = payload.tool_input ?? {};

  if (payload.tool_name === "Agent" || payload.tool_name === "Task") {
    const type = typeof input.subagent_type === "string" ? input.subagent_type : "";
    if (AGENTS.includes(type)) {
      return `Invoke \`${NAMESPACE}:${type}\`, not the bare name \`${type}\`: an agent of the same name installed beside this plugin wins the dispatch and the run gets another output contract.`;
    }
    const agent = type.startsWith(`${NAMESPACE}:`) ? type.slice(NAMESPACE.length + 1) : "";
    if (agent === "developer" && typeof input.model === "string" && input.model && !DEVELOPER_MODELS.includes(input.model)) {
      return `Invoke \`${NAMESPACE}:developer\` without a model override, or with \`opus\` for a task the plan sizes \`L\`: the developer runs on Sonnet, the model its definition declares.`;
    }
    if (tasks && REVIEWERS.includes(agent)) {
      const missing = unreportedTasks(tasks);
      if (missing.length) {
        return `The review cannot start: ${missing.join(", ")} of planner-output.json ${missing.length > 1 ? "have" : "has"} no developer-report-<id>.md. Run each one now with ${NAMESPACE}:developer, or name it in developer-report.md with what covers it instead and why.`;
      }
    }
    return undefined;
  }

  if (payload.tool_name === "Bash") {
    const command = typeof input.command === "string" ? input.command : "";
    if (PUBLISHING.test(command) && SESSION_TRACE.test(command)) {
      return "Nothing this run publishes carries a trace of the session: remove the Co-Authored-By or Claude-Session trailer, the claude.ai/code/session_ link and the \"Generated with\" line, then run the command again.";
    }
    if (PUBLISHING.test(command) || API_WRITE.test(command)) {
      const secret = publishedSecret(command, payload.cwd);
      if (secret) return secret;
    }
    const context = { cwd: payload.cwd, env, linked: inLinkedWorktree(payload.cwd, env) };
    for (const words of shellCommands(command)) {
      const git = gitInvocation(words);
      const refused = git && gitRefusal(git, context);
      if (refused) return refused;
    }
  }
  return undefined;
}

export function denial(reason) {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
}
