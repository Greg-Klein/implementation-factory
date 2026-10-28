import { defined } from "../lib/defined.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { broadcast, clients, now, reconcileInterruptedRuns, reportFailure, send } from "./context.js";
import { hostname, port, dev, dataRoot, consoleRoot, setListeningPort, hookToken, givenHostNames, allowedMacs, languageFromShell } from "./config.js";
import { deviceAllowed } from "./device-access.js";
import { readArtifact, readVideo, videoContentType } from "./artifacts.js";
import { acceptFindingFix, dismissFindingFix } from "./finding-fixes.js";
import { forgetReviewFindings, readReviewFindingsSummary } from "./review-findings.js";
import { forgetRuntimeRecipe, readRuntimeRecipe } from "./runtime-recipe.js";
import { answerQuestion, withdrawQuestion } from "./hooks.js";
import { answerSessionPrompt } from "./session-prompt.js";
import { drainHookSpool, receiveHook } from "./hook-bridge.js";
import { refreshAcceptance } from "./acceptance-runtime.js";
import { currentLanguage, currentTexts, setLanguage } from "./language.js";
import { isLanguage } from "../lib/i18n/index.js";
import { allowedHosts, hostAllowed, isLoopbackHost, originAllowed, tokenMatches } from "./access.js";
import { demoSelfImprovementDiff } from "./demo-data.js";
import { applySelfImprovementReview, listPendingImprovements, readImprovementReport, realignPendingImprovements, saveFeedback } from "./self-improvement.js";
import { afterPromotion, autoMergeView, improvementMetrics, recentAutomaticMerges, revertAutomaticMerge, startAutoMerge } from "./auto-merge.js";
import { detectProjectDirectory, discoverRepositories } from "./repository.js";
import { isImprovementWorktreeName, runTakesSlot } from "./domain.js";
import { findWorktree, worktreeDiff } from "./worktree.js";
import { registry } from "./registry.js";
import { resolvePastedTickets } from "./ticket-source.js";
import { reconcileRunWorktrees } from "./run-worktrees.js";
import { confidenceCalibration } from "./run-metrics.js";
import { backfillRunMetrics } from "./run-metrics-runtime.js";
import { engine } from "./engine/index.js";
import type { ClientMessage } from "./types.js";

/** Read at each request: port zero binds a free port, only known after listening. */
function consoleHosts() {
  const addresses = Object.values(os.networkInterfaces()).flatMap((entries) => entries?.map((entry) => entry.address) ?? []);
  return allowedHosts(port, hostname, addresses, givenHostNames);
}

function readBody(request: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => { try { resolve(JSON.parse(body || "{}") as Record<string, unknown>); } catch { reject(new Error(currentTexts().serverRun.invalidJson)); } });
    request.on("error", reject);
  });
}

function respond(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body));
}

/** A video is sent as its bytes for the page's player; every other document as the JSON preview. */
async function respondWithArtifact(response: ServerResponse, session: Parameters<typeof readArtifact>[0], artifactPath: string) {
  try {
    if (!videoContentType(artifactPath)) { respond(response, 200, await readArtifact(session, artifactPath)); return; }
    const video = await readVideo(session, artifactPath);
    response.writeHead(200, { "content-type": video.contentType, "content-length": video.content.byteLength, "cache-control": "no-store" });
    response.end(video.content);
  } catch (error) { respond(response, 404, { error: error instanceof Error ? error.message : currentTexts().serverRun.documentNotFound }); }
}

/** The checkouts chosen per ticket, as a page sent them: anything that is not a list of paths is dropped. */
function targetPaths(targets: unknown): Record<string, string[]> {
  if (!targets || typeof targets !== "object" || Array.isArray(targets)) return {};
  return Object.fromEntries(Object.entries(targets).map(([issueUrl, paths]) => [issueUrl, Array.isArray(paths) ? paths.filter((target): target is string => typeof target === "string" && Boolean(target.trim())) : []]));
}

