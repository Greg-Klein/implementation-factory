import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { broadcast, clients, now, reconcileInterruptedRuns, send } from "./context.js";
import { hostname, port, dev, pluginRoot, dataRoot, consoleRoot, setListeningPort, hookToken } from "./config.js";
import { readArtifact } from "./artifacts.js";
import { answerQuestion } from "./hooks.js";
import { answerSessionPrompt } from "./session-prompt.js";
import { drainHookSpool, receiveHook } from "./hook-bridge.js";
import { refreshAcceptance } from "./acceptance-runtime.js";
import { allowedHosts, hostAllowed, isLoopbackHost, originAllowed, tokenMatches } from "./access.js";
import { demoState } from "./demo.js";
import { demoSelfImprovementDiff } from "./demo-data.js";
import { listPendingImprovements, notice, readImprovementReport, realignPendingImprovements, saveFeedback } from "./self-improvement.js";
import { detectProjectDirectory, discoverRepositories } from "./repository.js";
import { mergeNeedsRestart } from "./domain.js";
import { branchIsMerged, changedPaths, findWorktree, headCommit, mergeBranch, removeWorktree, worktreeDiff, worktreeIsClean } from "./worktree.js";
import { registry } from "./registry.js";
import { resolvePastedTickets } from "./ticket-source.js";
import { reconcileRunWorktrees } from "./run-worktrees.js";
import { engine } from "./engine/index.js";
import type { ClientMessage } from "./types.js";

async function applySelfImprovementReview(worktreeName: string, merge: boolean) {
  if (worktreeName.startsWith("demo-")) {
    demoState.pendingImprovement = undefined;
    notice("info", merge ? "Améliorations fusionnées (démo)" : "Améliorations ignorées (démo)", worktreeName);
    return;
  }
  const worktree = await findWorktree(worktreeName);
  if (!worktree) throw new Error(`Aucun worktree d'auto-amélioration "${worktreeName}" à traiter.`);
  let harnessMoved = false;
  if (merge) {
    if (!worktree.branch) throw new Error(`Le worktree "${worktreeName}" n'est sur aucune branche.`);
    // The harness may have moved since the branch was cut, by an earlier promotion
    // or by hand. Replaying it here is what keeps the promise the button makes:
    // without it, a merge that conflicts is aborted and handed back to the user.
    await realignPendingImprovements();
    // A worktree is destroyed just below, so nothing may be announced as merged
    // before the checkout actually moved.
    const before = await headCommit(pluginRoot);
    const merged = await mergeBranch(pluginRoot, worktree.branch, `self-improvement: apply improvements from ${worktreeName}`)
      .catch((error) => { throw new Error(`La fusion de ${worktreeName} a échoué et a été annulée, le worktree est conservé : ${error instanceof Error ? error.message.split("\n")[0] : error}`); });
    // Git brings nothing in two cases its exit code cannot tell apart: a branch
    // whose commits the harness already contains, and one that holds no commit at
    // all. The first is work landed by hand, and refusing to clean it up left no
    // honest way out — merging said nothing was merged, discarding recorded as
    // ignored what had in fact been kept. The second may still be an agent
    // mid-write, so the worktree only goes when it has nothing uncommitted either.
    const spent = !merged && await branchIsMerged(pluginRoot, worktree.branch) && await worktreeIsClean(worktree);
    if (!merged && !spent)
      throw new Error(`${worktreeName} n'apporte aucun commit à fusionner. Rien n'a été fusionné, le worktree est conservé.`);
    // Prompts apply to the next run on their own; the console's code only after
    // a restart, which it cannot do itself while sessions may be running under it.
    const restart = merged && mergeNeedsRestart(await changedPaths(pluginRoot, before, "HEAD").catch(() => []));
    if (restart) notice("attention", "Améliorations fusionnées, relance nécessaire", `${worktreeName} modifie la console : lance impl restart pour l'appliquer.`);
    else notice("info", merged ? "Améliorations fusionnées" : "Améliorations déjà présentes", worktreeName);
    harnessMoved = merged;
  } else {
    // Merging already refuses to destroy a worktree with something uncommitted
    // on disk (see worktreeIsClean's own contract): ignoring must refuse the same
    // way, or "Ignorer" becomes the one button that can erase a diagnosis the
    // validation step deliberately left uncommitted after a failed check.
    if (!(await worktreeIsClean(worktree)))
      throw new Error(`${worktreeName} contient des changements non validés : les ignorer les détruirait. Rien n'a été touché.`);
    notice("info", "Améliorations ignorées", worktreeName);
  }
  await removeWorktree(pluginRoot, worktree);
  // The checkout just moved under every branch still waiting, which is exactly what
  // left the previous improvement of a series unmergeable.
  if (harnessMoved) await realignPendingImprovements();
}

