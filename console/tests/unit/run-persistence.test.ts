import { afterAll, describe, expect, it } from "@jest/globals";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDirectory = mkdtempSync(path.join(os.tmpdir(), "run-persistence-"));
process.env.IMPL_DATA_DIR = dataDirectory;

afterAll(() => rmSync(dataDirectory, { recursive: true, force: true }));

describe("run archive persistence", () => {
  it("should keep the latest state and a whole file when publications follow each other closely", async () => {
    const { RunSession } = await import("../../server/run-session");
    const session = new RunSession("run-persist", { status: "running", phase: 1, cwd: "/work/repo" });
    for (let phase = 2; phase <= 9; phase += 1) {
      session.state.phase = phase;
      void session.persist();
    }
    await session.persist();
    const runDirectory = path.join(dataDirectory, "runs", "run-persist");
    const archived = JSON.parse(readFileSync(path.join(runDirectory, "run.json"), "utf8")) as { phase: number };
    expect(archived.phase).toBe(9);
    expect(readdirSync(runDirectory).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
