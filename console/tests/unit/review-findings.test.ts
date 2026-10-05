import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { belongsToRun, FINDING_CATEGORIES, type KeptFinding, mergeReviewFindings, readReviewFindings, recurringFindings, renderRecurringFindings, reviewFindingsStore, runtimeRecipeStore } from "../../server/domain";

jest.mock("chokidar", () => ({ __esModule: true, default: { watch: () => ({ on: () => undefined, close: async () => undefined }) } }));

const storage = mkdtempSync(path.join(os.tmpdir(), "harness-findings-"));
process.env.IMPL_DATA_DIR = storage;
let findings: typeof import("../../server/review-findings");
let RunSession: typeof import("../../server/run-session").RunSession;

beforeAll(async () => {
  findings = await import("../../server/review-findings");
  ({ RunSession } = await import("../../server/run-session"));
});
afterAll(() => rmSync(storage, { recursive: true, force: true }));

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-05T12:00:00Z");
const kept = (ticket: string, category: string, daysAgo = 1, extra: Partial<KeptFinding> = {}): KeptFinding => ({
  id: `SR-R1-${ticket}-${category}-${daysAgo}`, runId: `run-${ticket}`, ticket: `https://github.com/acme/shop/issues/${ticket}`,
  at: new Date(NOW - daysAgo * DAY).toISOString(), category, severity: "P1", summary: `${category} on ticket ${ticket}`, fixed: true, ...extra,
});

function checkout(name: string) {
  const directory = path.join(storage, "checkouts", name);
  mkdirSync(path.join(directory, ".claude", "tasks"), { recursive: true });
  return directory;
}

/** A run whose senior reviewer wrote these findings. */
async function review(runId: string, repository: string, ticket: string, entries: object[]) {
  const worktree = checkout(runId);
  const written = path.join(worktree, ".claude", "tasks", "senior-findings.json");
  writeFileSync(written, JSON.stringify({ schemaVersion: 1, source: "senior", round: 1, findings: entries }));
  await findings.keepReviewFindings(new RunSession(runId, { status: "running", phase: 7, cwd: worktree, repository, issueUrl: ticket }), written);
}

describe("reading the findings a senior reviewer wrote", () => {
  it("should keep what can be counted and file an unknown category under other", () => {
    const read = readReviewFindings(JSON.stringify({ findings: [
      { id: "SR-R1-1", category: "error-handling", severity: "P0", file: "src/api.ts", summary: "  The catch\n hides the cause. ", fixed: true },
      { id: "SR-R1-2", category: "bad vibes", severity: "blocker", summary: "Something else." },
      { id: "SR-R1-1", category: "edge-case", summary: "The same id twice." },
      { id: "", category: "edge-case", summary: "No id." },
      { id: "SR-R1-3", category: "edge-case" },
      "not an entry",
    ] }));
    expect(read).toEqual([
      { id: "SR-R1-1", category: "error-handling", severity: "P0", file: "src/api.ts", summary: "The catch hides the cause.", fixed: true },
      { id: "SR-R1-2", category: "other", severity: "P2", summary: "Something else.", fixed: false },
    ]);
  });

  it("should tell a review that found nothing from a file that is not one", () => {
    expect(readReviewFindings("{\"findings\": []}")).toEqual([]);
    expect(readReviewFindings("{\"items\": []}")).toBeUndefined();
    expect(readReviewFindings("# Revue senior")).toBeUndefined();
  });

  it("should list in the contract exactly the categories the console counts", () => {
    const contract = readFileSync(path.resolve(process.cwd(), "..", "contracts", "review-findings.md"), "utf8");
    const listed = [...contract.matchAll(/^\| `([a-z-]+)` \|/gm)].map((match) => match[1]);
    expect(listed).toEqual(Object.keys(FINDING_CATEGORIES));
  });
});

describe("the findings kept for a repository", () => {
  const run = { runId: "run-7", ticket: "https://github.com/acme/shop/issues/7?focus=1#note" };
  const finding = (id: string, summary = "x") => ({ id, category: "edge-case", severity: "P1" as const, summary, fixed: true });

  it("should add the findings of a later round to those of the earlier ones, and replace one written again", () => {
    const first = mergeReviewFindings([], [finding("SR-R1-1"), finding("SR-R1-2")], run, NOW);
    const second = mergeReviewFindings(first, [finding("SR-R2-1"), finding("SR-R1-2", "reworded")], run, NOW + 1000);
    expect(second.map(({ id, summary }) => `${id} ${summary}`)).toEqual(["SR-R1-1 x", "SR-R2-1 x", "SR-R1-2 reworded"]);
    expect(second[0].ticket).toBe("https://github.com/acme/shop/issues/7");
  });

  it("should keep the same id of two runs apart, and let go of what is six months old", () => {
    const old = kept("3", "edge-case", 200);
    const merged = mergeReviewFindings([old, kept("4", "edge-case", 10, { id: "SR-R1-1" })], [finding("SR-R1-1")], run, NOW);
    expect(merged.map(({ runId, id }) => `${runId} ${id}`)).toEqual(["run-4 SR-R1-1", "run-7 SR-R1-1"]);
  });
});

