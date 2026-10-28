import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { languageOf, type Language } from "../lib/i18n";
import { texts } from "../lib/i18n/texts";
import { acceptanceUrl, artifactUrl, generatedDocuments, runLabel } from "../lib/run-state";
import { normalizeTicketUrl, parseTicketUrls, ticketReference } from "../lib/ticket-urls";
import type { ImprovementMetrics } from "../lib/types";
import type { AcceptanceView, ConfidenceCalibration, FactorySnapshot, IncidentAction, RunMetrics, RunState, RunSummary } from "../server/types.js";
import { answerOf, CliError, connect, getJson, type Link } from "./client";
import { follow, askQuestions, attach, watchFactory } from "./live";
import { incidentWords, renderCalibration, renderEvidence, renderFactory, renderMetrics, renderProposals, renderQuestion, renderQueue, renderRun, renderSessionPrompt, table } from "./format";
import { answersFromInputs, resolveQueued, resolveRun, shortId } from "./select";

/** Exit code of a command that was not written the way it is used. */
export const USAGE = 2;

export type Context = { base: string; program: string; language: Language; print: (text: string) => void; interactive: boolean };
type Options = NonNullable<ParseArgsConfig["options"]>;

/** The wording of a command's own refusals; Node's parser messages stay as it writes them. */
const said = (context: Context) => texts(context.language).cli;

function parse<T extends Options>(context: Context, argv: string[], options: T) {
  try { return parseArgs({ args: argv, options, allowPositionals: true, strict: true }); }
  catch (error) { throw new CliError(error instanceof Error ? error.message : said(context).unreadableArguments, USAGE); }
}

function required(value: string | undefined, missing: string): string {
  if (!value?.trim()) throw new CliError(missing, USAGE);
  return value;
}

function json(context: Context, value: unknown) {
  context.print(JSON.stringify(value, null, 2));
}

async function factory(context: Context) {
  const snapshot = await getJson(context.base, "/api/runs") as Partial<FactorySnapshot> | null;
  if (!snapshot || !Array.isArray(snapshot.runs) || !Array.isArray(snapshot.queued)) throw new CliError(said(context).notConsole(context.base));
  return { runs: snapshot.runs, queued: snapshot.queued, maxConcurrentRuns: snapshot.maxConcurrentRuns ?? 0, language: languageOf(snapshot.language), archived: snapshot.archived ?? [], proposals: snapshot.proposals ?? [] } satisfies FactorySnapshot;
}

