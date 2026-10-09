import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { acceptanceUrl, artifactUrl, generatedDocuments, runLabel } from "../lib/run-state";
import { normalizeTicketUrl, parseTicketUrls, ticketReference } from "../lib/ticket-urls";
import type { ImprovementMetrics } from "../lib/types";
import type { AcceptanceView, FactorySnapshot, IncidentAction, RunMetrics, RunState, RunSummary } from "../server/types.js";
import { answerOf, CliError, connect, getJson, type Link } from "./client";
import { follow, askQuestions, attach, watchFactory } from "./live";
import { incidentWords, renderEvidence, renderFactory, renderMetrics, renderProposals, renderQuestion, renderQueue, renderRun, renderSessionPrompt, table } from "./format";
import { answersFromInputs, resolveQueued, resolveRun, shortId } from "./select";

/** Exit code of a command that was not written the way it is used. */
export const USAGE = 2;

export type Context = { base: string; program: string; print: (text: string) => void; interactive: boolean };
type Options = NonNullable<ParseArgsConfig["options"]>;

function parse<T extends Options>(argv: string[], options: T) {
  try { return parseArgs({ args: argv, options, allowPositionals: true, strict: true }); }
  catch (error) { throw new CliError(error instanceof Error ? error.message : "Unreadable arguments.", USAGE); }
}

function required(value: string | undefined, what: string): string {
  if (!value?.trim()) throw new CliError(`Missing ${what}.`, USAGE);
  return value;
}

function json(context: Context, value: unknown) {
  context.print(JSON.stringify(value, null, 2));
}

async function factory(context: Context) {
  const snapshot = await getJson(context.base, "/api/runs") as Partial<FactorySnapshot> | null;
  if (!snapshot || !Array.isArray(snapshot.runs) || !Array.isArray(snapshot.queued)) throw new CliError(`${context.base} does not answer like the console.`);
  return { runs: snapshot.runs, queued: snapshot.queued, maxConcurrentRuns: snapshot.maxConcurrentRuns ?? 0, archived: snapshot.archived ?? [], proposals: snapshot.proposals ?? [] } satisfies FactorySnapshot;
}

/** A run named on the command line, with its full state: read from its archive when the console no longer holds it. */
async function runNamed(context: Context, reference: string | undefined) {
  const summary = resolveRun(required(reference, "the run"), await factory(context));
  const { state } = await getJson(context.base, `/api/${summary.archived ? "archive/" : ""}runs/${encodeURIComponent(summary.id)}`) as { state: RunState };
  return { summary, state };
}

/** One message sent to the console, acknowledged or refused, with whatever it answered. */
async function act(context: Context, work: (link: Link) => Promise<void>) {
  const link = await connect(context.base);
  try { await work(link); } finally { link.close(); }
}

function absolute(target: string) {
  return path.resolve(process.cwd(), target);
}

const RUN_OPTIONS = { repo: { type: "string", multiple: true, short: "r" }, instruction: { type: "string", short: "m" }, follow: { type: "boolean", short: "f" }, demo: { type: "boolean" } } satisfies Options;

