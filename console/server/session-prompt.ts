import { now } from "./context.js";
import { runInProgress } from "./domain.js";
import { engine, type EngineEvent, type SessionPromptDecision } from "./engine/index.js";
import type { RunSession } from "./run-session.js";

/**
 * The prompt an agent raises before its session really starts, the folder trust
 * dialog first of all. It is not a workflow question: no hook carries it and
 * nothing waits on a promise for its answer, so it does not go through the
 * question bridge. It is a small state of its own, `RunState.sessionPrompt`,
 * set when the engine sees the prompt on the terminal and dropped as soon as
 * anything shows it is gone: an answer from the console, a hook (the session
 * runs, so the prompt was answered in the terminal), the screen moving on, or
 * the session exiting.
 *
 * The console never answers by itself. The decision is the user's, and the
 * engine only types what they chose.
 */

function show(session: RunSession, event: Extract<EngineEvent, { kind: "session.prompt" }>) {
  if (session.state.sessionPrompt || !session.state.sessionActive || !runInProgress(session.state.status)) return false;
  session.state.sessionPrompt = { id: crypto.randomUUID(), kind: event.prompt, directory: event.directory, since: now() };
  session.state.status = "attention";
  session.state.action = undefined;
  session.activity("attention", session.texts.serverRun.trustAsks(engine.label), event.directory);
  return true;
}

/** The prompt is no longer on screen. `started`: the session went on, which only an accepted prompt allows. */
function drop(session: RunSession, started: boolean) {
  if (!session.state.sessionPrompt) return false;
  session.state.sessionPrompt = undefined;
  if (session.state.status === "attention" && !session.state.pendingQuestion) session.state.status = "running";
  if (started) session.activity("system", session.texts.serverRun.trustedInTerminal);
  return true;
}

/** What the engine read off the terminal, outside of any hook. */
export function applySessionEvent(session: RunSession, event: EngineEvent) {
  if (session.disposed) return;
  const changed = event.kind === "session.prompt" ? show(session, event) : event.kind === "session.prompt.end" ? drop(session, true) : false;
  if (!changed) return;
  session.publish();
  session.signal();
}

/** A hook arrived: the session executes, so whatever it was asking before it started has been answered. */
export function sessionStarted(session: RunSession) {
  return drop(session, true);
}

export function answerSessionPrompt(session: RunSession, promptId: string, decision: SessionPromptDecision) {
  const prompt = session.state.sessionPrompt;
  if (!prompt || prompt.id !== promptId) throw new Error(session.texts.serverRun.promptGone);
  if (!session.engine) throw new Error(session.texts.serverRun.noSession(engine.label));
  // Said before the keystrokes leave: the exit that follows a refusal must find its reason.
  if (decision === "refuse") session.endedBy = "trust_refused";
  const typed = session.engine.answerPrompt(decision);
  drop(session, false);
  if (!typed) {
    session.endedBy = null;
    session.publish();
    session.signal();
    throw new Error(session.texts.serverRun.promptNotOnScreen);
  }
  session.activity("system", decision === "accept" ? session.texts.serverRun.trustedFolder : session.texts.serverRun.trustDeclined, prompt.directory);
  session.markExecution();
  session.publish();
  session.signal();
}

/**
 * Called when the session exits. An exit on the prompt is a refusal, typed in
 * the console or in the terminal: the run ends as stopped with that reason,
 * never as a session lost on the way.
 */
export function closeSessionPrompt(session: RunSession) {
  const refused = session.endedBy === "trust_refused" || (Boolean(session.state.sessionPrompt) && session.stoppedBy === null);
  session.state.sessionPrompt = undefined;
  if (refused) session.endedBy = "trust_refused";
  return refused ? session.texts.serverRun.trustRefusedError : undefined;
}