/**
 * The id a client gave a message it wants acknowledged: `ack` once the message
 * was handled, or the `error` that refuses it. The terminal client exits on it,
 * most messages having no answer of their own.
 */
function ackIdOf(message: unknown): { ackId?: string } {
  const ackId = message && typeof message === "object" ? (message as { ackId?: unknown }).ackId : undefined;
  return typeof ackId === "string" && ackId.length <= 80 ? { ackId } : {};
}

/** The id a page gave its request, sent back with whatever answers it. */
function requestIdOf(message: unknown): { requestId?: string } {
  const requestId = message && typeof message === "object" ? (message as { requestId?: unknown }).requestId : undefined;
  return typeof requestId === "string" && requestId.length <= 80 ? { requestId } : {};
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
      send(socket, { type: "run.started", runId: outcome.started.id, ...requestIdOf(message) });
      send(socket, { type: "run", state: outcome.started.state });
      return;
    }
    send(socket, {
      type: "notice", level: "info", at: now(), queuedId: outcome.queued.id, ...requestIdOf(message),
      title: currentTexts().serverRun.runQueuedTitle,
      detail: outcome.queued.reason === "ticket"
        ? currentTexts().serverRun.runQueuedTicket(path.basename(outcome.queued.repository))
        : outcome.queued.reason === "slot"
          ? currentTexts().serverRun.runQueuedSlot(path.basename(outcome.queued.repository))
          : outcome.queued.reason === "analysis"
            ? currentTexts().serverRun.runQueuedAnalysis(path.basename(outcome.queued.repository))
            : currentTexts().serverRun.runQueuedWaiting(path.basename(outcome.queued.repository)),
    });
    return;
  }
  if (message.type === "batch.submit") {
    // The source of the tickets ends here: past this line a batch is a list of resolved tickets.
    const { resolved, unresolved } = await resolvePastedTickets(Array.isArray(message.issueUrls) ? message.issueUrls.filter((url) => typeof url === "string") : [], targetPaths(message.targets));
    if (unresolved.length > 0) {
      send(socket, { type: "batch.unresolved", tickets: unresolved });
      return;
    }
    const outcome = await registry.enqueueBatch(resolved, defined({ instruction: message.instruction }));
    send(socket, { type: "batch.result", batchId: outcome.batchId, accepted: outcome.entries.length, duplicates: outcome.duplicates });
    return;
  }
  if (message.type === "proposal.dismiss") {
    // Only what is listed right now: a page showing an older list decides nothing about a ticket that left it.
    const issueUrls = registry.proposals.proposed(Array.isArray(message.issueUrls) ? message.issueUrls.filter((url) => typeof url === "string") : []);
    if (issueUrls.length === 0) throw new Error(currentTexts().serverRun.proposalGone);
    await registry.proposals.handle(issueUrls);
    return;
  }
  if (message.type === "proposal.launch") {
    const repositories = Array.isArray(message.repositories) ? message.repositories.filter((target) => typeof target === "string" && target.trim()) : [];
    const outcome = await registry.launchProposal(String(message.issueUrl), repositories);
    // Not a `batch.result`: that one clears the launch form, which this panel is not.
    send(socket, { type: "notice", level: "info", at: now(), title: currentTexts().serverRun.ticketQueuedTitle, detail: outcome.entries.map((entry) => path.basename(entry.repository)).join(", ") });
    return;
  }
  if (message.type === "demo.start" && message.scenario === "batch") { registry.startDemoBatch(); return; }
  if (message.type === "demo.start") {
    const session = registry.startDemo(message.scenario === "incident" ? "incident" : "workflow");
    const subscription = clients.get(socket);
    if (subscription) subscription.runId = session.id;
    send(socket, { type: "run.started", runId: session.id, ...requestIdOf(message) });
    send(socket, { type: "run", state: session.state });
    return;
  }
  if (message.type === "terminal.input") { registry.terminalInput(message.runId, message.data); return; }
  if (message.type === "terminal.resize") { registry.get(message.runId)?.engine?.resize(message.cols, message.rows); return; }
  if (message.type === "instruction.send") { registry.sendInstruction(message.runId, message.text); return; }
  if (message.type === "run.stop") { registry.stop(message.runId); return; }
  if (message.type === "run.close") { await registry.close(message.runId); return; }
  if (message.type === "language.set") {
    if (!isLanguage(message.language)) throw new Error(currentTexts().serverRun.unknownLanguage);
    await setLanguage(message.language);
    registry.publishSnapshot();
    if (languageFromShell) send(socket, { type: "notice", level: "attention", at: now(), title: currentTexts().common.languageChanged, detail: currentTexts().common.languageFromShell });
    return;
  }
  if (message.type === "queue.cancel") { registry.cancelQueued(message.queuedId); return; }
  if (message.type === "queue.force") { registry.forceQueued(message.queuedId, message.mode === "stacked" ? "stacked" : "base", typeof message.onto === "string" ? message.onto : undefined); return; }
  if (message.type === "queue.move") { registry.moveQueued(message.queuedId, typeof message.before === "string" ? message.before : null); return; }
  if (message.type === "worktree.remove") {
    const result = await registry.removeWorktree(message.runId, message.force === true);
    send(socket, { type: "worktree.result", runId: message.runId, ...result });
    return;
  }
  if (message.type === "findings.forget") {
    if (typeof message.repository !== "string" || !path.isAbsolute(message.repository)) throw new Error(currentTexts().serverRun.invalidRepositoryPath);
    send(socket, { type: "findings.result", repository: message.repository, forgotten: await forgetReviewFindings(message.repository) });
    return;
  }
  if (message.type === "findings.accept" || message.type === "findings.dismiss") {
    if (typeof message.repository !== "string" || !path.isAbsolute(message.repository)) throw new Error(currentTexts().serverRun.invalidRepositoryPath);
    if (typeof message.category !== "string" || !/^[a-z-]+$/.test(message.category)) throw new Error(currentTexts().serverRun.invalidFindingCategory);
    const result = message.type === "findings.accept"
      ? await acceptFindingFix(message.repository, message.category)
      : await dismissFindingFix(message.repository, message.category);
    send(socket, { type: "findings.fix", repository: message.repository, ...result });
    return;
  }
  if (message.type === "recipe.forget") {
    if (typeof message.repository !== "string" || !path.isAbsolute(message.repository)) throw new Error(currentTexts().serverRun.invalidRepositoryPath);
    send(socket, { type: "recipe.result", repository: message.repository, forgotten: await forgetRuntimeRecipe(message.repository) });
    return;
  }
  if (message.type === "question.answer") {
    const session = registry.get(message.runId);
    if (!session) throw new Error(currentTexts().serverRun.runGone);
    answerQuestion(session, message.answers);
    return;
  }
  if (message.type === "sessionPrompt.answer") {
    const session = registry.get(message.runId);
    if (!session) throw new Error(currentTexts().serverRun.runGone);
    if (message.decision !== "accept" && message.decision !== "refuse") throw new Error(currentTexts().serverRun.unknownDecision);
    answerSessionPrompt(session, message.promptId, message.decision);
    return;
  }
  if (message.type === "feedback.submit") {
    // An archived run is worth learning from too: feedback only writes a file, it never reaches a session.
    const session = registry.readable(message.runId);
    if (!session) throw new Error(currentTexts().serverRun.runGone);
    await saveFeedback(session, message.body);
    return;
  }
  if (message.type === "incident.action") {
    const result = await registry.incidentAction(message);
    send(socket, { type: "incident.result", runId: message.runId, incidentId: message.incidentId, requestId: message.requestId, ...result });
    return;
  }
  if (message.type === "selfImprovement.approve") { afterPromotion(message.worktreeName, await applySelfImprovementReview(message.worktreeName, true)); return; }
  if (message.type === "selfImprovement.reject") { await applySelfImprovementReview(message.worktreeName, false); return; }
  if (message.type === "selfImprovement.revert") {
    if (!isImprovementWorktreeName(message.worktreeName)) throw new Error(currentTexts().serverRun.invalidWorktreeName);
    await revertAutomaticMerge(message.worktreeName);
    return;
  }
  // Answered, like any refusal: a page from a newer build would otherwise wait on a message nothing read.
  throw new Error(currentTexts().serverRun.unknownMessage(String((message as { type: unknown }).type).slice(0, 60)));
}