describe("the kinds of defect that keep coming back", () => {
  it("should need two tickets, however many times one ticket repeats itself", () => {
    const sameTicket = [kept("1", "ui-state", 1), kept("1", "ui-state", 2), kept("1", "ui-state", 3, { runId: "run-1-again" })];
    expect(recurringFindings(sameTicket, NOW)).toEqual([]);
    expect(recurringFindings([...sameTicket, kept("2", "ui-state", 4)], NOW).map(({ category, tickets, findings: count }) => `${category} ${tickets} ${count}`)).toEqual(["ui-state 2 4"]);
  });

  it("should leave out what is older than three months and what was filed under other", () => {
    expect(recurringFindings([kept("1", "edge-case", 1), kept("2", "edge-case", 91)], NOW)).toEqual([]);
    expect(recurringFindings([kept("1", "other", 1), kept("2", "other", 2)], NOW)).toEqual([]);
  });

  it("should put the most widespread first, keep five and quote the three latest examples of each", () => {
    const categories = ["edge-case", "ui-state", "test-gap", "type-escape", "duplication", "dead-code"];
    const all = categories.flatMap((category) => [kept("1", category, 5), kept("2", category, 4)]);
    all.push(kept("3", "test-gap", 3), kept("4", "test-gap", 2), kept("5", "ui-state", 1));
    const recurring = recurringFindings(all, NOW);
    expect(recurring.map(({ category }) => category)).toEqual(["test-gap", "ui-state", "edge-case", "type-escape", "duplication"]);
    expect(recurring[0].examples.map(({ ticket }) => ticket.split("/").pop())).toEqual(["4", "3", "2"]);
  });

  it("should write a file that names each habit with its count and its examples", () => {
    const text = renderRecurringFindings(recurringFindings([kept("1", "ui-state", 2, { file: "src/List.tsx", summary: "The list shows nothing while it loads." }), kept("2", "ui-state", 1, { severity: "P0" })], NOW));
    expect(text).toContain("## A loading, empty or error state missing (`ui-state`): 2 findings on 2 tickets");
    expect(text).toContain("- P1 `src/List.tsx`: The list shows nothing while it loads.");
    expect(text).toContain("- P0: ui-state on ticket 2");
    expect(text).toContain("not requirements");
  });
});

describe("handing the habits of a repository to its next run", () => {
  it("should keep the findings beside the runtime recipe of the repository", () => {
    expect(path.dirname(reviewFindingsStore("/data", "/work/shop"))).toBe(path.dirname(runtimeRecipeStore("/data", "/work/shop")));
  });

  it("should hand nothing after one ticket, and the habit once a second ticket shows it", async () => {
    const repository = "/work/habits";
    await review("run-h1", repository, "https://github.com/acme/shop/issues/1", [{ id: "SR-R1-1", category: "consumer-left-behind", severity: "P1", file: "src/badge.ts", summary: "The badge still reads the old total.", fixed: true }]);
    const second = checkout("run-h2-start");
    await expect(findings.seedRecurringFindings(repository, second)).resolves.toBe(0);
    expect(existsSync(path.join(second, ".claude", "tasks", "recurring-findings.md"))).toBe(false);

    await review("run-h2", repository, "https://github.com/acme/shop/issues/2", [{ id: "SR-R1-1", category: "consumer-left-behind", severity: "P1", summary: "The export still sends the old column.", fixed: false }]);
    // Found a while ago, as the findings of an earlier run are.
    const stored = reviewFindingsStore(storage, repository);
    const earlier = new Date(Date.now() - 3_600_000).toISOString();
    const aged = (JSON.parse(readFileSync(stored, "utf8")) as { findings: KeptFinding[] }).findings.map((finding) => ({ ...finding, at: earlier }));
    writeFileSync(stored, JSON.stringify({ version: 1, findings: aged }));
    const third = checkout("run-h3-start");
    const startedAt = new Date().toISOString();
    await expect(findings.seedRecurringFindings(repository, third)).resolves.toBe(1);
    const seeded = path.join(third, ".claude", "tasks", "recurring-findings.md");
    expect(readFileSync(seeded, "utf8")).toContain("The export still sends the old column.");
    expect(readFileSync(seeded, "utf8")).toContain("`src/badge.ts`: The badge still reads the old total.");
    // Dated like its latest finding, so the watcher of the new run does not archive it as its own.
    expect(belongsToRun(statSync(seeded).mtimeMs, startedAt)).toBe(false);
  });

  it("should not lose a finding when two runs of one repository write at the same time", async () => {
    const repository = "/work/together";
    await Promise.all(["1", "2", "3", "4"].map((ticket) => review(`run-t${ticket}`, repository, `https://github.com/acme/shop/issues/${ticket}`, [{ id: "SR-R1-1", category: "test-gap", severity: "P1", summary: `Ticket ${ticket}.`, fixed: false }])));
    const stored = JSON.parse(readFileSync(reviewFindingsStore(storage, repository), "utf8")) as { findings: KeptFinding[] };
    expect(stored.findings.map(({ runId }) => runId).sort()).toEqual(["run-t1", "run-t2", "run-t3", "run-t4"]);
  });

  it("should keep nothing from a file that is not findings, and say so", async () => {
    const repository = "/work/malformed";
    const worktree = checkout("run-m1");
    const written = path.join(worktree, ".claude", "tasks", "senior-findings.json");
    writeFileSync(written, "{ not json");
    const session = new RunSession("run-m1", { status: "running", phase: 7, cwd: worktree, repository, issueUrl: "https://github.com/acme/shop/issues/9" });
    await findings.keepReviewFindings(session, written);
    expect(existsSync(reviewFindingsStore(storage, repository))).toBe(false);
    expect(session.state.activities.some((activity) => activity.title === "Review findings not kept")).toBe(true);
  });
});