/** `run <ticket-url>...`: one ticket starts or queues a run, several are queued as a batch and compared first. */
async function run(context: Context, argv: string[]) {
  const { values, positionals } = parse(argv, RUN_OPTIONS);
  const link = await connect(context.base);
  try {
    const requestId = randomUUID();
    const started = async (answers: Awaited<ReturnType<Link["request"]>>) => {
      const created = answers.find((message) => message.type === "run.started" && message.requestId === requestId);
      if (created?.type !== "run.started") return undefined;
      context.print(`Run started: ${shortId(created.runId)} (${created.runId})`);
      if (values.follow) return follow(context, link, created.runId);
      context.print(`Follow it: ${context.program} watch ${shortId(created.runId)}`);
      return 0;
    };

    if (values.demo) {
      const scenario = positionals[0] ?? "workflow";
      if (scenario !== "workflow" && scenario !== "incident" && scenario !== "batch") throw new CliError(`Unknown demo scenario: ${scenario}. Choose workflow, incident or batch.`, USAGE);
      const code = await started(await link.request({ type: "demo.start", scenario, requestId }));
      if (code === undefined) context.print(`Demo batch queued. See it: ${context.program} runs`);
      return code ?? 0;
    }

    const { tickets, invalid } = parseTicketUrls(positionals.join("\n"));
    if (invalid.length > 0) throw new CliError(`Not a ticket address: ${invalid.map((entry) => entry.text).join(", ")}`, USAGE);
    const [ticket] = tickets;
    if (!ticket) throw new CliError("Missing the address of a ticket.", USAGE);
    const repositories = (values.repo ?? []).map(absolute);
    const instruction = values.instruction?.trim() ? { instruction: values.instruction } : {};

    if (tickets.length === 1 && repositories.length <= 1) {
      let cwd = repositories[0];
      if (!cwd) {
        const { detected } = await getJson(context.base, `/api/repositories?issueUrl=${encodeURIComponent(ticket)}`) as { detected: { path: string } | null };
        if (!detected) throw new CliError(`No checkout of this ticket's project was found under the search roots. Name the one its work goes to: --repo <path>`);
        cwd = detected.path;
      }
      const answers = await link.request({ type: "run.start", cwd, issueUrl: ticket, requestId, ...instruction });
      const code = await started(answers);
      if (code !== undefined) return code;
      const queued = answers.find((message) => message.type === "notice" && message.requestId === requestId);
      context.print(queued?.type === "notice" ? `${queued.title}. ${queued.detail ?? ""}`.trim() : "Run queued.");
      context.print(`See the queue: ${context.program} queue`);
      return 0;
    }

    const targets = repositories.length > 0 ? { targets: Object.fromEntries(tickets.map((url) => [url, repositories])) } : {};
    const answers = await link.request({ type: "batch.submit", issueUrls: tickets, ...instruction, ...targets });
    const unresolved = answerOf(answers, "batch.unresolved");
    if (unresolved) throw new CliError(`No checkout was found for ${unresolved.tickets.map((entry) => ticketReference(entry.issueUrl)).join(", ")}. Name where the work goes: --repo <path>`);
    const result = answerOf(answers, "batch.result");
    context.print(`${result?.accepted ?? 0} ticket${result?.accepted === 1 ? "" : "s"} queued${result?.duplicates.length ? `, ${result.duplicates.length} already known and left out` : ""}.`);
    context.print(`See the queue: ${context.program} queue`);
    return 0;
  } finally { link.close(); }
}

const JSON_OPTION = { json: { type: "boolean" } } satisfies Options;

async function runs(context: Context, argv: string[]) {
  const { values } = parse(argv, JSON_OPTION);
  const snapshot = await factory(context);
  if (values.json) json(context, snapshot); else context.print(renderFactory(snapshot, Date.now()));
  return 0;
}

async function show(context: Context, argv: string[]) {
  const { values, positionals } = parse(argv, JSON_OPTION);
  const { state } = await runNamed(context, positionals[0]);
  if (values.json) json(context, state); else context.print(renderRun(state, Date.now(), context.program));
  return 0;
}

async function watch(context: Context, argv: string[]) {
  const { positionals } = parse(argv, {});
  const link = await connect(context.base);
  try {
    if (!positionals[0]) return await watchFactory(context, link);
    const summary = resolveRun(positionals[0], link.snapshot());
    if (summary.archived) throw new CliError(`This run is read from its archive and no longer moves. Read it: ${context.program} show ${shortId(summary.id)}`);
    return await follow(context, link, summary.id);
  } finally { link.close(); }
}

async function attachCommand(context: Context, argv: string[]) {
  const { positionals } = parse(argv, {});
  const link = await connect(context.base);
  try {
    const summary = resolveRun(required(positionals[0], "the run"), link.snapshot());
    if (summary.archived) throw new CliError("This run is read from its archive: it has no terminal.");
    return await attach(link, summary);
  } finally { link.close(); }
}

async function answer(context: Context, argv: string[]) {
  const { positionals } = parse(argv, {});
  const [reference, ...inputs] = positionals;
  const { summary, state } = await runNamed(context, reference);
  const pending = state.pendingQuestion;
  if (!pending) throw new CliError(state.sessionPrompt ? `This run waits on the trust of its directory. Answer: ${context.program} trust ${shortId(summary.id)} accept|refuse` : "This run waits on no decision.");
  let answers: Record<string, string>;
  if (inputs.length > 0) answers = answersFromInputs(pending, inputs);
  else if (context.interactive) {
    context.print(renderQuestion(pending));
    const typed = await askQuestions(pending);
    if (!typed) return 1;
    answers = typed;
  } else {
    context.print(renderQuestion(pending));
    throw new CliError(`Give one answer per question, the number of a choice or your own words: ${context.program} answer ${shortId(summary.id)} <answer>...`, USAGE);
  }
  await act(context, async (link) => { await link.request({ type: "question.answer", runId: summary.id, answers }); });
  context.print("Answer sent.");
  return 0;
}