await mkdir(dataRoot, { recursive: true });
await reconcileInterruptedRuns(dataRoot);
// Commits landed by hand while the console was down move the factory just as a
// promotion does, and nothing would replay the waiting branches onto them.
await realignPendingImprovements().catch(reportFailure("Pending improvements not realigned"));
// Worktrees left by the runs of an earlier process: pruned, removed or kept with their reason.
await reconcileRunWorktrees(dataRoot).catch(reportFailure("Run worktrees not reconciled"));
await registry.restoreQueue();
// Runs an earlier process left with an open incident or a worktree on disk, read back for consultation.
await registry.archive.load(dataRoot);
// Runs archived before they were measured, or cut short by a restart: figures from what is still on disk.
backfillRunMetrics(dataRoot).catch(reportFailure("Archived runs not measured"));
// Finished improvement branches merged or held without a review, unless the improvement loop is turned off.
startAutoMerge({ isIdle: () => registry.all().every((session) => !runTakesSlot(session.state)) }).catch(reportFailure("Automatic merge not started"));
const app = next({ dev, hostname, port, dir: consoleRoot });
const handle = app.getRequestHandler();
await app.prepare();

/**
 * One request, routed. Whatever it throws is answered by the caller below:
 * left to itself, a request that failed was never answered at all.
 */