/** A run named on the command line, with its full state: read from its archive when the console no longer holds it. */
async function runNamed(context: Context, reference: string | undefined) {
  const summary = resolveRun(required(reference, said(context).missingRun), await factory(context), context.language);
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
  const text = said(context);
  const { values, positionals } = parse(context, argv, RUN_OPTIONS);
  const link = await connect(context.base);
  try {
    const requestId = randomUUID();
    const started = async (answers: Awaited<ReturnType<Link["request"]>>) => {
      const created = answers.find((message) => message.type === "run.started" && message.requestId === requestId);
      if (created?.type !== "run.started") return undefined;
      context.print(text.runStarted(shortId(created.runId), created.runId));
      if (values.follow) return follow(context, link, created.runId);
      context.print(text.followIt(`${context.program} watch ${shortId(created.runId)}`));
      return 0;
    };

    if (values.demo) {
      const scenario = positionals[0] ?? "workflow";
      if (scenario !== "workflow" && scenario !== "incident" && scenario !== "batch") throw new CliError(text.unknownDemo(scenario), USAGE);
      const code = await started(await link.request({ type: "demo.start", scenario, requestId }));
      if (code === undefined) context.print(text.demoQueued(`${context.program} runs`));
      return code ?? 0;
    }

    const { tickets, invalid } = parseTicketUrls(positionals.join("\n"));
    if (invalid.length > 0) throw new CliError(text.notTicketAddress(invalid.map((entry) => entry.text).join(", ")), USAGE);
    const [ticket] = tickets;
    if (!ticket) throw new CliError(text.missingTicketAddress, USAGE);
    const repositories = (values.repo ?? []).map(absolute);
    const instruction = values.instruction?.trim() ? { instruction: values.instruction } : {};

    if (tickets.length === 1 && repositories.length <= 1) {
      let cwd = repositories[0];
      if (!cwd) {
        const { detected } = await getJson(context.base, `/api/repositories?issueUrl=${encodeURIComponent(ticket)}`) as { detected: { path: string } | null };
        if (!detected) throw new CliError(text.noCheckout);
        cwd = detected.path;
      }
      const answers = await link.request({ type: "run.start", cwd, issueUrl: ticket, requestId, ...instruction });
      const code = await started(answers);
      if (code !== undefined) return code;
      const queued = answers.find((message) => message.type === "notice" && message.requestId === requestId);
      context.print(queued?.type === "notice" ? `${queued.title}. ${queued.detail ?? ""}`.trim() : text.runQueued);
      context.print(text.seeQueue(`${context.program} queue`));
      return 0;
    }

    const targets = repositories.length > 0 ? { targets: Object.fromEntries(tickets.map((url) => [url, repositories])) } : {};
    const answers = await link.request({ type: "batch.submit", issueUrls: tickets, ...instruction, ...targets });
    const unresolved = answerOf(answers, "batch.unresolved");
    if (unresolved) throw new CliError(text.noCheckoutFor(unresolved.tickets.map((entry) => ticketReference(entry.issueUrl)).join(", ")));
    const result = answerOf(answers, "batch.result");
    context.print(text.ticketsQueued(result?.accepted ?? 0, result?.duplicates.length ?? 0));
    context.print(text.seeQueue(`${context.program} queue`));
    return 0;
  } finally { link.close(); }
}

const JSON_OPTION = { json: { type: "boolean" } } satisfies Options;

async function runs(context: Context, argv: string[]) {
  const { values } = parse(context, argv, JSON_OPTION);
  const snapshot = await factory(context);
  if (values.json) json(context, snapshot); else context.print(renderFactory(snapshot, Date.now()));
  return 0;
}

async function show(context: Context, argv: string[]) {
  const { values, positionals } = parse(context, argv, JSON_OPTION);
  const { state } = await runNamed(context, positionals[0]);
  if (values.json) json(context, state); else context.print(renderRun(state, Date.now(), context.program, context.language));
  return 0;
}

async function watch(context: Context, argv: string[]) {
  const { positionals } = parse(context, argv, {});
  const link = await connect(context.base);
  try {
    if (!positionals[0]) return await watchFactory(context, link);
    const summary = resolveRun(positionals[0], link.snapshot(), context.language);
    if (summary.archived) throw new CliError(said(context).archivedNoMove(`${context.program} show ${shortId(summary.id)}`));
    return await follow(context, link, summary.id);
  } finally { link.close(); }
}

async function attachCommand(context: Context, argv: string[]) {
  const { positionals } = parse(context, argv, {});
  const link = await connect(context.base);
  try {
    const summary = resolveRun(required(positionals[0], said(context).missingRun), link.snapshot(), context.language);
    if (summary.archived) throw new CliError(said(context).archivedNoTerminal);
    return await attach(link, summary, context.language);
  } finally { link.close(); }
}

async function answer(context: Context, argv: string[]) {
  const text = said(context);
  const { positionals } = parse(context, argv, {});
  const [reference, ...inputs] = positionals;
  const { summary, state } = await runNamed(context, reference);
  const pending = state.pendingQuestion;
  if (!pending) throw new CliError(state.sessionPrompt ? text.waitsOnTrust(`${context.program} trust ${shortId(summary.id)} accept|refuse`) : text.waitsOnNothing);
  let answers: Record<string, string>;
  if (inputs.length > 0) answers = answersFromInputs(pending, inputs, context.language);
  else if (context.interactive) {
    context.print(renderQuestion(pending, context.language));
    const typed = await askQuestions(pending, context.language);
    if (!typed) return 1;
    answers = typed;
  } else {
    context.print(renderQuestion(pending, context.language));
    throw new CliError(text.giveAnswers(`${context.program} answer ${shortId(summary.id)} <answer>...`), USAGE);
  }
  await act(context, async (link) => { await link.request({ type: "question.answer", runId: summary.id, answers }); });
  context.print(text.answerSent);
  return 0;
}

