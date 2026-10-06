import { describe, expect, it } from "@jest/globals";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * A ratchet over the habits a code audit found behind several defects. Each
 * one is counted per file and compared with `fixtures/code-habits.json`: a
 * file may not hold more of a habit than the baseline says, and a baseline
 * that says more than the code holds is stale. The occurrences already there
 * are debt the baseline records, not a model to follow.
 *
 * After removing occurrences, or moving them from one file to another:
 *   UPDATE_CODE_HABITS=1 npx jest tests/unit/code-habits.test.ts
 * which rewrites the baseline unless a habit grew as a whole. Letting one grow
 * means editing the baseline by hand, in a diff a reviewer reads.
 */

type Habit = {
  id: string;
  /** Where it is looked for: the code that ships, or the tests. */
  scope: "source" | "tests";
  pattern: RegExp;
  /** What to write instead, shown when the count of a file goes up. */
  instead: string;
  /** One line that holds the habit, and its sound form, which must not count. */
  example: string;
  sound: string;
};

const HABITS: Habit[] = [
  {
    id: "swallowed-rejection",
    scope: "source",
    pattern: /\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(?:undefined|null|void 0|\{\s*\})\s*\)/g,
    instead: "Handle the failure where it happens: log it with its context, or keep it on the state the user sees. A write that failed in silence is read later as a write that happened.",
    example: "await writeFile(file, content).catch(() => undefined);",
    sound: "await writeFile(file, content).catch((error) => report(file, error));",
  },
  {
    id: "empty-catch",
    scope: "source",
    pattern: /\bcatch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\*[\s\S]*?\*\/\s*)?\}/g,
    instead: "Catch the one failure that is expected (a missing file is `ENOENT`) and let the others surface: an empty block reads a corrupt file as an absent one.",
    example: "try { stored = JSON.parse(text); } catch { /* no queue was left */ }",
    sound: "try { stored = JSON.parse(text); } catch (error) { if (!isMissing(error)) throw error; }",
  },
  {
    id: "floating-promise",
    scope: "source",
    pattern: /(?:^|[\s;{(,>])void\s+(?!0\b)[A-Za-z_$]/gm,
    instead: "Await the promise, or end it with a `.catch` that reports: `void` drops the rejection with the result.",
    example: "watcher.on(\"add\", (file) => void archive(file));",
    sound: "watcher.on(\"add\", (file) => { archive(file).catch((error) => report(file, error)); });",
  },
  {
    id: "cast-parsed-json",
    scope: "source",
    pattern: /(?:JSON\.parse\(.*\)|\.json\(\))\)?\s+as\s+(?!unknown\b)/g,
    instead: "Parse to `unknown` and give it a shape with a validator that drops the faulty entry and says so. A cast lets a file written by an agent, an older version or a forge throw at its first use.",
    example: "const state = JSON.parse(await readFile(file, \"utf8\")) as RunState;",
    sound: "const state = readRunState(JSON.parse(await readFile(file, \"utf8\")) as unknown);",
  },
  {
    id: "env-nullish-default",
    scope: "source",
    pattern: /\benv\.[A-Z][A-Z0-9_]*\s*\?\?(?!\s*"")/g,
    instead: "Use `||`, or the reader in `server/config.ts`: `??` keeps an empty variable, which `impl config` treats as absent. An empty default (`?? \"\"`) is not counted.",
    example: "const host = process.env.IMPL_HOST ?? \"127.0.0.1\";",
    sound: "const host = process.env.IMPL_HOST || \"127.0.0.1\";",
  },
  {
    id: "fixed-wait",
    scope: "tests",
    pattern: /\bwaitForTimeout\(/g,
    instead: "Wait on the event that proves the server went through the step, then assert the absence: after a fixed wait, \"nothing happened\" also passes when the server is slow.",
    example: "await page.waitForTimeout(800);",
    sound: "await expect(page.getByText(\"Queued\")).toBeVisible();",
  },
  {
    id: "existence-only-assertion",
    scope: "tests",
    pattern: /\.(?:toBeDefined|toBeTruthy)\(\)/g,
    instead: "Assert the value: which rule refused, which reason was given. Existence passes for any refusal, the wrong one included (`principles/test-quality.md`, weak assertion).",
    example: "expect(guardDecision(call)).toBeDefined();",
    sound: "expect(guardDecision(call)?.reason).toContain(\"git reset --hard\");",
  },
  {
    id: "skipped-test",
    scope: "tests",
    pattern: /\b(?:it|test|describe)\.skip\b/g,
    instead: "Give the test what it needs to run everywhere, or delete it: a skipped test is a green line that checked nothing.",
    example: "(canInspectPorts ? it : it.skip)(\"should stop the server\", run);",
    sound: "it(\"should stop the server\", run);",
  },
];

const consoleRoot = process.cwd();
const repositoryRoot = path.resolve(consoleRoot, "..");
const baselineFile = path.join(consoleRoot, "tests/unit/fixtures/code-habits.json");
const SCOPES: Record<Habit["scope"], string[]> = {
  source: ["console/server", "console/components", "console/lib", "console/app", "console/scripts", "hooks", "bin"],
  tests: ["console/tests"],
};
const EXTENSIONS = [".ts", ".tsx", ".mjs"];
/** This file quotes every habit it looks for. */
const SELF = "console/tests/unit/code-habits.test.ts";

type Counts = Record<string, Record<string, number>>;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(file);
    return EXTENSIONS.includes(path.extname(entry.name)) ? [file] : [];
  });
}