async function trust(context: Context, argv: string[]) {
  const { positionals } = parse(argv, {});
  const decision = positionals[1];
  if (decision !== "accept" && decision !== "refuse") throw new CliError("Say accept or refuse.", USAGE);
  const { summary, state } = await runNamed(context, positionals[0]);
  const prompt = state.sessionPrompt;
  if (!prompt) throw new CliError("This run asks for no trust decision.");
  context.print(renderSessionPrompt(prompt));
  await act(context, async (link) => { await link.request({ type: "sessionPrompt.answer", runId: summary.id, promptId: prompt.id, decision }); });
  context.print(decision === "accept" ? "Directory trusted." : "Refused: the run stops.");
  return 0;
}

/** A command that sends one message about a run and has nothing to read back. */
function onRun(build: (run: RunSummary, rest: string[]) => Parameters<Link["request"]>[0], done: string) {
  return async (context: Context, argv: string[]) => {
    const { positionals } = parse(argv, {});
    const [reference, ...rest] = positionals;
    const summary = resolveRun(required(reference, "the run"), await factory(context));
    await act(context, async (link) => { await link.request(build(summary, rest)); });
    context.print(`${runLabel(summary)}: ${done}`);
    return 0;
  };
}

const QUEUE_OPTIONS = { ...JSON_OPTION, stacked: { type: "boolean" }, onto: { type: "string" }, before: { type: "string" }, end: { type: "boolean" } } satisfies Options;

async function queue(context: Context, argv: string[]) {
  const { values, positionals } = parse(argv, QUEUE_OPTIONS);
  const [action, reference] = positionals;
  const { queued } = await factory(context);
  if (!action) {
    if (values.json) json(context, queued); else context.print(renderQueue(queued));
    return 0;
  }
  if (action !== "cancel" && action !== "force" && action !== "move") throw new CliError(`Unknown queue action: ${action}. Choose cancel, force or move.`, USAGE);
  const entry = resolveQueued(required(reference, "the queued launch"), queued);
  if (action === "cancel") {
    await act(context, async (link) => { await link.request({ type: "queue.cancel", queuedId: entry.id }); });
    context.print(`${runLabel(entry)}: removed from the queue.`);
    return 0;
  }
  if (action === "force") {
    const onto = values.onto === undefined ? undefined : normalizeTicketUrl(values.onto);
    if (values.onto !== undefined && !onto) throw new CliError(`--onto takes the address of a ticket, got: ${values.onto}`, USAGE);
    const stacked = values.stacked === true || onto !== undefined;
    await act(context, async (link) => { await link.request({ type: "queue.force", queuedId: entry.id, mode: stacked ? "stacked" : "base", ...(onto ? { onto } : {}) }); });
    context.print(`${runLabel(entry)}: starts as soon as a slot is free, ${stacked ? "on the branch of the ticket it waits for" : "from the base branch"}.`);
    return 0;
  }
  if (values.end === (values.before !== undefined)) throw new CliError("Say where it goes: --before <queued launch> or --end.", USAGE);
  const before = values.before === undefined ? null : resolveQueued(values.before, queued).id;
  await act(context, async (link) => { await link.request({ type: "queue.move", queuedId: entry.id, before }); });
  context.print(`${runLabel(entry)}: moved.`);
  return 0;
}

async function worktree(context: Context, argv: string[]) {
  const { values, positionals } = parse(argv, { force: { type: "boolean" } });
  if (positionals[0] !== "rm") throw new CliError(`Usage: ${context.program} worktree rm <run> [--force]`, USAGE);
  const summary = resolveRun(required(positionals[1], "the run"), await factory(context));
  let code = 0;
  await act(context, async (link) => {
    const result = answerOf(await link.request({ type: "worktree.remove", runId: summary.id, ...(values.force ? { force: true } : {}) }), "worktree.result");
    if (!result) throw new CliError("The console did not say what became of the worktree.");
    if (result.outcome === "refused") throw new CliError(result.message);
    context.print(result.message);
    if (result.outcome === "confirm") {
      for (const risk of result.risks ?? []) context.print(`  ${risk}`);
      context.print(`Nothing was removed. To remove it anyway: ${context.program} worktree rm ${shortId(summary.id)} --force`);
      code = 1;
    }
  });
  return code;
}

