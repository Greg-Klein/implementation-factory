import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { exitReport, summarizeRun } from "../../server/domain";
import { processHook } from "../../server/hooks";
import { createSignals, evaluateRunHealth, healthSignalsView } from "../../server/run-health";
import { RunSession } from "../../server/run-session";
import { answerSessionPrompt, applySessionEvent, closeSessionPrompt } from "../../server/session-prompt";
import { interruptRun } from "../../server/run-incidents";

// A demonstration identifier keeps the run out of the disk archive.
let session: RunSession;
const answers = jest.fn<(decision: "accept" | "refuse") => boolean>();
const directory = "/tmp/untrusted/repo";
const prompt = () => applySessionEvent(session, { kind: "session.prompt", prompt: "folder_trust", directory });

beforeEach(() => {
  session = new RunSession("demo-session-prompt", { status: "running", phase: 1, sessionActive: true, cwd: directory });
  answers.mockReturnValue(true);
  session.engine = { write: () => undefined, submit: () => undefined, resize: () => undefined, kill: () => undefined, answerPrompt: answers };
});

describe("the folder trust prompt as a pending decision", () => {
  it("should show the prompt as a decision the run waits on", () => {
    prompt();
    expect(session.state.sessionPrompt).toMatchObject({ kind: "folder_trust", directory });
    expect(session.state.status).toBe("attention");
    expect(session.state.activities[0]).toMatchObject({ kind: "attention", title: "Claude Code demande de faire confiance à ce dossier", detail: directory });
    expect(summarizeRun(session.state).sessionPromptId).toBe(session.state.sessionPrompt!.id);
  });

  it("should keep the run waiting on the user for as long as the prompt is there", () => {
    prompt();
    const input = (sessionPrompt: boolean) => ({ status: session.state.status, sessionActive: true, stoppedBy: null, pendingQuestion: false, sessionPrompt, agents: [], artifacts: [], signals: healthSignalsView(createSignals(0)) });
    expect(evaluateRunHealth(input(true), 3_600_000)).toMatchObject({ health: "waiting", wait: { reason: "user_question", on: "toi" }, title: "Décision attendue" });
    expect(evaluateRunHealth(input(false), 1_000)).toEqual({ health: "healthy" });
  });

  it("should raise one prompt, not one per redraw", () => {
    prompt();
    const first = session.state.sessionPrompt!.id;
    prompt();
    expect(session.state.sessionPrompt!.id).toBe(first);
    expect(session.state.activities).toHaveLength(1);
  });

  it("should ignore a prompt on a run that is over or has no session", () => {
    session.state.status = "completed";
    prompt();
    expect(session.state.sessionPrompt).toBeUndefined();
    session.state.status = "running";
    session.state.sessionActive = false;
    prompt();
    expect(session.state.sessionPrompt).toBeUndefined();
  });

  it("should type the acceptance and let the run go on", () => {
    prompt();
    answerSessionPrompt(session, session.state.sessionPrompt!.id, "accept");
    expect(answers).toHaveBeenCalledWith("accept");
    expect(session.state.sessionPrompt).toBeUndefined();
    expect(session.state.status).toBe("running");
    expect(session.endedBy).toBeNull();
    expect(session.state.activities[0]).toMatchObject({ title: "Confiance accordée au dossier" });
  });

  it("should type the refusal and remember why the session is about to end", () => {
    prompt();
    answerSessionPrompt(session, session.state.sessionPrompt!.id, "refuse");
    expect(answers).toHaveBeenCalledWith("refuse");
    expect(session.state.sessionPrompt).toBeUndefined();
    expect(session.endedBy).toBe("trust_refused");
    expect(closeSessionPrompt(session)).toMatch(/dossier n'a pas été approuvé/);
    expect(exitReport(null, 1, false, true)).toBe("Session fermée, dossier non approuvé");
  });

  it("should refuse an answer to a prompt that is no longer the one waiting", () => {
    expect(() => answerSessionPrompt(session, "none", "accept")).toThrow("Cette demande n'attend plus de réponse.");
    prompt();
    expect(() => answerSessionPrompt(session, "another", "accept")).toThrow("Cette demande n'attend plus de réponse.");
    expect(answers).not.toHaveBeenCalled();
    expect(session.state.sessionPrompt).toBeDefined();
  });

  it("should say so, and type nothing, when the dialog already left the screen", () => {
    answers.mockReturnValue(false);
    prompt();
    expect(() => answerSessionPrompt(session, session.state.sessionPrompt!.id, "refuse")).toThrow(/n'est plus à l'écran/);
    expect(session.state.sessionPrompt).toBeUndefined();
    expect(session.endedBy).toBeNull();
  });

  it("should drop the prompt by itself when the terminal moves on", () => {
    prompt();
    applySessionEvent(session, { kind: "session.prompt.end" });
    expect(session.state.sessionPrompt).toBeUndefined();
    expect(session.state.status).toBe("running");
    expect(session.state.activities[0]).toMatchObject({ title: "Dossier approuvé dans le terminal" });
  });

  it("should drop the prompt by itself on the first hook, even one the harness has no event for", () => {
    prompt();
    processHook(session, { runId: session.id, payload: { hook_event_name: "SessionStart" } });
    expect(session.state.sessionPrompt).toBeUndefined();
    expect(session.state.status).toBe("running");
  });

  it("should read an exit on the prompt as a refusal typed in the terminal", () => {
    prompt();
    expect(closeSessionPrompt(session)).toMatch(/dossier n'a pas été approuvé/);
    expect(session.state.sessionPrompt).toBeUndefined();
    expect(session.endedBy).toBe("trust_refused");
  });

  it("should not call a stop the user asked for a refusal", () => {
    prompt();
    session.stoppedBy = "user";
    expect(closeSessionPrompt(session)).toBeUndefined();
    expect(session.state.sessionPrompt).toBeUndefined();
  });

  it("should not call an ordinary exit a refusal", () => {
    expect(closeSessionPrompt(session)).toBeUndefined();
    expect(session.endedBy).toBeNull();
  });

  it("should not carry the prompt into the archive of an interrupted run", () => {
    prompt();
    expect(interruptRun(session.state, new Date().toISOString()).sessionPrompt).toBeUndefined();
  });
});
