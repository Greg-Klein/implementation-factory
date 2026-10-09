import { describe, expect, it } from "@jest/globals";

import { CliError } from "../../cli/client";
import { answerFromInput, answersFromInputs, resolveQueued, resolveRun, shortId } from "../../cli/select";
import type { PendingQuestion, QueuedRunView, RunSummary } from "../../server/types";

function run(id: string, issueUrl: string, extra: Partial<RunSummary> = {}): RunSummary {
  return { id, status: "running", phase: 3, cwd: "/work/shop", repository: "/work/shop", issueUrl, startedAt: null, endedAt: null, sessionActive: true, pendingQuestionCount: 0, runningAgents: 0, holdsRepository: true, takesSlot: true, ...extra };
}

const first = run("2026-10-09T08-00-00-000Z-aaaa1111", "https://gitlab.example.com/acme/shop/-/issues/12");
const second = run("2026-10-09T09-00-00-000Z-bbbb2222", "https://gitlab.example.com/acme/shop/-/issues/13");

describe("the run a reference names on the command line", () => {
  it("should find a run by its id, by the end of its id and by the start of it", () => {
    const snapshot = { runs: [first, second], archived: [] };
    expect(resolveRun(first.id, snapshot)).toBe(first);
    expect(resolveRun(shortId(second.id), snapshot)).toBe(second);
    expect(resolveRun("2026-10-09T09", snapshot)).toBe(second);
  });

  it("should find a run by its ticket, written as a number or under either of its addresses", () => {
    const snapshot = { runs: [first, second], archived: [] };
    expect(resolveRun("#13", snapshot)).toBe(second);
    expect(resolveRun("12", snapshot)).toBe(first);
    expect(resolveRun("https://GitLab.example.com/acme/shop/-/work_items/12?tab=notes", snapshot)).toBe(first);
  });

  it("should prefer the run the console still holds over the archive of an earlier one on the same ticket", () => {
    const earlier = run("2026-10-01T08-00-00-000Z-cccc3333", first.issueUrl, { status: "failed", sessionActive: false, takesSlot: false });
    expect(resolveRun("#12", { runs: [first], archived: [earlier] })).toBe(first);
    expect(resolveRun("cccc3333", { runs: [first], archived: [earlier] })).toMatchObject({ id: earlier.id, archived: true });
  });

  it("should prefer the run still at work over an ended one of the same ticket", () => {
    const ended = run("2026-10-08T08-00-00-000Z-dddd4444", first.issueUrl, { status: "completed", sessionActive: false, takesSlot: false });
    expect(resolveRun("#12", { runs: [ended, first], archived: [] })).toBe(first);
  });

  it("should refuse a reference that names several runs, with the runs it names", () => {
    const twin = run("2026-10-09T08-30-00-000Z-eeee5555", first.issueUrl);
    expect(() => resolveRun("#12", { runs: [first, twin], archived: [] })).toThrow(/names several runs:\n {2}aaaa1111 .*\n {2}eeee5555/);
  });

  it("should refuse a reference that names no run", () => {
    expect(() => resolveRun("zzz", { runs: [first], archived: [] })).toThrow(CliError);
    expect(() => resolveRun("#99", { runs: [first], archived: [] })).toThrow("No run matches");
  });
});

describe("the queued launch a reference names", () => {
  const entry = (id: string, issueUrl: string): QueuedRunView => ({ id, cwd: "/work/shop", repository: "/work/shop", issueUrl, instruction: "", queuedAt: "2026-10-09T08:00:00.000Z", reason: "slot" });
  const queued = [entry("queued-aaaa1111", first.issueUrl), entry("queued-bbbb2222", second.issueUrl)];

  it("should find it by its id, the end of its id or its ticket", () => {
    expect(resolveQueued("queued-aaaa1111", queued)).toBe(queued[0]);
    expect(resolveQueued("bbbb2222", queued)).toBe(queued[1]);
    expect(resolveQueued("#13", queued)).toBe(queued[1]);
  });

  it("should refuse a reference that names none", () => {
    expect(() => resolveQueued("#99", queued)).toThrow("No queued launch matches");
  });
});

describe("an answer typed on the command line", () => {
  const single = { question: "Which base?", header: "Base", multiSelect: false, options: [{ label: "develop" }, { label: "main" }] };
  const several = { question: "Which checks?", header: "Checks", multiSelect: true, options: [{ label: "lint" }, { label: "tests" }, { label: "build" }] };
  const open = { question: "Which name?", header: "Name", multiSelect: false, options: [] };

  it("should read a number as the choice of that rank", () => {
    expect(answerFromInput(single, " 2 ")).toBe("main");
  });

  it("should read several numbers as several choices, in the format the panel sends", () => {
    expect(answerFromInput(several, "3, 1,3")).toBe("build, lint");
  });

  it("should keep anything else as the user's own words", () => {
    expect(answerFromInput(single, "release/2.4")).toBe("release/2.4");
    expect(answerFromInput(open, "42")).toBe("42");
  });

  it("should refuse a number that names no choice, several choices where one is asked, and an empty answer", () => {
    expect(answerFromInput(single, "3")).toBeUndefined();
    expect(answerFromInput(single, "0")).toBeUndefined();
    expect(answerFromInput(single, "1,2")).toBeUndefined();
    expect(answerFromInput(single, "  ")).toBeUndefined();
  });

  it("should answer every question of a decision by the text it asks", () => {
    const pending: PendingQuestion = { id: "q1", questions: [single, several] };
    expect(answersFromInputs(pending, ["1", "2,3"])).toEqual({ "Which base?": "develop", "Which checks?": "tests, build" });
  });

  it("should refuse a decision answered in part, or with an answer that does not read", () => {
    const pending: PendingQuestion = { id: "q1", questions: [single, several] };
    expect(() => answersFromInputs(pending, ["1"])).toThrow("2 questions, 1 answer was given");
    expect(() => answersFromInputs(pending, ["9", "1"])).toThrow('"9" does not answer "Which base?"');
  });
});