async function trust(context: Context, argv: string[]) {
  const text = said(context);
  const { positionals } = parse(context, argv, {});
  const decision = positionals[1];
  if (decision !== "accept" && decision !== "refuse") throw new CliError(text.sayAcceptOrRefuse, USAGE);
  const { summary, state } = await runNamed(context, positionals[0]);
  const prompt = state.sessionPrompt;
  if (!prompt) throw new CliError(text.noTrustDecision);
  context.print(renderSessionPrompt(prompt, context.language));
  await act(context, async (link) => { await link.request({ type: "sessionPrompt.answer", runId: summary.id, promptId: prompt.id, decision }); });
  context.print(decision === "accept" ? text.directoryTrusted : text.trustRefused);
  return 0;
}

/** A command that sends one message about a run and has nothing to read back. */
function onRun(build: (run: RunSummary, rest: string[]) => Parameters<Link["request"]>[0], done: (language: Language) => string) {
  return async (context: Context, argv: string[]) => {
    const { positionals } = parse(context, argv, {});
    const [reference, ...rest] = positionals;
    const summary = resolveRun(required(reference, said(context).missingRun), await factory(context), context.language);
    await act(context, async (link) => { await link.request(build(summary, rest)); });
    context.print(`${runLabel(summary)}${said(context).colon}${done(context.language)}`);
    return 0;
  };
}

const QUEUE_OPTIONS = { ...JSON_OPTION, stacked: { type: "boolean" }, onto: { type: "string" }, before: { type: "string" }, end: { type: "boolean" } } satisfies Options;

async function queue(context: Context, argv: string[]) {
  const text = said(context);
  const { values, positionals } = parse(context, argv, QUEUE_OPTIONS);
  const [action, reference] = positionals;
  const { queued } = await factory(context);
  if (!action) {
    if (values.json) json(context, queued); else context.print(renderQueue(queued, context.language));
    return 0;
  }
  if (action !== "cancel" && action !== "force" && action !== "move") throw new CliError(text.unknownQueueAction(action), USAGE);
  const entry = resolveQueued(required(reference, said(context).missingQueued), queued, context.language);
  if (action === "cancel") {
    await act(context, async (link) => { await link.request({ type: "queue.cancel", queuedId: entry.id }); });
    context.print(text.queueRemoved(runLabel(entry)));
    return 0;
  }
  if (action === "force") {
    const onto = values.onto === undefined ? undefined : normalizeTicketUrl(values.onto);
    if (values.onto !== undefined && !onto) throw new CliError(text.ontoNeedsTicket(values.onto ?? ""), USAGE);
    const stacked = values.stacked === true || onto !== undefined;
    await act(context, async (link) => { await link.request({ type: "queue.force", queuedId: entry.id, mode: stacked ? "stacked" : "base", ...(onto ? { onto } : {}) }); });
    context.print(text.queueForced(runLabel(entry), stacked));
    return 0;
  }
  if (values.end === (values.before !== undefined)) throw new CliError(text.sayWhereItGoes, USAGE);
  const before = values.before === undefined ? null : resolveQueued(values.before, queued, context.language).id;
  await act(context, async (link) => { await link.request({ type: "queue.move", queuedId: entry.id, before }); });
  context.print(text.queueMoved(runLabel(entry)));
  return 0;
}

