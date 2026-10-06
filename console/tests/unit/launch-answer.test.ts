import { describe, expect, it } from "@jest/globals";

import { launchAnswer } from "../../lib/launch";
import { appendTerminalOutput } from "../../lib/terminal-output";
import type { RunState } from "../../lib/types";

const at = "2026-10-06T08:00:00.000Z";

describe("the answer to a launch the page is waiting on", () => {
  it("should open the run the server started for this request", () => {
    expect(launchAnswer("request-1", { type: "run.started", runId: "run-b", requestId: "request-1" })).toEqual({ outcome: "started", runId: "run-b" });
  });

  it("should not take the run of another request, nor one that names no request", () => {
    expect(launchAnswer("request-1", { type: "run.started", runId: "run-c", requestId: "request-2" })).toBeUndefined();
    expect(launchAnswer("request-1", { type: "run.started", runId: "run-c" })).toBeUndefined();
    expect(launchAnswer("request-1", { type: "run.started", runId: "run-b", requestId: "request-1" })).toEqual({ outcome: "started", runId: "run-b" });
  });

  it("should not read the state of a run the page subscribed to meanwhile as the answer", () => {
    const state = { id: "run-a" } as RunState;
    expect(launchAnswer("request-1", { type: "run", state })).toBeUndefined();
  });

  it("should end the wait on the notice that queued this launch, and on no other notice", () => {
    expect(launchAnswer("request-1", { type: "notice", level: "info", title: "Run queued", at, queuedId: "queued-1", requestId: "request-1" })).toEqual({ outcome: "queued" });
    expect(launchAnswer("request-1", { type: "notice", level: "attention", title: "Launch refused", at })).toBeUndefined();
  });

  it("should end the wait on the error that refused this launch, and not on the error of another action", () => {
    expect(launchAnswer("request-1", { type: "error", message: "The directory is not a git repository.", requestId: "request-1" })).toEqual({ outcome: "refused" });
    expect(launchAnswer("request-1", { type: "error", message: "This run no longer exists.", runId: "run-a" })).toBeUndefined();
  });

  it("should answer nothing when no launch is waiting", () => {
    expect(launchAnswer(undefined, { type: "run.started", runId: "run-b" })).toBeUndefined();
    expect(launchAnswer("request-1", { type: "run.started", runId: "run-b", requestId: "request-1" })).toEqual({ outcome: "started", runId: "run-b" });
  });
});

describe("terminal output kept until a terminal can take it", () => {
  it("should add what arrives to what is waiting", () => {
    expect(appendTerminalOutput("first ", "second", 20)).toBe("first second");
  });

  it("should keep only the most recent characters past the limit", () => {
    expect(appendTerminalOutput("abcdef", "ghij", 8)).toBe("cdefghij");
  });
});
