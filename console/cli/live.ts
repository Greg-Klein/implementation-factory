import { createInterface } from "node:readline/promises";
import { phaseNames, runLabel, runStatusBadge, statusLabel } from "../lib/run-state";
import type { FactorySnapshot, PendingQuestion, RunState, RunSummary } from "../server/types.js";
import { CliError, type Link } from "./client";
import type { Context } from "./commands";
import { activityLine, incidentWords, messageLine, renderFactory, renderQuestion, renderSessionPrompt } from "./format";
import { answerFromInput, shortId } from "./select";

/** How much of a run already under way is shown before what happens next. */
const BACKLOG = 10;
/** How long the output of a session that has ended is waited for, once its state said so. */
const ENDED_SESSION_GRACE_MS = 300;
/** Ctrl-], the key telnet leaves a terminal with. */
const DETACH_KEY = 0x1d;

function ended(status: RunState["status"]) {
  return status === "completed" || status === "stopped" || status === "failed";
}

/**
 * Asks each question of a decision on the terminal, again until the answer
 * reads as one. Undefined when the wait was called off, the decision having
 * been taken elsewhere, or when the input closed.
 */
export async function askQuestions(pending: PendingQuestion, signal?: AbortSignal): Promise<Record<string, string> | undefined> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answers: Record<string, string> = {};
  try {
    for (const [index, question] of pending.questions.entries()) {
      for (;;) {
        const label = pending.questions.length > 1 ? `Answer ${index + 1}` : "Answer";
        const typed = await prompt.question(`${label} (${question.options.length > 0 ? "number of a choice, or " : ""}your own words): `, signal ? { signal } : {});
        const answer = answerFromInput(question, typed);
        if (answer !== undefined) { answers[question.question] = answer; break; }
      }
    }
    return answers;
  } catch (error) {
    // The decision left the run, or the input closed under the question: nobody is asked any more.
    if (error instanceof Error && (error.name === "AbortError" || (error as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE")) return undefined;
    throw error;
  } finally { prompt.close(); }
}

async function askTrust(signal: AbortSignal): Promise<"accept" | "refuse" | undefined> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const typed = (await prompt.question("Trust this directory? (accept or refuse): ", { signal })).trim().toLowerCase();
      if (typed === "accept" || typed === "refuse") return typed;
    }
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || (error as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE")) return undefined;
    throw error;
  } finally { prompt.close(); }
}

/**
 * Follows one run until its workflow ends: what it does, what Claude says,
 * each step it reaches, and the decisions it waits on, asked right here when a
 * person is at the terminal. Ends 0 on a completed run, 1 otherwise.
 */
export function follow(context: Context, link: Link, runId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const reference = shortId(runId);
    const seen = new Set<string>();
    let first = true;
    let phase = 0;
    let incidentId: string | undefined;
    let decision: { id: string; cancel: AbortController } | undefined;
    // What happens while a question is on screen is printed once it is answered, not through it.
    let held: string[] | undefined;
    const print = (text: string) => { if (held) held.push(text); else context.print(text); };
    const release = () => { const waiting = held ?? []; held = undefined; for (const text of waiting) context.print(text); };

    const finish = (code: number) => { stop(); decision?.cancel.abort(); release(); resolve(code); };

    /** Opens the terminal prompt of a decision, and sends what was typed unless the decision left meanwhile. */
    const decide = (id: string, ask: (signal: AbortSignal) => Promise<(() => Promise<unknown>) | undefined>) => {
      const cancel = new AbortController();
      decision = { id, cancel };
      held = [];
      ask(cancel.signal).then(async (send) => {
        release();
        if (!send) { if (cancel.signal.aborted) context.print("Decided elsewhere."); return; }
        await send();
      }).catch((error: unknown) => { release(); context.print(error instanceof CliError ? error.message : String(error)); });
    };

    const apply = (state: RunState) => {
      const events = [
        ...state.activities.filter((activity) => !seen.has(`a:${activity.id}`)).map((activity) => ({ key: `a:${activity.id}`, at: activity.at, text: activityLine(activity) })),
        ...state.messages.filter((message) => !message.pending && !seen.has(`m:${message.id}`)).map((message) => ({ key: `m:${message.id}`, at: message.at, text: messageLine(message) })),
      ].sort((left, right) => left.at.localeCompare(right.at));
      for (const event of events) seen.add(event.key);
      if (first) {
        print(`${runLabel(state)}${state.ticketTitle ? `: ${state.ticketTitle}` : ""}`);
        if (events.length > BACKLOG) print(`  (${events.length - BACKLOG} earlier events not shown)`);
      }
      if (state.phase !== phase) {
        phase = state.phase;
        const names = phaseNames(state.issueUrl);
        if (names[phase - 1]) print(`--- Step ${phase}/${names.length}: ${names[phase - 1]}`);
      }
      for (const event of first ? events.slice(-BACKLOG) : events) print(event.text);
      first = false;

      const incident = state.incidents?.findLast((entry) => entry.status === "open");
      if (incident && incident.id !== incidentId) {
        const words = incidentWords(state);
        print(`! ${incident.title}: ${incident.reason}${words.length > 0 ? `\n  Act on it: ${context.program} incident ${reference} ${words.join("|")}` : ""}`);
      }
      incidentId = incident?.id;

      const waiting = state.pendingQuestion?.id ?? state.sessionPrompt?.id;
      if (decision && decision.id !== waiting) { decision.cancel.abort(); decision = undefined; }
      if (waiting && !decision) {
        const question = state.pendingQuestion;
        const prompt = state.sessionPrompt;
        context.print(`\u0007\nDecision required\n${question ? renderQuestion(question) : renderSessionPrompt(prompt!)}`);
        if (!context.interactive) {
          decision = { id: waiting, cancel: new AbortController() };
          context.print(`Answer: ${context.program} ${question ? "answer" : "trust"} ${reference}${question ? "" : " accept|refuse"}`);
        } else if (question) {
          decide(waiting, async (signal) => {
            const answers = await askQuestions(question, signal);
            return answers && (() => link.request({ type: "question.answer", runId, answers }));
          });
        } else if (prompt) {
          decide(waiting, async (signal) => {
            const answer = await askTrust(signal);
            return answer && (() => link.request({ type: "sessionPrompt.answer", runId, promptId: prompt.id, decision: answer }));
          });
        }
      }

      if (ended(state.status)) {
        print(`--- ${runStatusBadge(state).label}${state.error ? `: ${state.error}` : ""}${state.mergeRequestUrl ? `\n${state.mergeRequestUrl}` : ""}`);
        finish(state.status === "completed" ? 0 : 1);
      }
    };

    const stop = link.listen((message) => {
      if (message.type !== "run" || message.state.id !== runId) return;
      try { apply(message.state); } catch (error) { stop(); reject(error instanceof Error ? error : new Error(String(error))); }
    });
    link.closed.then(() => { print("The console closed the connection. The run is in the state it left it in."); finish(1); }, reject);
    link.send({ type: "run.subscribe", runId });
  });
}

