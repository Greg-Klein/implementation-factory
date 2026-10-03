import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { belongsToRun, runtimeRecipeStore } from "../../server/domain";

jest.mock("chokidar", () => ({ __esModule: true, default: { watch: () => ({ on: () => undefined, close: async () => undefined }) } }));

const storage = mkdtempSync(path.join(os.tmpdir(), "harness-recipe-"));
process.env.IMPL_DATA_DIR = storage;
let recipes: typeof import("../../server/runtime-recipe");
let RunSession: typeof import("../../server/run-session").RunSession;

beforeAll(async () => {
  recipes = await import("../../server/runtime-recipe");
  ({ RunSession } = await import("../../server/run-session"));
});
afterAll(() => rmSync(storage, { recursive: true, force: true }));

function checkout(name: string) {
  const directory = path.join(storage, "checkouts", name);
  mkdirSync(path.join(directory, ".claude", "tasks"), { recursive: true });
  return directory;
}

describe("the runtime recipe of a repository", () => {
  it("should keep one file per checkout, two checkouts of the same name apart", () => {
    const first = runtimeRecipeStore("/data", "/work/a/shop");
    expect(first).toMatch(/^\/data\/repositories\/shop-[0-9a-f]{10}\/runtime-recipe\.md$/);
    expect(runtimeRecipeStore("/data", "/work/a/shop/")).toBe(first);
    expect(runtimeRecipeStore("/data", "/work/b/shop")).not.toBe(first);
  });

  it("should hand nothing to the first run of a repository", async () => {
    const worktree = checkout("first-run");
    await expect(recipes.seedRuntimeRecipe("/work/never-seen", worktree)).resolves.toBe(false);
    expect(existsSync(path.join(worktree, ".claude", "tasks", "runtime-recipe.md"))).toBe(false);
  });

  it("should keep what a run wrote and hand it to the next run of that repository", async () => {
    const repository = "/work/shop";
    const worktree = checkout("run-1");
    const written = path.join(worktree, ".claude", "tasks", "runtime-recipe.md");
    writeFileSync(written, "# Recette d'exécution\n\n## Lancer\n\n- `npm run dev -- --port <port>`\n");
    const session = new RunSession("run-recipe-1", { status: "running", phase: 6, cwd: worktree, repository });
    await recipes.keepRuntimeRecipe(session, written);
    const stored = runtimeRecipeStore(storage, repository);
    expect(readFileSync(stored, "utf8")).toContain("npm run dev");
    // Written a while ago, so the copy handed to the next run is older than that run.
    const earlier = new Date(Date.now() - 3_600_000);
    utimesSync(stored, earlier, earlier);

    const next = checkout("run-2");
    const startedAt = new Date().toISOString();
    await expect(recipes.seedRuntimeRecipe(repository, next)).resolves.toBe(true);
    const seeded = path.join(next, ".claude", "tasks", "runtime-recipe.md");
    expect(readFileSync(seeded, "utf8")).toContain("npm run dev");
    expect(belongsToRun(statSync(seeded).mtimeMs, startedAt)).toBe(false);
  });

  it("should not keep an empty or oversized file", async () => {
    const repository = "/work/oversized";
    const worktree = checkout("run-3");
    const written = path.join(worktree, ".claude", "tasks", "runtime-recipe.md");
    const session = new RunSession("run-recipe-3", { status: "running", phase: 6, cwd: worktree, repository });
    writeFileSync(written, "");
    await recipes.keepRuntimeRecipe(session, written);
    writeFileSync(written, "x".repeat(70_000));
    await recipes.keepRuntimeRecipe(session, written);
    expect(existsSync(runtimeRecipeStore(storage, repository))).toBe(false);
  });
});
