import { normalizeTicketUrl, ticketIdentity, ticketReference } from "../lib/ticket-urls";
import type { Language } from "../lib/i18n";
import { texts } from "../lib/i18n/texts";
import { runLabel } from "../lib/run-state";
import type { FactorySnapshot, PendingQuestion, QueuedRunView, RunSummary } from "../server/types.js";
import { CliError } from "./client";

/** The end of an id, which is what tells two runs apart and what the lists show. */
export function shortId(id: string) {
  return id.slice(id.lastIndexOf("-") + 1);
}

/** Whether a reference typed by the user names this ticket: its number, `#12` or `12`, or one of its addresses. */
function namesTicket(reference: string, issueUrl: string) {
  if (/^#?\d+$/.test(reference)) return ticketReference(issueUrl) === `#${reference.replace(/^#/, "")}`;
  const url = normalizeTicketUrl(reference);
  return url !== undefined && ticketIdentity(url) === ticketIdentity(issueUrl);
}

function namesId(reference: string, id: string) {
  return id === reference || shortId(id) === reference || id.startsWith(reference);
}

/**
 * The run a reference names: its id, the end of its id, or its ticket. When
 * several match, the runs the console still holds win over the archived ones,
 * then the ones still at work; a reference that still names several is refused
 * with the list, never resolved to the first.
 */
export function resolveRun(reference: string, snapshot: Pick<FactorySnapshot, "runs" | "archived">, language: Language): RunSummary {
  const text = texts(language).cli;
  const all = [...snapshot.runs, ...snapshot.archived.map((run) => ({ ...run, archived: true }))];
  const exact = all.filter((run) => run.id === reference);
  let matches = exact.length > 0 ? exact : all.filter((run) => namesId(reference, run.id));
  if (matches.length === 0) matches = all.filter((run) => namesTicket(reference, run.issueUrl));
  if (matches.length > 1 && matches.some((run) => !run.archived)) matches = matches.filter((run) => !run.archived);
  if (matches.length > 1 && matches.some((run) => run.takesSlot || run.sessionActive)) matches = matches.filter((run) => run.takesSlot || run.sessionActive);
  const [run, ...others] = matches;
  if (!run) throw new CliError(text.noRun(reference));
  if (others.length > 0) throw new CliError(text.severalRuns(reference, matches.map((match) => `  ${shortId(match.id)}  ${runLabel(match)}`).join("\n")));
  return run;
}

/** The queued launch a reference names: its id, the end of its id, or its ticket. */
export function resolveQueued(reference: string, queued: QueuedRunView[], language: Language): QueuedRunView {
  const text = texts(language).cli;
  let matches = queued.filter((entry) => namesId(reference, entry.id));
  if (matches.length === 0) matches = queued.filter((entry) => namesTicket(reference, entry.issueUrl));
  const [entry, ...others] = matches;
  if (!entry) throw new CliError(text.noQueued(reference));
  if (others.length > 0) throw new CliError(text.severalQueued(reference, matches.map((match) => `  ${shortId(match.id)}  ${runLabel(match)}`).join("\n")));
  return entry;
}

type Asked = PendingQuestion["questions"][number];

/**
 * What the user typed for one question, as the answer the workflow receives.
 * Numbers pick the suggested choices by their rank, several separated by commas
 * when the question takes several; anything else is the answer in the user's
 * own words. Undefined when nothing was typed or a number names no choice.
 */
export function answerFromInput(question: Asked, input: string): string | undefined {
  const text = input.trim();
  if (!text) return undefined;
  const tokens = text.split(",").map((token) => token.trim());
  if (question.options.length === 0 || !tokens.every((token) => /^\d+$/.test(token))) return text;
  if (tokens.length > 1 && !question.multiSelect) return undefined;
  const labels = tokens.map((token) => question.options[Number(token) - 1]?.label);
  if (labels.some((label) => label === undefined)) return undefined;
  return [...new Set(labels)].join(", ");
}

/** One input per question, in the order asked. The whole decision is refused when one of them does not answer its question. */
export function answersFromInputs(pending: PendingQuestion, inputs: string[], language: Language): Record<string, string> {
  const text = texts(language).cli;
  if (inputs.length !== pending.questions.length) throw new CliError(text.answerCount(pending.questions.length, inputs.length));
  return Object.fromEntries(pending.questions.map((question, index) => {
    const answer = answerFromInput(question, inputs[index] ?? "");
    if (answer === undefined) throw new CliError(text.answerInvalid(inputs[index] ?? "", question.question, question.multiSelect));
    return [question.question, answer];
  }));
}
