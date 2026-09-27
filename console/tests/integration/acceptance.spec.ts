import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createGitCheckout, dataDirectory } from "../fixtures";
import { artifact, resetRun, runDemoToCompletion, startRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

type Coverage = {
  available: boolean;
  sentence: string;
  criteria: { id: string; status: string; checks: { id: string; status: string; evidence: { id?: string; freshness: string }[]; history: { id?: string }[] }[] }[];
};

const snapshotScript = path.resolve("..", "hooks", "code-snapshot.mjs");
const taskDirectory = (cwd: string) => path.join(cwd, ".claude", "tasks");

/** Written the way the workflow is told to: whole, then renamed into place. */
function writeTask(cwd: string, name: string, content: string | object) {
  const target = path.join(taskDirectory(cwd), name);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(`${target}.tmp`, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  renameSync(`${target}.tmp`, target);
}

/** What the session would run: the shared utility, logging where the console reads it. */
function takeSnapshot(cwd: string, runId: string) {
  const output = execFileSync(process.execPath, [snapshotScript], {
    cwd, encoding: "utf8",
    env: { ...process.env, IMPL_SNAPSHOT_EXCLUDE: ".claude/tasks", IMPL_SNAPSHOT_LOG: path.join(dataDirectory, "runs", runId, "snapshots.jsonl") },
  });
  return (JSON.parse(output) as { id: string }).id;
}

async function coverage(request: APIRequestContext, runId: string) {
  return await (await request.get(`/api/runs/${encodeURIComponent(runId)}/acceptance`)).json() as Coverage;
}

function statusOf(view: Coverage, id: string) {
  return view.criteria.find((criterion) => criterion.id === id)?.status;
}

async function openEvidence(page: Page) {
  await page.getByRole("button", { name: /^Ouvrir le run/ }).first().click();
  await page.getByRole("tab", { name: "Preuves" }).click();
}

const registry = {
  schemaVersion: 1, revision: 1,
  criteria: [
    { id: "AC1", text: "Le filtre garde sa valeur au retour sur la page.", source: { kind: "ticket", excerpt: "Conserver le filtre" } },
    { id: "AC2", text: "L’erreur du serveur est affichée.", source: { kind: "ticket" } },
  ],
};

test("should follow a real run from a failed round to a replaced one, and keep both captures", async ({ page, request }) => {
  const checkout = createGitCheckout("evidence-rounds");
  await page.goto("/");
  const runId = await startRun(page, request, checkout.directory, checkout.issueUrl);
  const snapshot = takeSnapshot(checkout.directory, runId);

  writeTask(checkout.directory, "acceptance-criteria.json", registry);
  writeTask(checkout.directory, "planner-output.json", { criteria_revision: 1, tasks: [{ id: "T1", title: "Conserver le filtre", criterion_ids: ["AC1"] }, { id: "T2", title: "Afficher l’erreur", criterion_ids: ["AC2"] }] });
  writeTask(checkout.directory, "assets/result.png", "round-1");
  writeTask(checkout.directory, "qa-evidence.json", {
    schemaVersion: 2, source: "qa", round: 1, criteriaRevision: 1, codeSnapshot: { atStart: snapshot, atEnd: snapshot },
    items: [
      { id: "QA-R1-1", label: "Filtre après retour", verdict: "fail", criterionIds: ["AC1"], actual: "filtre vidé", screenshot: "assets/result.png" },
      { id: "QA-R1-2", label: "Erreur serveur", verdict: "unverified", criterionIds: ["AC2"], blocker: { reason: "Environnement de test inaccessible.", action: "Fournir un compte de recette." } },
    ],
  });

  await expect.poll(async () => { const view = await coverage(request, runId); return [statusOf(view, "AC1"), statusOf(view, "AC2")]; }).toEqual(["failed", "blocked"]);
  await openEvidence(page);
  await expect(page.getByTestId("acceptance-sentence")).toHaveText("0 critère vérifié sur 2 · 1 échec · 1 bloqué");

  // Round two rewrites the same report and the same capture name.
  writeTask(checkout.directory, "assets/result.png", "round-2");
  writeTask(checkout.directory, "qa-evidence.json", {
    schemaVersion: 2, source: "qa", round: 2, criteriaRevision: 1, codeSnapshot: { atStart: snapshot, atEnd: snapshot },
    items: [
      { id: "QA-R2-1", label: "Filtre après retour", verdict: "pass", criterionIds: ["AC1"], actual: "filtre conservé", screenshot: "assets/result.png", supersedes: ["QA-R1-1"] },
      { id: "QA-R2-2", label: "Erreur serveur", verdict: "unverified", criterionIds: ["AC2"], supersedes: ["QA-R1-2"], blocker: { reason: "Environnement de test toujours inaccessible." } },
    ],
  });

  await expect(page.getByTestId("acceptance-sentence")).toHaveText("1 critère vérifié sur 2 · 1 bloqué");
  const view = await coverage(request, runId);
  expect(view.criteria[0].checks[0].history.map((entry) => entry.id)).toEqual(["QA-R1-1"]);
  const capture = async (version: number) => Buffer.from((await (await artifact(request, runId, `evidence/qa-evidence.json/v${version}/assets/result.png`)).json() as { content: string }).content, "base64").toString();
  expect(await capture(1)).toBe("round-1");
  expect(await capture(2)).toBe("round-2");

  await page.getByTestId("criterion-AC1").getByRole("button").first().click();
  await page.getByTestId("criterion-AC1").getByText("Historique (1)").click();
  await expect(page.getByTestId("criterion-AC1").getByText("remplacée par QA-R2-1")).toBeVisible();

  // The summary the workflow reads before the merge request says the same thing.
  await expect.poll(() => existsSync(path.join(taskDirectory(checkout.directory), "acceptance-summary.md"))).toBe(true);
  expect(readFileSync(path.join(taskDirectory(checkout.directory), "acceptance-summary.md"), "utf8")).toContain("1 critère vérifié sur 2 · 1 bloqué");

  // The code moves after the measurement: the evidence is now stale.
  writeFileSync(path.join(checkout.directory, "app.ts"), "export const answer = 43;\n");
  writeTask(checkout.directory, "qa-evidence-round2.json", readFileSync(path.join(taskDirectory(checkout.directory), "qa-evidence.json"), "utf8"));
  await expect.poll(async () => statusOf(await coverage(request, runId), "AC1")).toBe("unverified");
  expect((await coverage(request, runId)).criteria[0].checks[0].evidence[0].freshness).toBe("stale");

  // Before cleaning up, the workflow asks for a confirmed archive, then deletes its directory.
  writeTask(checkout.directory, "archive-sync-request.json", { requestId: "sync-e2e" });
  const acknowledgement = path.join(taskDirectory(checkout.directory), "archive-sync-ack.json");
  await expect.poll(() => existsSync(acknowledgement) && readFileSync(acknowledgement, "utf8").includes("sync-e2e")).toBe(true);
  rmSync(taskDirectory(checkout.directory), { recursive: true, force: true });
  const afterCleanup = await coverage(request, runId);
  expect(afterCleanup.criteria.map((criterion) => criterion.id)).toEqual(["AC1", "AC2"]);
  expect(await capture(1)).toBe("round-1");
});

test("should keep the criteria and evidence of two runs apart", async ({ page, request }) => {
  const first = createGitCheckout("evidence-first");
  const second = createGitCheckout("evidence-second");
  await page.goto("/");
  const firstRun = await startRun(page, request, first.directory, first.issueUrl);
  const secondRun = await startRun(page, request, second.directory, second.issueUrl);

  writeTask(first.directory, "acceptance-criteria.json", { schemaVersion: 1, criteria: [{ id: "AC1", text: "Premier ticket" }] });
  writeTask(second.directory, "acceptance-criteria.json", { schemaVersion: 1, criteria: [{ id: "AC1", text: "Second ticket" }, { id: "AC2", text: "Second ticket, bis" }] });
  writeTask(first.directory, "qa-evidence.json", { schemaVersion: 2, source: "qa", items: [{ id: "QA-R1-1", label: "Premier", verdict: "fail", criterionIds: ["AC1"] }] });

  await expect.poll(async () => (await coverage(request, firstRun)).criteria.map((criterion) => [criterion.id, criterion.status])).toEqual([["AC1", "failed"]]);
  await expect.poll(async () => (await coverage(request, secondRun)).criteria.map((criterion) => [criterion.id, criterion.status])).toEqual([["AC1", "unverified"], ["AC2", "unverified"]]);
});

test("should keep an older run without a criteria registry readable", async ({ page, request }) => {
  const checkout = createGitCheckout("evidence-legacy");
  await page.goto("/");
  const runId = await startRun(page, request, checkout.directory, checkout.issueUrl);
  writeTask(checkout.directory, "qa-evidence.json", { source: "qa", status: "PASS", items: [{ label: "Lint", verdict: "pass", command: "npm run lint", actual: "0 avertissement" }] });
  await expect.poll(async () => ((await (await request.get(`/api/runs/${runId}`)).json()) as { state: { artifacts: string[] } }).state.artifacts).toContain("qa-evidence.json");

  await page.evaluate((id) => new Promise<void>((resolve) => {
    const socket = new WebSocket(`ws://${window.location.host}/ws`);
    socket.addEventListener("open", () => { socket.send(JSON.stringify({ type: "run.stop", runId: id })); window.setTimeout(() => { socket.close(); resolve(); }, 300); });
  }), runId);

  await openEvidence(page);
  await expect(page.getByText("Traçabilité par critère indisponible pour ce run.")).toBeVisible();
  await expect(page.getByRole("list").getByText("Lint", { exact: true }).first()).toBeVisible();
  expect((await coverage(request, runId)).available).toBe(false);
});

test("should show the demo's criteria in every state, with the replaced round in history", async ({ page }) => {
  await runDemoToCompletion(page);
  await page.getByRole("tab", { name: "Preuves" }).click();

  await expect(page.getByTestId("acceptance-sentence")).toHaveText("2 critères vérifiés sur 5 · 1 échec · 1 bloqué · 1 non vérifié");
  for (const [id, label] of [["AC1", "Vérifié"], ["AC2", "Vérifié"], ["AC3", "Non vérifié"], ["AC4", "Échec"], ["AC5", "Bloqué"]]) {
    await expect(page.getByTestId(`criterion-${id}`).getByRole("button").first()).toContainText(label);
  }

  const replaced = page.getByTestId("criterion-AC2");
  await replaced.getByRole("button").first().click();
  await replaced.getByText("Historique (1)").click();
  await expect(replaced.getByText("remplacée par QA-R2-4")).toBeVisible();
  await replaced.getByRole("button", { name: "Agrandir la capture assets/alerte-critique.png" }).last().click();
  await expect(page.getByRole("dialog", { name: "assets/alerte-critique.png" })).toBeVisible();
  await page.keyboard.press("Escape");

  const stale = page.getByTestId("criterion-AC3");
  await stale.getByRole("button").first().click();
  await expect(stale.getByText("Preuve ancienne").first()).toBeVisible();
  await expect(stale.getByText("Résultat rapporté").first()).toBeVisible();
});