async function worktree(context: Context, argv: string[]) {
  const text = said(context);
  const { values, positionals } = parse(context, argv, { force: { type: "boolean" } });
  if (positionals[0] !== "rm") throw new CliError(text.worktreeUsage(context.program), USAGE);
  const summary = resolveRun(required(positionals[1], said(context).missingRun), await factory(context), context.language);
  let code = 0;
  await act(context, async (link) => {
    const result = answerOf(await link.request({ type: "worktree.remove", runId: summary.id, ...(values.force ? { force: true } : {}) }), "worktree.result");
    if (!result) throw new CliError(text.worktreeNoAnswer);
    if (result.outcome === "refused") throw new CliError(result.message);
    context.print(result.message);
    if (result.outcome === "confirm") {
      for (const risk of result.risks ?? []) context.print(`  ${risk}`);
      context.print(text.nothingRemoved(`${context.program} worktree rm ${shortId(summary.id)} --force`));
      code = 1;
    }
  });
  return code;
}

const INCIDENT_ACTIONS: Record<string, IncidentAction> = { continue: "request_continuation", stop: "stop", dismiss: "dismiss" };

async function incident(context: Context, argv: string[]) {
  const text = said(context);
  const { values, positionals } = parse(context, argv, { reason: { type: "string" } });
  const { summary, state } = await runNamed(context, positionals[0]);
  const open = state.incidents?.findLast((entry) => entry.status === "open");
  if (!open) throw new CliError(text.noOpenIncident);
  const offered = incidentWords(state);
  const word = positionals[1];
  if (!word) {
    context.print(`${open.title}\n  ${open.reason}${open.observations.map((observation) => `\n  - ${observation.detail}`).join("")}`);
    context.print(offered.length > 0 ? text.actOnIt(`${context.program} incident ${shortId(summary.id)} ${offered.join("|")}`) : text.noActionPossible);
    return 0;
  }
  const action = INCIDENT_ACTIONS[word];
  if (!action || !offered.includes(word)) throw new CliError(offered.length > 0 ? text.incidentTakes(offered.join(", ")) : text.noActionOnIncident, USAGE);
  await act(context, async (link) => {
    const result = answerOf(await link.request({ type: "incident.action", runId: summary.id, incidentId: open.id, expectedRevision: open.revision, requestId: randomUUID(), action, ...(values.reason ? { reason: values.reason } : {}) }), "incident.result");
    if (!result) throw new CliError(text.incidentNoAnswer);
    if (result.outcome === "refused") throw new CliError(result.message);
    context.print(result.message);
  });
  return 0;
}

async function docs(context: Context, argv: string[]) {
  const { values, positionals } = parse(context, argv, { all: { type: "boolean" } });
  const { summary, state } = await runNamed(context, positionals[0]);
  const document = positionals[1];
  if (!document) {
    const listed = values.all ? state.artifacts : generatedDocuments(state.artifacts);
    context.print(listed.length > 0 ? listed.join("\n") : said(context).noDocument);
    return 0;
  }
  const file = await getJson(context.base, artifactUrl(summary, document)) as { content: string; encoding?: "base64" };
  if (file.encoding === "base64") process.stdout.write(Buffer.from(file.content, "base64"));
  else context.print(file.content);
  return 0;
}

async function evidence(context: Context, argv: string[]) {
  const { values, positionals } = parse(context, argv, JSON_OPTION);
  const summary = resolveRun(required(positionals[0], said(context).missingRun), await factory(context), context.language);
  const view = await getJson(context.base, acceptanceUrl(summary)) as AcceptanceView;
  if (values.json) json(context, view); else context.print(renderEvidence(view, summary.confidence, context.language));
  return 0;
}