const INCIDENT_ACTIONS: Record<string, IncidentAction> = { continue: "request_continuation", stop: "stop", dismiss: "dismiss" };

async function incident(context: Context, argv: string[]) {
  const { values, positionals } = parse(argv, { reason: { type: "string" } });
  const { summary, state } = await runNamed(context, positionals[0]);
  const open = state.incidents?.findLast((entry) => entry.status === "open");
  if (!open) throw new CliError("This run has no open incident.");
  const offered = incidentWords(state);
  const word = positionals[1];
  if (!word) {
    context.print(`${open.title}\n  ${open.reason}${open.observations.map((observation) => `\n  - ${observation.detail}`).join("")}`);
    context.print(offered.length > 0 ? `Act on it: ${context.program} incident ${shortId(summary.id)} ${offered.join("|")}` : "No action is possible on it now.");
    return 0;
  }
  const action = INCIDENT_ACTIONS[word];
  if (!action || !offered.includes(word)) throw new CliError(offered.length > 0 ? `This incident takes: ${offered.join(", ")}.` : "No action is possible on this incident now.", USAGE);
  await act(context, async (link) => {
    const result = answerOf(await link.request({ type: "incident.action", runId: summary.id, incidentId: open.id, expectedRevision: open.revision, requestId: randomUUID(), action, ...(values.reason ? { reason: values.reason } : {}) }), "incident.result");
    if (!result) throw new CliError("The console did not say what became of the action.");
    if (result.outcome === "refused") throw new CliError(result.message);
    context.print(result.message);
  });
  return 0;
}

async function docs(context: Context, argv: string[]) {
  const { values, positionals } = parse(argv, { all: { type: "boolean" } });
  const { summary, state } = await runNamed(context, positionals[0]);
  const document = positionals[1];
  if (!document) {
    const listed = values.all ? state.artifacts : generatedDocuments(state.artifacts);
    context.print(listed.length > 0 ? listed.join("\n") : "This run wrote no document.");
    return 0;
  }
  const file = await getJson(context.base, artifactUrl(summary, document)) as { content: string; encoding?: "base64" };
  if (file.encoding === "base64") process.stdout.write(Buffer.from(file.content, "base64"));
  else context.print(file.content);
  return 0;
}

async function evidence(context: Context, argv: string[]) {
  const { values, positionals } = parse(argv, JSON_OPTION);
  const summary = resolveRun(required(positionals[0], "the run"), await factory(context));
  const view = await getJson(context.base, acceptanceUrl(summary)) as AcceptanceView;
  if (values.json) json(context, view); else context.print(renderEvidence(view));
  return 0;
}

async function metrics(context: Context, argv: string[]) {
  const { values } = parse(argv, JSON_OPTION);
  const response = await getJson(context.base, "/api/metrics") as { runs: RunMetrics[]; improvements?: ImprovementMetrics };
  if (values.json) { json(context, response); return 0; }
  context.print(renderMetrics(response.runs));
  const improvements = response.improvements;
  if (improvements) context.print(`\nSelf-improvement: ${improvements.merged} merged, ${improvements.rejected} rejected (${improvements.rejectedByJudge} by the judge), ${improvements.reverted} reverted`);
  return 0;
}

/** `recipe` and `findings`: what the console keeps for a repository from one run to the next, and the way to drop it. */
function repositoryMemory(kind: "recipe" | "findings") {
  return async (context: Context, argv: string[]) => {
    const { values, positionals } = parse(argv, { ...JSON_OPTION, forget: { type: "boolean" } });
    const repository = absolute(positionals[0] ?? ".");
    if (values.forget) {
      await act(context, async (link) => {
        const answers = await link.request({ type: `${kind}.forget`, repository });
        const forgotten = kind === "recipe" ? answerOf(answers, "recipe.result")?.forgotten : answerOf(answers, "findings.result")?.forgotten;
        context.print(forgotten ? `Forgotten for ${repository}.` : `Nothing was kept for ${repository}.`);
      });
      return 0;
    }
    const body = await getJson(context.base, `/api/repositories/${kind}?repository=${encodeURIComponent(repository)}`) as { recipe?: { content: string; updatedAt: string } | null; findings?: { kept: number; tickets: number; recurring: { label: string; tickets: number; findings: number; examples: { severity: string; file?: string; summary: string }[] }[] } };
    if (values.json) { json(context, body); return 0; }
    if (kind === "recipe") {
      context.print(body.recipe ? `Written ${body.recipe.updatedAt}\n\n${body.recipe.content}` : `No runtime recipe is kept for ${repository}.`);
      return 0;
    }
    const findings = body.findings;
    if (!findings || findings.kept === 0) { context.print(`No review finding is kept for ${repository}.`); return 0; }
    context.print(`${findings.kept} finding${findings.kept === 1 ? "" : "s"} kept, from ${findings.tickets} ticket${findings.tickets === 1 ? "" : "s"}.`);
    for (const group of findings.recurring) {
      context.print(`\n${group.label}: ${group.findings} findings on ${group.tickets} tickets`);
      for (const example of group.examples) context.print(`  ${example.severity}${example.file ? ` ${example.file}` : ""}: ${example.summary}`);
    }
    return 0;
  };
}

