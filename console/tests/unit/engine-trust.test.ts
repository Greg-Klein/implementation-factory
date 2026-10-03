import { afterAll, afterEach, beforeAll, describe, expect, it } from "@jest/globals";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeCode } from "../../server/engine/claude-code";
import type { EngineEvent, EngineSession } from "../../server/engine/types";

/**
 * The engine against the stand-in `claude` of the integration suite, which
 * draws the captured dialog and takes the keys this engine sends. The real
 * Claude Code was only ever watched drawing it: neither answer was sent to it.
 */
const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "impl-engine-trust-")));
const untrustedRoot = path.join(root, "untrusted");
const environment = { PATH: process.env.PATH, FAKE_CLAUDE_UNTRUSTED_ROOT: process.env.FAKE_CLAUDE_UNTRUSTED_ROOT, FAKE_CLAUDE_INPUT_DIR: process.env.FAKE_CLAUDE_INPUT_DIR };
let live: EngineSession | undefined;

beforeAll(() => {
  process.env.PATH = `${path.join(__dirname, "..", "fake-claude")}${path.delimiter}${process.env.PATH ?? ""}`;
  process.env.FAKE_CLAUDE_UNTRUSTED_ROOT = untrustedRoot;
  delete process.env.FAKE_CLAUDE_INPUT_DIR;
});

afterEach(() => { live?.kill(); live = undefined; });

afterAll(() => {
  for (const [key, value] of Object.entries(environment)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  rmSync(root, { recursive: true, force: true });
});

function start(cwd: string) {
  mkdirSync(cwd, { recursive: true });
  const events: EngineEvent[] = [];
  let output = "";
  let exitCode: number | undefined;
  live = claudeCode.start({
    cwd, sessionLabel: "engine-trust", runId: "engine-trust", command: "/implementation-harness:implement https://gitlab.com/group/repo/-/issues/1", pluginDir: root,
    hookUrl: "http://127.0.0.1:9/api/hooks?token=none", hookSpool: path.join(root, "spool.jsonl"),
    onData: (data) => { output += data; }, onExit: (code) => { exitCode = code; }, onEvent: (event) => events.push(event),
  });
  return { session: live, events, output: () => output, exitCode: () => exitCode };
}

async function until(condition: () => boolean, what: string) {
  const deadline = Date.now() + 8_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("the folder trust dialog seen by the engine", () => {
  it("should report the dialog as a session prompt naming the directory", async () => {
    const cwd = path.join(untrustedRoot, "report");
    const run = start(cwd);
    await until(() => run.events.length > 0, "the session prompt");
    expect(run.events).toEqual([{ kind: "session.prompt", prompt: "folder_trust", directory: cwd }]);
  });

  it("should report nothing, and type nothing, in a directory that opens on its prompt", async () => {
    const run = start(path.join(root, "trusted"));
    await until(() => run.output().includes("fake claude ready"), "the session");
    expect(run.events).toEqual([]);
    expect(run.session.answerPrompt("accept")).toBe(false);
    expect(run.session.answerPrompt("refuse")).toBe(false);
  });

  it("should accept with the keys that move to Yes and confirm it, once", async () => {
    const run = start(path.join(untrustedRoot, "accept"));
    await until(() => run.events.length > 0, "the session prompt");
    expect(run.session.answerPrompt("accept")).toBe(true);
    await until(() => run.output().includes("fake claude ready"), "the session going on");
    expect(run.exitCode()).toBeUndefined();
    expect(run.session.answerPrompt("accept")).toBe(false);
    expect(run.events).toHaveLength(1);
  });

  it("should refuse with the key that makes the session leave", async () => {
    const run = start(path.join(untrustedRoot, "refuse"));
    await until(() => run.events.length > 0, "the session prompt");
    const refusedAt = Date.now();
    expect(run.session.answerPrompt("refuse")).toBe(true);
    await until(() => run.exitCode() !== undefined, "the session leaving");
    // The session left on the keystroke, before the engine would have ended it itself.
    expect(Date.now() - refusedAt).toBeLessThan(1_500);
    expect(run.exitCode()).toBe(1);
    expect(run.output()).not.toContain("fake claude ready");
  });
});