async function route(request: IncomingMessage, response: ServerResponse) {
  // A page on another site that got a name of its own resolved to this address
  // still sends that name: refused before anything is read or run.
  if (!hostAllowed(request.headers.host, consoleHosts())) { respond(response, 403, { error: currentTexts().serverRun.hostNotAllowed }); return; }
  if (!await deviceAllowed(request.socket.remoteAddress)) { respond(response, 403, { error: currentTexts().serverRun.deviceNotAllowed }); return; }
  const requestPath = request.url?.split("?")[0];
  if (request.method === "POST" && requestPath === "/api/hooks") {
    const token = new URL(request.url ?? "", "http://console").searchParams.get("token") ?? request.headers["x-impl-hook-token"]?.toString();
    if (!tokenMatches(token, hookToken)) { respond(response, 401, { ok: false }); return; }
    let body: Record<string, unknown>;
    try { body = await readBody(request); }
    catch { respond(response, 400, { ok: false }); return; }
    const runId = typeof body.runId === "string" ? body.runId : undefined;
    try {
      const session = registry.get(runId);
      // A hook from a run the console no longer holds is not an error: the user
      // closed it, or the server restarted under a session still alive.
      if (!session || !runId) { respond(response, 200, { ok: true, hookOutput: null }); return; }
      // A question holds this request open until the user answers. If the request
      // closes first, the question it opened is the one nobody waits on any more.
      // Listened to from here, since it may close while the spool is replayed,
      // and judged only once this hook was applied: the question is its own then.
      let closed = false;
      let asked: { before: string | undefined } | undefined;
      const withdraw = () => {
        const pending = session.state.pendingQuestion?.id;
        if (closed && asked && !response.writableEnded && pending && pending !== asked.before) withdrawQuestion(session, pending);
      };
      response.on("close", () => { closed = true; withdraw(); });
      // What the session could not post earlier happened first.
      await drainHookSpool(session);
      asked = { before: session.state.pendingQuestion?.id };
      const applied = receiveHook(session, body);
      withdraw();
      const hookOutput = await applied;
      respond(response, 200, { ok: true, hookOutput: hookOutput ?? null });
    } catch (error) {
      // The console failed, not the hook: answered as such, so the session
      // retries then spools the event instead of taking it for a refusal.
      reportFailure("Hook not applied", runId)(error);
      respond(response, 500, { ok: false });
    }
    return;
  }
  if (request.method === "GET" && requestPath === "/api/metrics") {
    try {
      const runs = await registry.metrics();
      respond(response, 200, { runs, calibration: confidenceCalibration(runs), ...defined({ improvements: improvementMetrics() }) });
    } catch (error) { respond(response, 500, { runs: [], error: error instanceof Error ? error.message : currentTexts().serverRun.metricsUnavailable }); }
    return;
  }
  if (request.method === "GET" && requestPath === "/api/repositories/recipe") {
    const repository = new URL(request.url ?? "", `http://${hostname}:${port}`).searchParams.get("repository") ?? "";
    if (!path.isAbsolute(repository)) { respond(response, 400, { error: currentTexts().serverRun.invalidRepositoryPath }); return; }
    // The store is named after a digest of the path, so whatever is asked only ever reads a recipe the console wrote.
    respond(response, 200, { repository, recipe: await readRuntimeRecipe(repository) ?? null });
    return;
  }
  if (request.method === "GET" && requestPath === "/api/repositories/findings") {
    const repository = new URL(request.url ?? "", `http://${hostname}:${port}`).searchParams.get("repository") ?? "";
    if (!path.isAbsolute(repository)) { respond(response, 400, { error: currentTexts().serverRun.invalidRepositoryPath }); return; }
    respond(response, 200, { repository, findings: await readReviewFindingsSummary(repository, currentLanguage()) });
    return;
  }
  if (request.method === "GET" && request.url === "/api/runs") { respond(response, 200, registry.snapshot()); return; }
  const acceptanceRoute = request.method === "GET" ? requestPath?.match(/^\/api\/runs\/([^/]+)\/acceptance$/)?.[1] : undefined;
  if (acceptanceRoute) {
    const session = registry.get(decodeURIComponent(acceptanceRoute));
    if (!session) { respond(response, 404, { error: currentTexts().serverRun.runGone }); return; }
    // Asking is also a moment to look at the code again (at most every few
    // seconds): evidence goes stale when the code moves, and nothing else
    // would say so while the run is quiet.
    try {
      const view = await refreshAcceptance(session);
      const language = currentLanguage();
      respond(response, 200, language === "en" ? view : session.evidence.view(language));
    }
    catch (error) { respond(response, 500, { error: error instanceof Error ? error.message : currentTexts().serverRun.coverageUnavailable }); }
    return;
  }
  if (request.method === "GET" && requestPath?.startsWith("/api/runs/")) {
    const session = registry.get(decodeURIComponent(requestPath.slice("/api/runs/".length)));
    if (!session) { respond(response, 404, { error: currentTexts().serverRun.runGone }); return; }
    respond(response, 200, { state: session.state });
    return;
  }
  // Archived runs have routes of their own: nothing here can reach a live session, a slot or a checkout.
  const archiveAcceptance = request.method === "GET" ? requestPath?.match(/^\/api\/archive\/runs\/([^/]+)\/acceptance$/)?.[1] : undefined;
  if (archiveAcceptance) {
    const archived = registry.archive.get(decodeURIComponent(archiveAcceptance));
    if (!archived) { respond(response, 404, { error: currentTexts().serverRun.archivedRunGone }); return; }
    const language = currentLanguage();
    respond(response, 200, language === "en" ? archived.acceptanceView ?? archived.evidence.view() : archived.evidence.view(language));
    return;
  }
  const archiveRun = request.method === "GET" ? requestPath?.match(/^\/api\/archive\/runs\/([^/]+)$/)?.[1] : undefined;
  if (archiveRun) {
    const archived = registry.archive.get(decodeURIComponent(archiveRun));
    if (!archived) { respond(response, 404, { error: currentTexts().serverRun.archivedRunGone }); return; }
    respond(response, 200, { state: archived.state });
    return;
  }
  if (request.method === "GET" && requestPath === "/api/archive/artifacts") {
    const requestUrl = new URL(request.url ?? "", `http://${hostname}:${port}`);
    const archived = registry.archive.get(requestUrl.searchParams.get("runId") ?? undefined);
    if (!archived) { respond(response, 404, { error: currentTexts().serverRun.archivedRunGone }); return; }
    await respondWithArtifact(response, archived, requestUrl.searchParams.get("path") ?? "");
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/api/artifacts")) {
    const requestUrl = new URL(request.url, `http://${hostname}:${port}`);
    const session = registry.get(requestUrl.searchParams.get("runId") ?? undefined);
    if (!session) { respond(response, 404, { error: currentTexts().serverRun.runGone }); return; }
    await respondWithArtifact(response, session, requestUrl.searchParams.get("path") ?? "");
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/api/self-improvement/diff")) {
    const worktreeName = new URL(request.url, `http://${hostname}:${port}`).searchParams.get("worktree") ?? "";
    if (!isImprovementWorktreeName(worktreeName)) { respond(response, 400, { error: currentTexts().serverRun.invalidWorktreeName }); return; }
    if (worktreeName.startsWith("demo-")) { respond(response, 200, { diff: demoSelfImprovementDiff }); return; }
    try {
      const worktree = await findWorktree(worktreeName);
      if (!worktree) { respond(response, 404, { error: currentTexts().serverRun.worktreeNotFound }); return; }
      const diff = await worktreeDiff(worktree);
      respond(response, 200, { diff: diff || currentTexts().serverRun.noChange });
    } catch (error) { respond(response, 500, { error: error instanceof Error ? error.message : currentTexts().serverRun.gitError }); }
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/api/self-improvement/report")) {
    const worktreeName = new URL(request.url, `http://${hostname}:${port}`).searchParams.get("worktree") ?? "";
    if (!isImprovementWorktreeName(worktreeName)) { respond(response, 400, { error: currentTexts().serverRun.invalidWorktreeName }); return; }
    const report = await readImprovementReport(worktreeName);
    if (report === undefined) { respond(response, 404, { error: currentTexts().serverRun.reportNotFound }); return; }
    respond(response, 200, { report });
    return;
  }
  if (request.method === "GET" && request.url === "/api/self-improvement/pending") {
    try {
      const items = (await listPendingImprovements()).map((item) => {
        const autoMerge = autoMergeView(item.worktreeName);
        return autoMerge ? { ...item, autoMerge } : item;
      });
      respond(response, 200, { items, merged: recentAutomaticMerges() });
    }
    catch (error) { respond(response, 500, { items: [], error: error instanceof Error ? error.message : currentTexts().serverRun.gitError }); }
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/api/repositories")) {
    const requestUrl = new URL(request.url, `http://${hostname}:${port}`);
    const issueUrl = requestUrl.searchParams.get("issueUrl") ?? "";
    try {
      const fresh = requestUrl.searchParams.has("fresh");
      let repositories = await discoverRepositories({ fresh });
      let detected = issueUrl ? await detectProjectDirectory(issueUrl, repositories) : undefined;
      // The page is about to ask where the merge requests go: a checkout cloned a moment ago must be in the list it picks from.
      if (issueUrl && !detected && !fresh) {
        repositories = await discoverRepositories({ fresh: true });
        detected = await detectProjectDirectory(issueUrl, repositories);
      }
      respond(response, 200, { repositories, detected: detected ?? null });
    } catch (error) {
      respond(response, 500, { repositories: [], detected: null, error: error instanceof Error ? error.message : currentTexts().serverRun.discoveryFailed });
    }
    return;
  }
  await handle(request, response);
}