async function proposals(context: Context, argv: string[]) {
  const { values, positionals } = parse(argv, { ...JSON_OPTION, repo: { type: "string", multiple: true, short: "r" } });
  const [action, ...urls] = positionals;
  if (!action) {
    const snapshot = await factory(context);
    if (values.json) json(context, snapshot.proposals); else context.print(renderProposals(snapshot));
    return 0;
  }
  if (action === "dismiss") {
    if (urls.length === 0) throw new CliError("Missing the address of a ticket.", USAGE);
    await act(context, async (link) => { await link.request({ type: "proposal.dismiss", issueUrls: urls }); });
    context.print("Dismissed.");
    return 0;
  }
  if (action === "launch") {
    const issueUrl = required(urls[0], "the address of a ticket");
    const repositories = (values.repo ?? []).map(absolute);
    if (repositories.length === 0) throw new CliError("Name where the work goes: --repo <path>", USAGE);
    await act(context, async (link) => { await link.request({ type: "proposal.launch", issueUrl, repositories }); });
    context.print(`Ticket queued. See the queue: ${context.program} queue`);
    return 0;
  }
  throw new CliError(`Unknown proposals action: ${action}. Choose dismiss or launch.`, USAGE);
}

type PendingImprovements = { items: { worktreeName: string; branch?: string; commits: number; mergesCleanly?: boolean; status: string; autoMerge?: { state: string } }[]; merged: { worktreeName: string; at: string; reasons: string[] }[] };

async function improvements(context: Context, argv: string[]) {
  const { values, positionals } = parse(argv, JSON_OPTION);
  const [action, name] = positionals;
  if (!action) {
    const pending = await getJson(context.base, "/api/self-improvement/pending") as PendingImprovements;
    if (values.json) { json(context, pending); return 0; }
    context.print(pending.items.length > 0
      ? table([["BRANCH", "STATUS", "COMMITS", "MERGE"], ...pending.items.map((item) => [item.worktreeName, item.autoMerge ? `${item.status}, automatic merge ${item.autoMerge.state}` : item.status, String(item.commits), item.mergesCleanly === false ? "conflict" : "clean"])])
      : "No improvement branch is waiting.");
    if (pending.merged.length > 0) context.print(`\nMerged in the last day\n${table(pending.merged.map((merge) => [`  ${merge.worktreeName}`, merge.at, merge.reasons.join("; ")]))}`);
    return 0;
  }
  const worktreeName = required(name, "the name of the improvement branch");
  if (action === "diff" || action === "report") {
    const body = await getJson(context.base, `/api/self-improvement/${action}?worktree=${encodeURIComponent(worktreeName)}`) as { diff?: string; report?: string };
    context.print(body.diff ?? body.report ?? "");
    return 0;
  }
  if (action !== "approve" && action !== "reject" && action !== "revert") throw new CliError(`Unknown improvements action: ${action}. Choose diff, report, approve, reject or revert.`, USAGE);
  await act(context, async (link) => { await link.request({ type: `selfImprovement.${action}`, worktreeName }); });
  context.print(action === "approve" ? "Merged." : action === "reject" ? "Rejected." : "Reverted.");
  return 0;
}

async function repos(context: Context, argv: string[]) {
  const { values, positionals } = parse(argv, { ...JSON_OPTION, fresh: { type: "boolean" } });
  const query = new URLSearchParams({ ...(positionals[0] ? { issueUrl: positionals[0] } : {}), ...(values.fresh ? { fresh: "1" } : {}) }).toString();
  const body = await getJson(context.base, `/api/repositories${query ? `?${query}` : ""}`) as { repositories: { project: string; path: string }[]; detected: { path: string } | null };
  if (values.json) { json(context, body); return 0; }
  context.print(body.repositories.length > 0 ? table(body.repositories.map((repository) => [repository.project, repository.path])) : "No checkout was found under the search roots.");
  if (positionals[0]) context.print(body.detected ? `\nThis ticket goes to ${body.detected.path}` : "\nNo checkout was found for this ticket.");
  return 0;
}