/** Read at each request: port zero binds a free port, only known after listening. */
function consoleHosts() {
  const addresses = Object.values(os.networkInterfaces()).flatMap((entries) => entries?.map((entry) => entry.address) ?? []);
  return allowedHosts(port, hostname, addresses);
}

function readBody(request: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => { try { resolve(JSON.parse(body || "{}") as Record<string, unknown>); } catch { reject(new Error("Invalid JSON")); } });
    request.on("error", reject);
  });
}

function respond(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body));
}

async function handleClientMessage(socket: WebSocket, message: ClientMessage) {
  if (message.type === "run.subscribe") {
    const subscription = clients.get(socket);
    if (!subscription) return;
    subscription.runId = message.runId ?? undefined;
    // An archived run is read like a live one, and has no terminal to replay.
    const session = registry.readable(subscription.runId);
    if (!session) return;
    send(socket, { type: "run", state: session.state });
    if (session.terminalBuffer) send(socket, { type: "terminal.output", runId: session.id, data: session.terminalBuffer });
    return;
  }
  if (message.type === "run.start") {
    const outcome = await registry.launch(message);
    // The page clears its terminal and opens whichever run it just created, so
    // it has to be told which one that is, or whether it is only queued.
    if ("started" in outcome) {
      const subscription = clients.get(socket);
      if (subscription) subscription.runId = outcome.started.id;
      send(socket, { type: "run", state: outcome.started.state });
      return;
    }
    send(socket, {
      type: "notice", level: "info", at: now(), queuedId: outcome.queued.id,
      title: "Run mis en file",
      detail: outcome.queued.reason === "ticket"
        ? `Ce ticket est déjà en cours sur ${path.basename(outcome.queued.repository)}. Le run démarrera quand celui qui le tient aura rendu sa session.`
        : outcome.queued.reason === "slot"
          ? `${path.basename(outcome.queued.repository)} démarrera dès qu'une place sera libre.`
          : outcome.queued.reason === "analysis"
            ? `${path.basename(outcome.queued.repository)} : le ticket est comparé à ceux déjà en file ou en cours sur ce dépôt avant de démarrer.`
            : `${path.basename(outcome.queued.repository)} : le ticket attend un autre ticket du même dépôt. La file dit lequel.`,
    });
    return;
  }
  if (message.type === "batch.submit") {
    // The source of the tickets ends here: past this line a batch is a list of resolved tickets.
    const tickets = await resolvePastedTickets(Array.isArray(message.issueUrls) ? message.issueUrls.filter((url) => typeof url === "string") : []);
    const outcome = await registry.enqueueBatch(tickets, { instruction: message.instruction });
    send(socket, { type: "batch.result", batchId: outcome.batchId, accepted: outcome.entries.length, duplicates: outcome.duplicates });
    return;
  }
  if (message.type === "demo.start" && message.scenario === "batch") { registry.startDemoBatch(); return; }
  if (message.type === "demo.start") {
    const session = registry.startDemo(message.scenario === "incident" ? "incident" : "workflow");
    const subscription = clients.get(socket);
    if (subscription) subscription.runId = session.id;
    send(socket, { type: "run", state: session.state });
    return;
  }
  if (message.type === "terminal.input") { registry.get(message.runId)?.engine?.write(message.data); return; }
  if (message.type === "terminal.resize") { registry.get(message.runId)?.engine?.resize(message.cols, message.rows); return; }
  if (message.type === "instruction.send") { registry.sendInstruction(message.runId, message.text); return; }
  if (message.type === "run.stop") { registry.stop(message.runId); return; }
  if (message.type === "run.close") { await registry.close(message.runId); return; }
  if (message.type === "queue.cancel") { registry.cancelQueued(message.queuedId); return; }
  if (message.type === "queue.force") { registry.forceQueued(message.queuedId, message.mode === "stacked" ? "stacked" : "base", typeof message.onto === "string" ? message.onto : undefined); return; }
  if (message.type === "queue.move") { registry.moveQueued(message.queuedId, typeof message.before === "string" ? message.before : null); return; }
  if (message.type === "worktree.remove") {
    const result = await registry.removeWorktree(message.runId, message.force === true);
    send(socket, { type: "worktree.result", runId: message.runId, ...result });
    return;
  }
  if (message.type === "question.answer") {
    const session = registry.get(message.runId);
    if (!session) throw new Error("Ce run n'existe plus.");
    answerQuestion(session, message.answers);
    return;
  }
  if (message.type === "sessionPrompt.answer") {
    const session = registry.get(message.runId);
    if (!session) throw new Error("Ce run n'existe plus.");
    if (message.decision !== "accept" && message.decision !== "refuse") throw new Error("Décision inconnue.");
    answerSessionPrompt(session, message.promptId, message.decision);
    return;
  }
  if (message.type === "feedback.submit") {
    // An archived run is worth learning from too: feedback only writes a file, it never reaches a session.
    const session = registry.readable(message.runId);
    if (!session) throw new Error("Ce run n'existe plus.");
    await saveFeedback(session, message.body);
    return;
  }
  if (message.type === "incident.action") {
    const result = await registry.incidentAction(message);
    send(socket, { type: "incident.result", runId: message.runId, incidentId: message.incidentId, requestId: message.requestId, ...result });
    return;
  }
  if (message.type === "selfImprovement.approve") { await applySelfImprovementReview(message.worktreeName, true); return; }
  if (message.type === "selfImprovement.reject") { await applySelfImprovementReview(message.worktreeName, false); return; }
}