async function metrics(context: Context, argv: string[]) {
  const { values } = parse(context, argv, JSON_OPTION);
  const response = await getJson(context.base, "/api/metrics") as { runs: RunMetrics[]; improvements?: ImprovementMetrics; calibration?: ConfidenceCalibration };
  if (values.json) { json(context, response); return 0; }
  context.print(renderMetrics(response.runs, context.language));
  const calibration = renderCalibration(response.calibration ?? [], context.language);
  if (calibration) context.print(`\n${said(context).calibrationTitle}\n${calibration}`);
  const improvements = response.improvements;
  if (improvements) context.print(`\n${said(context).improvementsLine(improvements.merged, improvements.rejected, improvements.rejectedByJudge, improvements.reverted)}`);
  return 0;
}

/** `recipe` and `findings`: what the console keeps for a repository from one run to the next, and the way to drop it. */
function repositoryMemory(kind: "recipe" | "findings") {
  return async (context: Context, argv: string[]) => {
    const text = said(context);
    const { values, positionals } = parse(context, argv, { ...JSON_OPTION, forget: { type: "boolean" } });
    if (kind === "findings" && (positionals[0] === "accept" || positionals[0] === "dismiss")) {
      const category = required(positionals[1], said(context).missingCategory);
      const checkout = absolute(positionals[2] ?? ".");
      await act(context, async (link) => {
        const answers = await link.request({ type: positionals[0] === "accept" ? "findings.accept" : "findings.dismiss", repository: checkout, category });
        const result = answerOf(answers, "findings.fix");
        if (!result) throw new CliError(text.consoleNoAnswer);
        context.print(result.message);
      });
      return 0;
    }
    const repository = absolute(positionals[0] ?? ".");
    if (values.forget) {
      await act(context, async (link) => {
        const answers = await link.request({ type: `${kind}.forget`, repository });
        const forgotten = kind === "recipe" ? answerOf(answers, "recipe.result")?.forgotten : answerOf(answers, "findings.result")?.forgotten;
        context.print(forgotten ? text.forgotten(repository) : text.nothingKept(repository));
      });
      return 0;
    }
    const body = await getJson(context.base, `/api/repositories/${kind}?repository=${encodeURIComponent(repository)}`) as { recipe?: { content: string; updatedAt: string } | null; findings?: { kept: number; tickets: number; recurring: { label: string; tickets: number; findings: number; examples: { severity: string; file?: string; summary: string }[] }[]; fixes?: { category: string; title: string; status: string; settled: boolean; runs: number; targetFile: string; kind: string }[] } };
    if (values.json) { json(context, body); return 0; }
    if (kind === "recipe") {
      context.print(body.recipe ? text.recipeWritten(body.recipe.updatedAt, body.recipe.content) : text.noRecipe(repository));
      return 0;
    }
    const findings = body.findings;
    const fixes = findings?.fixes ?? [];
    if ((!findings || findings.kept === 0) && fixes.length === 0) { context.print(text.noFindings(repository)); return 0; }
    if (findings && findings.kept > 0) {
      context.print(text.findingsKept(findings.kept, findings.tickets));
      for (const group of findings.recurring) {
        context.print(`\n${text.findingsGroup(group.label, group.findings, group.tickets)}`);
        for (const example of group.examples) context.print(`  ${example.severity}${example.file ? ` ${example.file}` : ""}${text.colon}${example.summary}`);
      }
    }
    if (fixes.length > 0) {
      context.print(`\n${text.sourceFixes}`);
      for (const fix of fixes) {
        const state = fix.status === "accepted" ? (fix.settled ? text.fixOnBranch : text.fixAcceptedNotYet) : fix.status;
        context.print(`  ${fix.category}  ${state}  ${text.fixRuns(fix.runs)}  ${fix.targetFile}  ${fix.title}`);
      }
    }
    return 0;
  };
}