export type Command = { run: (context: Context, argv: string[]) => Promise<number>; usage: string; summary: string };

/** Every command the console answers from a terminal, in the order the help lists them. */
export const COMMANDS: Record<string, Command> = {
  run: { run, usage: "run <ticket-url>... [-r <checkout>]... [-m <instruction>] [-f] | run --demo [workflow|incident|batch]", summary: "starts a run, or queues the tickets as a batch when there are several; -f follows it" },
  runs: { run: runs, usage: "runs [--json]", summary: "lists the runs, the queue, the kept worktrees and the watcher's tickets" },
  show: { run: show, usage: "show <run> [--json]", summary: "shows one run: step, agents, plan, decision waiting, incident" },
  watch: { run: watch, usage: "watch [<run>]", summary: "follows a run until it ends and asks its decisions, or follows every run" },
  attach: { run: attachCommand, usage: "attach <run>", summary: "opens the terminal of the run's session, Ctrl-] to leave it running" },
  answer: { run: answer, usage: "answer <run> [<answer>...]", summary: "answers the decision a run waits on, one answer per question" },
  trust: { run: trust, usage: "trust <run> accept|refuse", summary: "answers the folder trust dialog of a session" },
  tell: { run: onRun((summary, rest) => ({ type: "instruction.send", runId: summary.id, text: rest.join(" ") }), "instruction sent."), usage: "tell <run> <instruction>", summary: "sends an instruction to the session of a run" },
  abort: { run: onRun((summary) => ({ type: "run.stop", runId: summary.id }), "stop asked."), usage: "abort <run>", summary: "stops a run and its session" },
  close: { run: onRun((summary) => ({ type: "run.close", runId: summary.id }), "removed from the list."), usage: "close <run>", summary: "removes an ended run from the list" },
  feedback: { run: onRun((summary, rest) => ({ type: "feedback.submit", runId: summary.id, body: rest.join(" ") }), "feedback kept for the improvement loop."), usage: "feedback <run> <text>", summary: "leaves feedback on a run for the improvement loop" },
  queue: { run: queue, usage: "queue [--json] | queue cancel <id> | queue force <id> [--stacked] [--onto <ticket-url>] | queue move <id> --before <id>|--end", summary: "shows the queue and acts on a waiting launch" },
  incident: { run: incident, usage: "incident <run> [continue|stop|dismiss] [--reason <text>]", summary: "shows the open incident of a run, or acts on it" },
  worktree: { run: worktree, usage: "worktree rm <run> [--force]", summary: "removes the worktree an ended run left" },
  docs: { run: docs, usage: "docs <run> [<document>] [--all]", summary: "lists the documents of a run, or prints one" },
  evidence: { run: evidence, usage: "evidence <run> [--json]", summary: "shows the acceptance criteria and what verifies each" },
  metrics: { run: metrics, usage: "metrics [--json]", summary: "shows what each run cost and delivered" },
  recipe: { run: repositoryMemory("recipe"), usage: "recipe [<checkout>] [--forget]", summary: "shows or drops the runtime recipe kept for a repository" },
  findings: { run: repositoryMemory("findings"), usage: "findings [<checkout>] [--forget]", summary: "shows or drops the review findings kept for a repository" },
  proposals: { run: proposals, usage: "proposals [--json] | proposals dismiss <ticket-url>... | proposals launch <ticket-url> -r <checkout>...", summary: "shows the watcher's tickets that were not queued, and decides on one" },
  improvements: { run: improvements, usage: "improvements [--json] | improvements diff|report|approve|reject|revert <branch>", summary: "shows the improvement branches and decides on one" },
  repos: { run: repos, usage: "repos [<ticket-url>] [--fresh]", summary: "lists the checkouts found, and the one a ticket goes to" },
};

export function usage(program: string) {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
  return [
    `Usage: ${program} <command>`,
    "",
    ...Object.entries(COMMANDS).map(([name, command]) => `  ${name.padEnd(width)}  ${command.summary}`),
    "",
    `A run is named by its id, the end of its id, its ticket number (#12) or its ticket address.`,
    `Details of one command: ${program} <command> --help`,
  ].join("\n");
}