/** What a row of the list says, compared from one list to the next to tell what moved. */
function rowState(run: RunSummary) {
  const names = phaseNames(run.issueUrl);
  const waits = run.pendingQuestionCount > 0 || run.sessionPromptId ? ", decision required" : run.incident ? `, ${run.incident.title}` : "";
  return `${statusLabel(run.status)}${waits}${names[run.phase - 1] ? ` (step ${run.phase}/${names.length}: ${names[run.phase - 1]})` : ""}`;
}

/** Follows every run: the list as it stands, then one line each time a run or the queue moves, and the console's notices. Runs until interrupted. */
export function watchFactory(context: Context, link: Link): Promise<number> {
  return new Promise((resolve, reject) => {
    const clock = () => new Date().toTimeString().slice(0, 8);
    let rows = new Map<string, string>();
    let queued = new Set<string>();
    const read = (snapshot: FactorySnapshot, announce: boolean) => {
      const next = new Map(snapshot.runs.map((run) => [run.id, rowState(run)]));
      if (announce) {
        for (const run of snapshot.runs) {
          const state = next.get(run.id)!;
          if (rows.get(run.id) === state) continue;
          const decides = run.pendingQuestionCount > 0 || run.sessionPromptId;
          context.print(`${clock()}  ${decides ? "\u0007" : ""}${shortId(run.id)}  ${runLabel(run)}: ${state}`);
        }
        for (const id of rows.keys()) if (!next.has(id)) context.print(`${clock()}  ${shortId(id)}  removed from the list`);
        for (const entry of snapshot.queued) if (!queued.has(entry.id)) context.print(`${clock()}  ${shortId(entry.id)}  ${runLabel(entry)}: queued`);
      }
      rows = next;
      queued = new Set(snapshot.queued.map((entry) => entry.id));
    };
    context.print(renderFactory(link.snapshot(), Date.now()));
    context.print("");
    read(link.snapshot(), false);
    link.listen((message) => {
      if (message.type === "factory") read(message.snapshot, true);
      if (message.type === "notice") context.print(`${clock()}  ${message.level === "attention" ? "! " : ""}${message.title}${message.detail ? `: ${message.detail}` : ""}`);
    });
    link.closed.then(() => { context.print("The console closed the connection."); resolve(1); }, reject);
  });
}

/**
 * The terminal of a run's session, as the "Terminal" tab shows it: what it
 * printed so far, then every key typed here, until the session ends or the
 * user leaves with Ctrl-]. Without a keyboard it only reads.
 */
export function attach(link: Link, summary: RunSummary): Promise<number> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const keyboard = input.isTTY === true && process.stdout.isTTY === true;
    const resize = () => link.send({ type: "terminal.resize", runId: summary.id, cols: process.stdout.columns, rows: process.stdout.rows });
    const onKey = (data: Buffer) => {
      if (data.includes(DETACH_KEY)) { finish("Detached. The session goes on."); return; }
      link.send({ type: "terminal.input", runId: summary.id, data: data.toString("utf8") });
    };
    let done = false;
    const finish = (why: string) => {
      if (done) return;
      done = true;
      stop();
      if (keyboard) { input.off("data", onKey); process.stdout.off("resize", resize); input.setRawMode(false); input.pause(); }
      process.stderr.write(`\r\n${why}\r\n`);
      resolve(0);
    };
    const stop = link.listen((message) => {
      if (message.type === "terminal.output" && message.runId === summary.id) process.stdout.write(message.data);
      // The state of a run arrives before what its terminal printed: an ended session is left once that was shown.
      if (message.type === "run" && message.state.id === summary.id && !message.state.sessionActive) setTimeout(() => finish("The session has ended."), ENDED_SESSION_GRACE_MS);
    });
    link.closed.then(() => finish("The console closed the connection."), reject);
    process.stderr.write(`Terminal of ${runLabel(summary)}.${keyboard ? " Leave it running with Ctrl-]." : ""}\r\n`);
    if (keyboard) {
      input.setRawMode(true);
      input.resume();
      input.on("data", onKey);
      process.stdout.on("resize", resize);
      resize();
    }
    link.send({ type: "run.subscribe", runId: summary.id });
  });
}