async function proposals(context: Context, argv: string[]) {
  const text = said(context);
  const { values, positionals } = parse(context, argv, { ...JSON_OPTION, repo: { type: "string", multiple: true, short: "r" } });
  const [action, ...urls] = positionals;
  if (!action) {
    const snapshot = await factory(context);
    if (values.json) json(context, snapshot.proposals); else context.print(renderProposals(snapshot, context.language));
    return 0;
  }
  if (action === "dismiss") {
    if (urls.length === 0) throw new CliError(text.missingTicketAddress, USAGE);
    await act(context, async (link) => { await link.request({ type: "proposal.dismiss", issueUrls: urls }); });
    context.print(text.dismissed);
    return 0;
  }
  if (action === "launch") {
    const issueUrl = required(urls[0], said(context).missingTicketAddress);
    const repositories = (values.repo ?? []).map(absolute);
    if (repositories.length === 0) throw new CliError(text.nameWhereWorkGoes, USAGE);
    await act(context, async (link) => { await link.request({ type: "proposal.launch", issueUrl, repositories }); });
    context.print(text.ticketQueued(`${context.program} queue`));
    return 0;
  }
  throw new CliError(text.unknownProposalsAction(action), USAGE);
}

type PendingImprovements = { items: { worktreeName: string; branch?: string; commits: number; mergesCleanly?: boolean; status: string; autoMerge?: { state: string } }[]; merged: { worktreeName: string; at: string; reasons: string[] }[] };

async function improvements(context: Context, argv: string[]) {
  const text = said(context);
  const { values, positionals } = parse(context, argv, JSON_OPTION);
  const [action, name] = positionals;
  if (!action) {
    const pending = await getJson(context.base, "/api/self-improvement/pending") as PendingImprovements;
    if (values.json) { json(context, pending); return 0; }
    context.print(pending.items.length > 0
      ? table([[0, 1, 2, 3].map((index) => text.improvementsHeader(index)), ...pending.items.map((item) => [item.worktreeName, item.autoMerge ? text.improvementStatus(item.status, item.autoMerge.state) : item.status, String(item.commits), item.mergesCleanly === false ? text.mergeConflict : text.mergeClean])])
      : text.noImprovement);
    if (pending.merged.length > 0) context.print(`\n${text.mergedLastDay}\n${table(pending.merged.map((merge) => [`  ${merge.worktreeName}`, merge.at, merge.reasons.join("; ")]))}`);
    return 0;
  }
  const worktreeName = required(name, said(context).missingBranchName);
  if (action === "diff" || action === "report") {
    const body = await getJson(context.base, `/api/self-improvement/${action}?worktree=${encodeURIComponent(worktreeName)}`) as { diff?: string; report?: string };
    context.print(body.diff ?? body.report ?? "");
    return 0;
  }
  if (action !== "approve" && action !== "reject" && action !== "revert") throw new CliError(text.unknownImprovementsAction(action), USAGE);
  await act(context, async (link) => { await link.request({ type: `selfImprovement.${action}`, worktreeName }); });
  context.print(action === "approve" ? text.improvementMerged : action === "reject" ? text.improvementRejected : text.improvementReverted);
  return 0;
}

async function repos(context: Context, argv: string[]) {
  const text = said(context);
  const { values, positionals } = parse(context, argv, { ...JSON_OPTION, fresh: { type: "boolean" } });
  const query = new URLSearchParams({ ...(positionals[0] ? { issueUrl: positionals[0] } : {}), ...(values.fresh ? { fresh: "1" } : {}) }).toString();
  const body = await getJson(context.base, `/api/repositories${query ? `?${query}` : ""}`) as { repositories: { project: string; path: string }[]; detected: { path: string } | null };
  if (values.json) { json(context, body); return 0; }
  context.print(body.repositories.length > 0 ? table(body.repositories.map((repository) => [repository.project, repository.path])) : text.noCheckoutFound);
  if (positionals[0]) context.print(body.detected ? text.ticketGoesTo(body.detected.path) : text.ticketNoCheckout);
  return 0;
}

export type Command = { run: (context: Context, argv: string[]) => Promise<number>; usage: string; summary: (language: Language) => string };

