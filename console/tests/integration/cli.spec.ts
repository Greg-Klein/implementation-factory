import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDirectory, sampleCheckout } from "../fixtures";
import { resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

const launcher = path.resolve(process.cwd(), "..", "bin", "implementation-factory");

/** One command of the launcher against the console under test, as a terminal with nobody at it runs it. */
function impl(baseURL: string | undefined, ...args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = execFile("bash", [launcher, ...args], { env: { ...process.env, IMPL_CONSOLE_URL: baseURL ?? "" }, timeout: 40_000 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr });
    });
    child.stdin?.end();
  });
}

type RunView = { id: string; status: string; pendingQuestion?: { questions: { question: string }[] }; activities: { title: string; detail?: string }[] };

test("should drive a run from the terminal: launch it, read it, answer its decision, stop it and close it", async ({ baseURL }) => {
  const started = await impl(baseURL, "run", "--demo");
  expect(started.code).toBe(0);
  const reference = started.stdout.match(/^Run started: (\w+) \(demo-/m)?.[1];
  expect(reference).toBeTruthy();

  const show = async () => JSON.parse((await impl(baseURL, "show", reference!, "--json")).stdout) as RunView;
  await expect.poll(async () => (await show()).pendingQuestion?.questions.length, { timeout: 15_000 }).toBe(2);

  const listed = await impl(baseURL, "runs");
  expect(listed.stdout).toMatch(new RegExp(`^${reference} .*Your turn \\(2 decisions\\)`, "m"));

  // A decision answered in part is refused whole: the run still waits on it.
  const partial = await impl(baseURL, "answer", reference!, "1");
  expect(partial.code).toBe(1);
  expect(partial.stderr).toContain("2 questions, 1 answer was given");
  expect((await show()).pendingQuestion).toBeDefined();

  const answered = await impl(baseURL, "answer", reference!, "2", "Keep the critical ones");
  expect(answered).toMatchObject({ code: 0, stdout: "Answer sent.\n" });
  const afterAnswer = await show();
  expect(afterAnswer.pendingQuestion).toBeUndefined();
  expect(afterAnswer.activities.find((activity) => activity.title === "Answers received")?.detail).toBe("main · Keep the critical ones");

  // The console refuses to close a run that still works, and the command ends on that refusal.
  const refused = await impl(baseURL, "close", reference!);
  expect(refused.code).toBe(1);
  expect(refused.stderr).toContain("Stop it before closing the run");

  expect((await impl(baseURL, "abort", reference!)).code).toBe(0);
  expect((await show()).status).toBe("stopped");
  expect((await impl(baseURL, "close", reference!)).code).toBe(0);
  expect((await impl(baseURL, "runs")).stdout).toContain("No run.");
});

test("should follow a run to its end and end on its outcome", async ({ baseURL }) => {
  const started = await impl(baseURL, "run", "--demo");
  const reference = started.stdout.match(/^Run started: (\w+) /m)?.[1];
  const following = impl(baseURL, "watch", reference!);
  await expect.poll(async () => (JSON.parse((await impl(baseURL, "show", reference!, "--json")).stdout) as RunView).pendingQuestion?.questions.length, { timeout: 15_000 }).toBe(2);
  expect((await impl(baseURL, "answer", reference!, "1", "1")).code).toBe(0);

  const followed = await following;
  expect(followed.code).toBe(0);
  // Nobody is at this terminal: the decision is shown with the command that answers it, not asked.
  expect(followed.stdout).toContain("Decision required");
  expect(followed.stdout).toContain(`answer ${reference}`);
  expect(followed.stdout).toMatch(/--- Step 10\/10: Finish[\s\S]*--- Completed/);
});

test("should read the queue of a batch and remove a launch from it", async ({ baseURL }) => {
  expect((await impl(baseURL, "run", "--demo", "batch")).code).toBe(0);
  const queue = async () => JSON.parse((await impl(baseURL, "queue", "--json")).stdout) as { id: string; reason: string }[];
  await expect.poll(async () => (await queue()).some((entry) => entry.reason === "conflict"), { timeout: 20_000 }).toBe(true);
  const held = (await queue()).find((entry) => entry.reason === "conflict")!;

  const cancelled = await impl(baseURL, "queue", "cancel", held.id);
  expect(cancelled.code).toBe(0);
  expect((await queue()).map((entry) => entry.id)).not.toContain(held.id);

  const again = await impl(baseURL, "queue", "cancel", held.id);
  expect(again.code).toBe(1);
  expect(again.stderr).toContain("No queued launch matches");
});

test("should list a source fix and write it when it is accepted", async ({ baseURL }) => {
  const digest = createHash("sha256").update(path.resolve(sampleCheckout)).digest("hex").slice(0, 10);
  const stored = path.join(dataDirectory, "repositories", `repo-${digest}`, "finding-fixes.json");
  const agents = path.join(sampleCheckout, "AGENTS.md");
  rmSync(agents, { force: true });
  mkdirSync(path.dirname(stored), { recursive: true });
  const body = "<!-- implementation-factory:finding-fix edge-case -->\n\n## Review habit: edge-case\n\nHandle the empty value.\n\n<!-- /implementation-factory:finding-fix edge-case -->\n";
  writeFileSync(stored, JSON.stringify({ version: 1, proposals: [{
    category: "edge-case", label: "A boundary value or an empty case mishandled", runs: 3, findings: 3, kind: "instruction",
    targetFile: "AGENTS.md", title: "Record edge-case in AGENTS.md", body, status: "pending", proposedAt: "2026-10-01T00:00:00.000Z",
    examples: [{ severity: "P1", summary: "Zero was not handled." }],
  }] }));

  const listed = await impl(baseURL, "findings", sampleCheckout);
  expect(listed.code).toBe(0);
  expect(listed.stdout).toContain("Source fixes");
  expect(listed.stdout).toContain("edge-case");

  const accepted = await impl(baseURL, "findings", "accept", "edge-case", sampleCheckout);
  expect(accepted.code).toBe(0);
  expect(accepted.stdout).toContain("AGENTS.md");
  expect(readFileSync(agents, "utf8")).toContain("<!-- implementation-factory:finding-fix edge-case -->");
  rmSync(agents, { force: true });
});
