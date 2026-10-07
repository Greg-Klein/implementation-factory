import { expect, type APIRequestContext, type Page } from "@playwright/test";

type HarnessSnapshot = { runs: { id: string; holdsRepository: boolean }[]; queued: { id: string }[] };

/**
 * Hands the console back empty. The harness holds several runs at once and
 * keeps a finished one on screen until it is closed, so a suite that only reset
 * "the" run left the previous test's run in the side list and, worse, holding
 * the checkout the next one wanted.
 */
export async function resetRun(page: Page) {
  await page.goto("/");
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    const timeout = window.setTimeout(() => { socket.close(); reject(new Error("Reset timeout")); }, 8_000);
    const finish = () => { window.clearTimeout(timeout); socket.close(); resolve(); };
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as { type: string; snapshot?: HarnessSnapshot };
      if (message.type !== "harness" || !message.snapshot) return;
      const { runs, queued } = message.snapshot;
      if (runs.length === 0 && queued.length === 0) return finish();
      for (const entry of queued) socket.send(JSON.stringify({ type: "queue.cancel", queuedId: entry.id }));
      for (const run of runs) {
        // A run is never closed from under its agent session: it is stopped first.
        if (run.holdsRepository) socket.send(JSON.stringify({ type: "run.stop", runId: run.id }));
        socket.send(JSON.stringify({ type: "run.close", runId: run.id }));
      }
    });
  }));
  // While the runs were closed one by one, the page opened the last one left on its own: start again from the form.
  await page.goto("/");
}

/**
 * Starts the simulated run through the socket rather than by navigating to
 * /?demo=1, for the tests that have already typed something into the page and
 * would lose it on a reload.
 */
export async function startDemoRun(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    const timeout = window.setTimeout(() => { socket.close(); reject(new Error("demo.start timeout")); }, 4_000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "demo.start" })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as { type: string; snapshot?: HarnessSnapshot };
      if (message.type === "harness" && (message.snapshot?.runs.length ?? 0) > 0) {
        window.clearTimeout(timeout);
        socket.close();
        resolve();
      }
    });
  }));
}

/**
 * The simulated run reaching its end. The event feed used to be the signal here
 * and it is gone from the interface; the tab title stands for the console
 * whichever tab of the run is on screen, which the dialogue does not.
 */
export async function expectDemoCompleted(page: Page) {
  await expect(page).toHaveTitle("✓ Completed · Implementation Harness");
}

export async function runDemoToCompletion(page: Page) {
  await page.goto("/?demo=1");
  await expect(page.getByText("Decision required")).toBeVisible();
  await page.getByRole("button", { name: "develop" }).click();
  await page.getByRole("button", { name: "Keep critical alerts" }).click();
  await page.getByRole("button", { name: "Send to Claude" }).click();
  await expectDemoCompleted(page);
}

type RunSummary = { id: string; status: string };

/** The run the console is holding, for a test that drives a single one. */
export async function currentRun(request: APIRequestContext): Promise<RunSummary> {
  const snapshot = await (await request.get("/api/runs")).json() as { runs: RunSummary[] };
  expect(snapshot.runs.length, "exactly one run expected").toBe(1);
  return snapshot.runs[0]!;
}

/** Its full state, which the list of runs deliberately does not carry. */
export async function currentRunState(request: APIRequestContext) {
  const run = await currentRun(request);
  const body = await (await request.get(`/api/runs/${encodeURIComponent(run.id)}`)).json() as { state: Record<string, unknown> };
  return body.state;
}

export async function artifact(request: APIRequestContext, runId: string, path: string) {
  return request.get(`/api/artifacts?runId=${encodeURIComponent(runId)}&path=${encodeURIComponent(path)}`);
}

/**
 * Launches a real run, with the stand-in `claude` of tests/fake-claude as its
 * session, and returns its identifier once the console holds it.
 */
export async function startRun(page: Page, request: APIRequestContext, cwd: string, issueUrl: string) {
  const before = new Set((await (await request.get("/api/runs")).json() as { runs: RunSummary[] }).runs.map((run) => run.id));
  await page.evaluate(({ cwd: directory, issueUrl: url }) => new Promise<void>((resolve, reject) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    const timeout = window.setTimeout(() => { socket.close(); reject(new Error("run.start timeout")); }, 8_000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "run.start", cwd: directory, issueUrl: url })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as { type: string; message?: string };
      if (message.type === "error") { window.clearTimeout(timeout); socket.close(); reject(new Error(message.message)); }
      if (message.type === "run") { window.clearTimeout(timeout); socket.close(); resolve(); }
    });
  }), { cwd, issueUrl });
  const snapshot = await (await request.get("/api/runs")).json() as { runs: RunSummary[] };
  const started = snapshot.runs.find((run) => !before.has(run.id));
  expect(started, "the started run must appear").toBeDefined();
  return started!.id;
}

/**
 * Where a run works: the worktree the console created for it, inside the
 * checkout it was launched on. The workflow's task directory and the code it
 * edits are there, not in the checkout.
 */
export async function runDirectory(request: APIRequestContext, runId: string) {
  const body = await (await request.get(`/api/runs/${encodeURIComponent(runId)}`)).json() as { state: { cwd: string } };
  return body.state.cwd;
}

/** Sends one message on a socket of its own and resolves with the first answer of the given type. */
export async function sendAndWait<T>(page: Page, message: Record<string, unknown>, answerType: string): Promise<T> {
  return await page.evaluate(({ message: outgoing, answerType: expected }) => new Promise<unknown>((resolve, reject) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    const timeout = window.setTimeout(() => { socket.close(); reject(new Error(`${expected} timeout`)); }, 8_000);
    socket.addEventListener("open", () => socket.send(JSON.stringify(outgoing)));
    socket.addEventListener("message", (event) => {
      const incoming = JSON.parse(event.data) as { type: string };
      if (incoming.type !== expected && incoming.type !== "error") return;
      window.clearTimeout(timeout);
      socket.close();
      resolve(incoming);
    });
  }), { message, answerType }) as T;
}