/** Every command the console answers from a terminal, in the order the help lists them. */
export const COMMANDS: Record<string, Command> = {
  run: { run, usage: "run <ticket-url>... [-r <checkout>]... [-m <instruction>] [-f] | run --demo [workflow|incident|batch]", summary: (language) => texts(language).cli.summaryRun },
  runs: { run: runs, usage: "runs [--json]", summary: (language) => texts(language).cli.summaryRuns },
  show: { run: show, usage: "show <run> [--json]", summary: (language) => texts(language).cli.summaryShow },
  watch: { run: watch, usage: "watch [<run>]", summary: (language) => texts(language).cli.summaryWatch },
  attach: { run: attachCommand, usage: "attach <run>", summary: (language) => texts(language).cli.summaryAttach },
  answer: { run: answer, usage: "answer <run> [<answer>...]", summary: (language) => texts(language).cli.summaryAnswer },
  trust: { run: trust, usage: "trust <run> accept|refuse", summary: (language) => texts(language).cli.summaryTrust },
  tell: { run: onRun((summary, rest) => ({ type: "instruction.send", runId: summary.id, text: rest.join(" ") }), (language) => texts(language).cli.doneInstruction), usage: "tell <run> <instruction>", summary: (language) => texts(language).cli.summaryTell },
  abort: { run: onRun((summary) => ({ type: "run.stop", runId: summary.id }), (language) => texts(language).cli.doneStop), usage: "abort <run>", summary: (language) => texts(language).cli.summaryAbort },
  close: { run: onRun((summary) => ({ type: "run.close", runId: summary.id }), (language) => texts(language).cli.doneClose), usage: "close <run>", summary: (language) => texts(language).cli.summaryClose },
  feedback: { run: onRun((summary, rest) => ({ type: "feedback.submit", runId: summary.id, body: rest.join(" ") }), (language) => texts(language).cli.doneFeedback), usage: "feedback <run> <text>", summary: (language) => texts(language).cli.summaryFeedback },
  queue: { run: queue, usage: "queue [--json] | queue cancel <id> | queue force <id> [--stacked] [--onto <ticket-url>] | queue move <id> --before <id>|--end", summary: (language) => texts(language).cli.summaryQueue },
  incident: { run: incident, usage: "incident <run> [continue|stop|dismiss] [--reason <text>]", summary: (language) => texts(language).cli.summaryIncident },
  worktree: { run: worktree, usage: "worktree rm <run> [--force]", summary: (language) => texts(language).cli.summaryWorktree },
  docs: { run: docs, usage: "docs <run> [<document>] [--all]", summary: (language) => texts(language).cli.summaryDocs },
  evidence: { run: evidence, usage: "evidence <run> [--json]", summary: (language) => texts(language).cli.summaryEvidence },
  metrics: { run: metrics, usage: "metrics [--json]", summary: (language) => texts(language).cli.summaryMetrics },
  recipe: { run: repositoryMemory("recipe"), usage: "recipe [<checkout>] [--forget]", summary: (language) => texts(language).cli.summaryRecipe },
  findings: { run: repositoryMemory("findings"), usage: "findings [<checkout>] [--forget] | findings accept|dismiss <category> [<checkout>]", summary: (language) => texts(language).cli.summaryFindings },
  proposals: { run: proposals, usage: "proposals [--json] | proposals dismiss <ticket-url>... | proposals launch <ticket-url> -r <checkout>...", summary: (language) => texts(language).cli.summaryProposals },
  improvements: { run: improvements, usage: "improvements [--json] | improvements diff|report|approve|reject|revert <branch>", summary: (language) => texts(language).cli.summaryImprovements },
  repos: { run: repos, usage: "repos [<ticket-url>] [--fresh]", summary: (language) => texts(language).cli.summaryRepos },
};

export function usage(program: string, language: Language) {
  const text = texts(language).cli;
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
  return [
    text.usageLine(program),
    "",
    ...Object.entries(COMMANDS).map(([name, command]) => `  ${name.padEnd(width)}  ${command.summary(language)}`),
    "",
    text.usageRunNamed,
    text.usageDetails(program),
  ].join("\n");
}
