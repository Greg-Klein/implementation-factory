import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const script = path.resolve(process.cwd(), "..", "hooks", "code-snapshot.mjs");
let repository: string;

function git(...args: string[]) {
  return execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args], { cwd: repository, encoding: "utf8" }).trim();
}

function snapshot(env: Record<string, string> = {}) {
  const output = execFileSync(process.execPath, [script], { cwd: repository, encoding: "utf8", env: { ...process.env, IMPL_SNAPSHOT_EXCLUDE: ".claude/tasks", ...env } });
  return JSON.parse(output) as { id: string; commit: string | null; tree: string };
}

beforeEach(() => {
  repository = mkdtempSync(path.join(os.tmpdir(), "code-snapshot-"));
  git("init", "-q");
  writeFileSync(path.join(repository, "app.ts"), "export const a = 1;\n");
});

afterEach(() => rmSync(repository, { recursive: true, force: true }));

describe("code snapshot utility", () => {
  it("should keep the same identity when the measured state is committed as is", () => {
    const before = snapshot();
    git("add", ".");
    git("commit", "-q", "-m", "init");
    const after = snapshot();
    expect(after.id).toBe(before.id);
    expect(after.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("should change identity on any edit, staged or not, untracked files included", () => {
    const first = snapshot();
    writeFileSync(path.join(repository, "app.ts"), "export const a = 2;\n");
    const edited = snapshot();
    writeFileSync(path.join(repository, "new.ts"), "export {};\n");
    const added = snapshot();
    expect(new Set([first.id, edited.id, added.id]).size).toBe(3);
  });

  it("should ignore the workflow documents and ignored build output", () => {
    const first = snapshot();
    mkdirSync(path.join(repository, ".claude", "tasks"), { recursive: true });
    writeFileSync(path.join(repository, ".claude", "tasks", "qa-report.md"), "report");
    writeFileSync(path.join(repository, ".gitignore"), "dist/\n");
    const withIgnore = snapshot();
    mkdirSync(path.join(repository, "dist"));
    writeFileSync(path.join(repository, "dist", "bundle.js"), "x");
    expect(snapshot().id).toBe(withIgnore.id);
    expect(withIgnore.id).not.toBe(first.id);
  });

  it("should leave the real index untouched and log what it took", () => {
    const log = path.join(repository, "..", `${path.basename(repository)}.jsonl`);
    const taken = snapshot({ IMPL_SNAPSHOT_LOG: log });
    expect(git("status", "--porcelain")).toBe("?? app.ts");
    expect(JSON.parse(readFileSync(log, "utf8").trim()).id).toBe(taken.id);
    rmSync(log, { force: true });
  });
});