await mkdir(dataRoot, { recursive: true });
await reconcileInterruptedRuns(dataRoot);
// Commits landed by hand while the console was down move the harness just as a
// promotion does, and nothing would replay the waiting branches onto them.
await realignPendingImprovements().catch(() => undefined);
// Worktrees left by the runs of an earlier process: pruned, removed or kept with their reason.
await reconcileRunWorktrees(dataRoot).catch(() => undefined);
await registry.restoreQueue();
// Runs an earlier process left with an open incident or a worktree on disk, read back for consultation.
await registry.archive.load(dataRoot);
const app = next({ dev, hostname, port, dir: consoleRoot });
const handle = app.getRequestHandler();
await app.prepare();

const server = createServer(async (request, response) => {
  // A page on another site that got a name of its own resolved to this address
  // still sends that name: refused before anything is read or run.
  if (!hostAllowed(request.headers.host, consoleHosts())) { respond(response, 403, { error: "Hôte non autorisé." }); return; }
  const requestPath = request.url?.split("?")[0];
  if (request.method === "POST" && requestPath === "/api/hooks") {
    const token = new URL(request.url ?? "", "http://console").searchParams.get("token") ?? request.headers["x-impl-hook-token"]?.toString();
    if (!tokenMatches(token, hookToken)) { respond(response, 401, { ok: false }); return; }
    try {
      const body = await readBody(request);
      const runId = typeof body.runId === "string" ? body.runId : undefined;
      const session = registry.get(runId);
      // A hook from a run the console no longer holds is not an error: the user
      // closed it, or the server restarted under a session still alive.
      if (!session || !runId) { respond(response, 200, { ok: true, hookOutput: null }); return; }
      // What the session could not post earlier happened first.
      await drainHookSpool(session);
      const hookOutput = await receiveHook(session, body);
      respond(response, 200, { ok: true, hookOutput: hookOutput ?? null });
    } catch { respond(response, 400, { ok: false }); }
    return;
  }
  if (request.method === "GET" && request.url === "/api/runs") { respond(response, 200, registry.snapshot()); return; }
  const acceptanceRoute = request.method === "GET" ? requestPath?.match(/^\/api\/runs\/([^/]+)\/acceptance$/) : null;
  if (acceptanceRoute) {
    const session = registry.get(decodeURIComponent(acceptanceRoute[1]));
    if (!session) { respond(response, 404, { error: "Ce run n'existe plus." }); return; }
    // Asking is also a moment to look at the code again (at most every few
    // seconds): evidence goes stale when the code moves, and nothing else
    // would say so while the run is quiet.
    try { respond(response, 200, await refreshAcceptance(session)); }
    catch (error) { respond(response, 500, { error: error instanceof Error ? error.message : "Couverture indisponible." }); }
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/api/runs/")) {
    const session = registry.get(decodeURIComponent(request.url.slice("/api/runs/".length).split("?")[0]));
    if (!session) { respond(response, 404, { error: "Ce run n'existe plus." }); return; }
    respond(response, 200, { state: session.state });
    return;
  }
  // Archived runs have routes of their own: nothing here can reach a live session, a slot or a checkout.
  const archiveAcceptance = request.method === "GET" ? requestPath?.match(/^\/api\/archive\/runs\/([^/]+)\/acceptance$/) : null;
  if (archiveAcceptance) {
    const archived = registry.archive.get(decodeURIComponent(archiveAcceptance[1]));
    if (!archived) { respond(response, 404, { error: "Ce run archivé n'existe pas." }); return; }
    respond(response, 200, archived.acceptanceView ?? archived.evidence.view());
    return;
  }
  const archiveRun = request.method === "GET" ? requestPath?.match(/^\/api\/archive\/runs\/([^/]+)$/) : null;
  if (archiveRun) {
    const archived = registry.archive.get(decodeURIComponent(archiveRun[1]));
    if (!archived) { respond(response, 404, { error: "Ce run archivé n'existe pas." }); return; }
    respond(response, 200, { state: archived.state });
    return;
  }
  if (request.method === "GET" && requestPath === "/api/archive/artifacts") {
    const requestUrl = new URL(request.url ?? "", `http://${hostname}:${port}`);
    const archived = registry.archive.get(requestUrl.searchParams.get("runId") ?? undefined);
    if (!archived) { respond(response, 404, { error: "Ce run archivé n'existe pas." }); return; }
    try { respond(response, 200, await readArtifact(archived, requestUrl.searchParams.get("path") ?? "")); }
    catch (error) { respond(response, 404, { error: error instanceof Error ? error.message : "Document introuvable." }); }
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/api/artifacts")) {
    const requestUrl = new URL(request.url, `http://${hostname}:${port}`);
    const session = registry.get(requestUrl.searchParams.get("runId") ?? undefined);
    if (!session) { respond(response, 404, { error: "Ce run n'existe plus." }); return; }
    try { respond(response, 200, await readArtifact(session, requestUrl.searchParams.get("path") ?? "")); }
    catch (error) { respond(response, 404, { error: error instanceof Error ? error.message : "Document introuvable." }); }
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/api/self-improvement/diff")) {
    const worktreeName = new URL(request.url, `http://${hostname}:${port}`).searchParams.get("worktree") ?? "";
    if (!worktreeName || !/^[a-z0-9-]+$/i.test(worktreeName)) { respond(response, 400, { error: "Nom de worktree invalide." }); return; }
    if (worktreeName.startsWith("demo-")) { respond(response, 200, { diff: demoSelfImprovementDiff }); return; }
    try {
      const worktree = await findWorktree(worktreeName);
      if (!worktree) { respond(response, 404, { error: "Worktree introuvable." }); return; }
      const diff = await worktreeDiff(worktree);
      respond(response, 200, { diff: diff || "(aucune modification détectée)" });
    } catch (error) { respond(response, 500, { error: error instanceof Error ? error.message : "Erreur git." }); }
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/api/self-improvement/report")) {
    const worktreeName = new URL(request.url, `http://${hostname}:${port}`).searchParams.get("worktree") ?? "";
    if (!worktreeName || !/^[a-z0-9-]+$/i.test(worktreeName)) { respond(response, 400, { error: "Nom de worktree invalide." }); return; }
    const report = await readImprovementReport(worktreeName);
    if (report === undefined) { respond(response, 404, { error: "Rapport introuvable." }); return; }
    respond(response, 200, { report });
    return;
  }
  if (request.method === "GET" && request.url === "/api/self-improvement/pending") {
    try { respond(response, 200, { items: await listPendingImprovements() }); }
    catch (error) { respond(response, 500, { items: [], error: error instanceof Error ? error.message : "Erreur git." }); }
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/api/repositories")) {
    const requestUrl = new URL(request.url, `http://${hostname}:${port}`);
    const issueUrl = requestUrl.searchParams.get("issueUrl") ?? "";
    try {
      const repositories = await discoverRepositories();
      const detected = issueUrl ? await detectProjectDirectory(issueUrl, repositories) : undefined;
      respond(response, 200, { repositories, detected: detected ?? null });
    } catch (error) {
      respond(response, 500, { repositories: [], detected: null, error: error instanceof Error ? error.message : "Discovery failed." });
    }
    return;
  }
  await handle(request, response);
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/ws") return;
  // Browsers apply no same-origin policy to a WebSocket, and this one writes
  // into live agent sessions: only a page the console served may open it.
  const hosts = consoleHosts();
  if (!hostAllowed(request.headers.host, hosts) || !originAllowed(request.headers.origin, hosts)) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return;
  }
  wss.handleUpgrade(request, socket, head, (websocket) => wss.emit("connection", websocket, request));
});
wss.on("connection", (socket) => {
  clients.set(socket, {});
  send(socket, { type: "harness", snapshot: registry.snapshot() });
  socket.on("message", async (raw) => {
    let message: ClientMessage | undefined;
    try {
      message = JSON.parse(raw.toString()) as ClientMessage;
      await handleClientMessage(socket, message);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Impossible d'exécuter cette action.";
      // Answered to the page that asked, never written into a run's state: a
      // panel action that fails must not rewrite the status of a run that
      // already ended cleanly, nor be archived as its verdict.
      send(socket, { type: "error", message: text, runId: message && "runId" in message ? message.runId ?? undefined : undefined });
      if (message?.type === "run.start" || message?.type === "demo.start" || message?.type === "batch.submit") broadcast({ type: "notice", level: "attention", title: "Lancement refusé", detail: text, at: now() });
    }
  });
  socket.on("close", () => clients.delete(socket));
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, hostname, () => { server.off("error", reject); resolve(); });
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("Le serveur n'a pas de port TCP.");
setListeningPort(address.port);
const url = `http://${hostname}:${port}`;
console.log(`Implementation Harness: ${url}`);
if (!isLoopbackHost(hostname)) console.warn(`Attention : la console écoute sur ${hostname}, elle est joignable depuis le réseau. Quiconque l'atteint peut piloter les sessions ${engine.label} en cours.`);
// Launches accepted before the last shutdown start now that the server is up.
void registry.drain();
// Hooks a session spooled while nothing else arrived, and runs with nothing
// next, would otherwise wait for an event that may never come.
registry.monitor.start();

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const timeout = setTimeout(() => process.exit(1), 8_000).unref();
  for (const socket of wss.clients) socket.terminate();
  wss.close();
  server.close();
  try { await registry.shutdown(); await app.close(); }
  finally { clearTimeout(timeout); process.exit(0); }
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