const server = createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    // An address that does not decode is the caller's mistake, anything else is the console's.
    const malformed = error instanceof URIError;
    if (!malformed) reportFailure("Request failed", `${request.method} ${request.url?.split("?")[0]}`)(error);
    if (response.headersSent) response.end();
    else respond(response, malformed ? 400 : 500, { error: malformed ? currentTexts().serverRun.malformedAddress : currentTexts().serverRun.internalError });
  });
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
  void deviceAllowed(request.socket.remoteAddress).then((allowed) => {
    if (!allowed) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
    wss.handleUpgrade(request, socket, head, (websocket) => wss.emit("connection", websocket, request));
  });
});
wss.on("connection", (socket) => {
  clients.set(socket, {});
  send(socket, { type: "factory", snapshot: registry.snapshot() });
  socket.on("message", async (raw) => {
    let message: ClientMessage | undefined;
    try {
      const parsed = JSON.parse(raw.toString()) as unknown;
      // Anything that is not a message with a type is refused here, with an answer, instead of being matched against every branch.
      if (!parsed || typeof parsed !== "object" || typeof (parsed as { type?: unknown }).type !== "string") throw new Error(currentTexts().serverRun.unreadableMessage);
      message = parsed as ClientMessage;
      await handleClientMessage(socket, message);
      const { ackId } = ackIdOf(message);
      if (ackId) send(socket, { type: "ack", ackId });
    } catch (error) {
      const text = error instanceof Error ? error.message : currentTexts().serverRun.actionFailed;
      // Answered to the page that asked, never written into a run's state: a
      // panel action that fails must not rewrite the status of a run that
      // already ended cleanly, nor be archived as its verdict.
      send(socket, { type: "error", message: text, ...defined({ runId: message && "runId" in message ? message.runId ?? undefined : undefined }), ...requestIdOf(message), ...ackIdOf(message) });
      if (message?.type === "run.start" || message?.type === "demo.start" || message?.type === "batch.submit" || message?.type === "proposal.launch") broadcast({ type: "notice", level: "attention", title: currentTexts().serverRun.launchRefused, detail: text, at: now() });
    }
  });
  socket.on("close", () => clients.delete(socket));
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, hostname, () => { server.off("error", reject); resolve(); });
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("The server has no TCP port.");
setListeningPort(address.port);
const url = `http://${hostname}:${port}`;
console.log(`Implementation Factory: ${url}`);
if (!isLoopbackHost(hostname)) console.warn(`Warning: the console is listening on ${hostname}, it is reachable from the network. ${allowedMacs.size > 0 ? "Any device listed in IMPL_ALLOWED_MACS, or passing for one," : "Anyone who reaches it"} can drive the ${engine.label} sessions in progress.`);
// A rejection nothing handles is a defect: it is logged with what it says and
// shown once, instead of resting on whatever handler a dependency happens to install.
process.on("unhandledRejection", (reason) => reportFailure("Unhandled failure in the console")(reason));
// Same for an exception nothing caught: the sessions in progress are worth more than a clean stop,
// so the console says it and stays up, by its own decision and not by a dependency's.
process.on("uncaughtException", (error) => reportFailure("Unhandled exception in the console")(error));
// Launches accepted before the last shutdown start now that the server is up.
registry.drain().catch(reportFailure("Queue not drained"));
// Hooks a session spooled while nothing else arrived, and runs with nothing
// next, would otherwise wait for an event that may never come.
registry.monitor.start();
// Tickets a watcher found while the console was down are queued as soon as it is up.
registry.proposals.start().catch(reportFailure("Ticket proposals not started"));

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
process.on("SIGINT", () => { shutdown().catch(reportFailure("Shutdown failed")); });
process.on("SIGTERM", () => { shutdown().catch(reportFailure("Shutdown failed")); });
