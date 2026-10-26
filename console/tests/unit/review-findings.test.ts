import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { belongsToRun, FINDING_CATEGORIES, findingFixStore, type KeptFinding, mergeReviewFindings, readReviewFindings, recurringFindings, renderRecurringFindings, reviewFindingsStore, runtimeRecipeStore } from "../../server/domain";

jest.mock("chokidar", () => ({ __esModule: true, default: { watch: () => ({ on: () => undefined, close: async () => undefined }) } }));

const storage = mkdtempSync(path.join(os.tmpdir(), "factory-findings-"));
process.env.IMPL_DATA_DIR = storage;
let findings: typeof import("../../server/review-findings");
let guide: typeof import("../../server/review-guide");
let fixes: typeof import("../../server/finding-fixes");
let RunSession: typeof import("../../server/run-session").RunSession;

beforeAll(async () => {
  findings = await import("../../server/review-findings");
  guide = await import("../../server/review-guide");
  fixes = await import("../../server/finding-fixes");
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

  it("should read a bare array as the list of findings", () => {
    expect(readReviewFindings(JSON.stringify([
      { id: "SR-R1-1", category: "edge-case", severity: "P1", summary: "The empty list is not handled." },
      { id: "SR-R1-2", category: "edge-case" },
    ]))).toEqual([{ id: "SR-R1-1", category: "edge-case", severity: "P1", summary: "The empty list is not handled.", fixed: false }]);
  });

  it("should tell a review that found nothing from a file that is not one", () => {
    expect(readReviewFindings("{\"findings\": []}")).toEqual([]);
    expect(readReviewFindings("[]")).toEqual([]);
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
    expect(second[0]!.ticket).toBe("https://github.com/acme/shop/issues/7");
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
    expect(recurring[0]!.examples.map(({ ticket }) => ticket.split("/").pop())).toEqual(["4", "3", "2"]);
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

  it("should copy the first review guide and date it before the run", async () => {
    const worktree = checkout("guide-copy");
    mkdirSync(path.join(worktree, "docs"), { recursive: true });
    writeFileSync(path.join(worktree, "docs", "REVIEW.md"), "# later\n");
    writeFileSync(path.join(worktree, "REVIEW.md"), "# Priorities\n\nLook at money.\n");
    const startedAt = new Date().toISOString();
    await expect(guide.seedReviewGuide(worktree, startedAt)).resolves.toBe("REVIEW.md");
    const copied = path.join(worktree, ".claude", "tasks", "review-guide.md");
    const text = readFileSync(copied, "utf8");
    expect(text.startsWith("<!-- source: REVIEW.md -->\n")).toBe(true);
    expect(text).toContain("Look at money.");
    expect(text).not.toContain("# later");
    expect(statSync(copied).mtimeMs).toBeLessThan(Date.parse(startedAt));
    expect(guide.reviewGuideEnvironment("REVIEW.md")).toEqual({ IMPL_REVIEW_GUIDE: "REVIEW.md" });
    expect(guide.reviewGuideEnvironment(undefined)).toEqual({});
  });

  it("should copy nothing when the repository has no review guide", async () => {
    const worktree = checkout("guide-none");
    await expect(guide.seedReviewGuide(worktree, new Date().toISOString())).resolves.toBeUndefined();
    expect(existsSync(path.join(worktree, ".claude", "tasks", "review-guide.md"))).toBe(false);
  });

  it("should leave an ignored path out of the next runs and still count it for this one", async () => {
    const repository = path.join(storage, "checkouts", "guided");
    mkdirSync(repository, { recursive: true });
    const worktree = checkout("run-ignored");
    writeFileSync(path.join(worktree, ".claude", "tasks", "review-guide.md"), "<!-- source: REVIEW.md -->\n## Ignored paths\n\n- `generated/**`\n");
    const written = path.join(worktree, ".claude", "tasks", "senior-findings.json");
    writeFileSync(written, JSON.stringify({ findings: [
      { id: "SR-R1-1", category: "dead-code", severity: "P2", file: "generated/out.ts", summary: "Generated.", fixed: false },
      { id: "SR-R1-2", category: "dead-code", severity: "P2", file: "src/app.ts", summary: "Real.", fixed: false },
      { id: "SR-R1-3", category: "dead-code", severity: "P2", summary: "No file.", fixed: false },
    ] }));
    const session = new RunSession("run-ignored", { status: "running", phase: 7, cwd: worktree, repository, issueUrl: "https://github.com/acme/shop/issues/8" });
    await findings.keepReviewFindings(session, written);
    const stored = JSON.parse(readFileSync(reviewFindingsStore(storage, repository), "utf8")) as { findings: KeptFinding[] };
    expect(stored.findings.map(({ id }) => id).sort()).toEqual(["SR-R1-2", "SR-R1-3"]);
    expect([...session.seniorFindings.keys()].sort()).toEqual(["SR-R1-1", "SR-R1-2", "SR-R1-3"]);
    expect(session.state.activities.some((activity) => activity.title === "Review guide excluded findings")).toBe(true);
  });
});

describe("a source fix proposed for a habit that keeps coming back", () => {
  const previous = process.env.IMPL_FINDING_FIX_RUNS;
  beforeAll(() => { process.env.IMPL_FINDING_FIX_RUNS = "3"; });
  afterAll(() => {
    if (previous === undefined) delete process.env.IMPL_FINDING_FIX_RUNS;
    else process.env.IMPL_FINDING_FIX_RUNS = previous;
  });

  function entry(summary: string) {
    return [{ id: "SR-R1-1", category: "test-gap", severity: "P1" as const, summary, fixed: false }];
  }

  it("should propose one only once the category spans the configured number of runs", async () => {
    const repository = path.join(storage, "checkouts", "propose");
    mkdirSync(repository, { recursive: true });
    writeFileSync(path.join(repository, "AGENTS.md"), "# Agents\n");
    await review("run-p1", repository, "https://github.com/acme/shop/issues/31", entry("Ticket 31 has no test."));
    await review("run-p2", repository, "https://github.com/acme/shop/issues/32", entry("Ticket 32 has no test."));
    expect(existsSync(findingFixStore(storage, repository))).toBe(false);
    await review("run-p3", repository, "https://github.com/acme/shop/issues/33", entry("Ticket 33 has no test."));
    const proposals = (JSON.parse(readFileSync(findingFixStore(storage, repository), "utf8")) as { proposals: { category: string; status: string; targetFile: string; body: string; title: string }[] }).proposals;
    expect(proposals.map(({ category }) => category)).toEqual(["test-gap"]);
    expect(proposals[0]).toMatchObject({ status: "pending", targetFile: "AGENTS.md" });
    expect(proposals[0]!.body).toContain("<!-- implementation-factory:finding-fix test-gap -->");
    expect(proposals[0]!.body).toMatch(/Review habit|Habitude de revue/);
    expect(proposals[0]!.title).toMatch(/^Record test-gap/);

    const accepted = await fixes.acceptFindingFix(repository, "test-gap");
    expect(accepted.applied).toBe(true);
    expect(readFileSync(path.join(repository, "AGENTS.md"), "utf8").match(/<!-- implementation-factory:finding-fix test-gap -->/g)).toHaveLength(1);
    expect((await fixes.acceptFindingFix(repository, "test-gap")).applied).toBe(false);
    expect(readFileSync(path.join(repository, "AGENTS.md"), "utf8").match(/<!-- implementation-factory:finding-fix test-gap -->/g)).toHaveLength(1);
    await expect(fixes.acceptFindingFix(path.join(repository, ".claude", "worktrees", "run-9"), "test-gap")).rejects.toThrow(/worktree/);
  });

  it("should remember a dismissal and drop the proposals when the findings are forgotten", async () => {
    const repository = path.join(storage, "checkouts", "dismissed");
    mkdirSync(repository, { recursive: true });
    const agents = path.join(repository, "AGENTS.md");
    writeFileSync(agents, "# Agents\n");
    for (const ticket of ["41", "42", "43"]) {
      await review(`run-d${ticket}`, repository, `https://github.com/acme/shop/issues/${ticket}`, [{ id: "SR-R1-1", category: "dead-code", severity: "P2", summary: `Leftover ${ticket}.`, fixed: false }]);
    }
    const before = readFileSync(agents, "utf8");
    const dismissed = await fixes.dismissFindingFix(repository, "dead-code");
    expect(dismissed).toMatchObject({ outcome: "dismissed", applied: false });
    expect(readFileSync(agents, "utf8")).toBe(before);
    await review("run-d44", repository, "https://github.com/acme/shop/issues/44", [{ id: "SR-R1-1", category: "dead-code", severity: "P2", summary: "Leftover 44.", fixed: false }]);
    const proposals = (JSON.parse(readFileSync(findingFixStore(storage, repository), "utf8")) as { proposals: { status: string }[] }).proposals;
    expect(proposals.map(({ status }) => status)).toEqual(["dismissed"]);
    await findings.forgetReviewFindings(repository);
    expect(existsSync(reviewFindingsStore(storage, repository))).toBe(false);
    expect(existsSync(findingFixStore(storage, repository))).toBe(false);
  });

  it("should stop handing a kind over once its block is on the branch new runs start from", async () => {
    const repository = path.join(storage, "checkouts", "settled");
    mkdirSync(repository, { recursive: true });
    writeFileSync(path.join(repository, "AGENTS.md"), "# Agents\n");
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args], { cwd: repository, stdio: "ignore" });
    git("init", "-q");
    git("add", "AGENTS.md");
    git("commit", "-q", "-m", "init");
    for (const ticket of ["51", "52", "53"]) {
      await review(`run-s${ticket}`, repository, `https://github.com/acme/shop/issues/${ticket}`, entry(`Ticket ${ticket} has no test.`));
    }
    await fixes.acceptFindingFix(repository, "test-gap");
    const before = checkout("run-s-before");
    await expect(findings.seedRecurringFindings(repository, before)).resolves.toBe(1);
    expect(readFileSync(path.join(before, ".claude", "tasks", "recurring-findings.md"), "utf8")).toContain("test-gap");
    git("add", "AGENTS.md");
    git("commit", "-q", "-m", "habit");
    const after = checkout("run-s-after");
    await expect(findings.seedRecurringFindings(repository, after)).resolves.toBe(0);
    expect(existsSync(path.join(after, ".claude", "tasks", "recurring-findings.md"))).toBe(false);
  });
});