function occurrences(habit: Habit, text: string) {
  return [...text.matchAll(habit.pattern)].length;
}

function total(perFile: Record<string, number> = {}) {
  return Object.values(perFile).reduce((sum, count) => sum + count, 0);
}

function currentCounts(): Counts {
  const texts = new Map<string, string>();
  const read = (file: string) => texts.get(file) ?? texts.set(file, readFileSync(file, "utf8")).get(file)!;
  return Object.fromEntries(HABITS.map((habit) => {
    const perFile: Record<string, number> = {};
    for (const file of SCOPES[habit.scope].flatMap((directory) => sourceFiles(path.join(repositoryRoot, directory))).sort()) {
      const relative = path.relative(repositoryRoot, file).split(path.sep).join("/");
      const count = relative === SELF ? 0 : occurrences(habit, read(file));
      if (count > 0) perFile[relative] = count;
    }
    return [habit.id, perFile];
  }));
}

function readBaseline(): Counts {
  return existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, "utf8")) as Counts : {};
}

describe("code habits", () => {
  it.each(HABITS)("should recognise $id in the line that shows it, and not in its sound form", (habit) => {
    expect(occurrences(habit, habit.example)).toBe(1);
    expect(occurrences(habit, habit.sound)).toBe(0);
  });

  it("should hold no more of a habit in a file than the baseline records", () => {
    const current = currentCounts();
    if (process.env.UPDATE_CODE_HABITS) {
      const grown = existsSync(baselineFile) ? HABITS.filter((habit) => total(current[habit.id]) > total(readBaseline()[habit.id])).map((habit) => habit.id) : [];
      // A habit that grew is not recorded: the baseline only ever goes down by this path.
      expect(grown).toEqual([]);
      writeFileSync(baselineFile, `${JSON.stringify(current, null, 2)}\n`);
    }
    const baseline = readBaseline();
    const added: string[] = [];
    const stale: string[] = [];
    for (const habit of HABITS) {
      const before = baseline[habit.id] ?? {};
      const now = current[habit.id];
      for (const file of new Set([...Object.keys(before), ...Object.keys(now)])) {
        const was = before[file] ?? 0;
        const is = now[file] ?? 0;
        if (is > was) added.push(`${file}: ${habit.id} ${was} -> ${is}. ${habit.instead}`);
        if (is < was) stale.push(`${file}: ${habit.id} ${was} -> ${is}`);
      }
    }
    expect(added).toEqual([]);
    // Fewer than recorded: the baseline is tightened so the place cannot be taken back.
    expect(stale.length > 0 ? ["Run: UPDATE_CODE_HABITS=1 npx jest tests/unit/code-habits.test.ts", ...stale] : []).toEqual([]);
  });
});
