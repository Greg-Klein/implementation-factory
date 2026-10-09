import { afterEach, describe, expect, it } from "@jest/globals";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";

import { answerOf, CliError, connect, consoleUrl, getJson, NOT_RUNNING, type Link } from "../../cli/client";

const snapshot = { runs: [], queued: [], maxConcurrentRuns: 3, archived: [], proposals: [] };

type Received = Record<string, unknown> & { ackId: string };

/** A stand-in console: it sends the list of runs, then answers each message the way `answer` says. */
async function standIn(answer: (message: Received, send: (reply: object) => void) => void, accept: (origin: string | undefined) => boolean = () => true) {
  const server = createServer((request, response) => {
    if (request.url === "/api/refused") { response.writeHead(404, { "content-type": "application/json" }); response.end(JSON.stringify({ error: "This run no longer exists." })); return; }
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(snapshot));
  });
  const sockets = new WebSocketServer({ noServer: true });
  const origins: (string | undefined)[] = [];
  server.on("upgrade", (request, socket, head) => {
    origins.push(request.headers.origin);
    if (!accept(request.headers.origin)) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
    sockets.handleUpgrade(request, socket, head, (websocket) => {
      const send = (reply: object) => websocket.send(JSON.stringify(reply));
      send({ type: "factory", snapshot });
      websocket.on("message", (raw) => answer(JSON.parse(raw.toString()) as Received, send));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, origins, server, sockets };
}

let open: { server: Server; sockets: WebSocketServer } | undefined;
let link: Link | undefined;

afterEach(async () => {
  link?.close();
  link = undefined;
  for (const socket of open?.sockets.clients ?? []) socket.terminate();
  await new Promise((resolve) => (open ? open.server.close(resolve) : resolve(undefined)));
  open = undefined;
});

describe("the address the command line reaches the console at", () => {
  it("should be the one the launcher names, without a trailing slash", () => {
    expect(consoleUrl({ IMPL_CONSOLE_URL: "http://127.0.0.1:4000/" })).toBe("http://127.0.0.1:4000");
  });

  it("should fall back on the listening host and port, an empty variable being an absent one", () => {
    expect(consoleUrl({ IMPL_CONSOLE_URL: " ", IMPL_PORT: "3555" })).toBe("http://127.0.0.1:3555");
    expect(consoleUrl({})).toBe("http://127.0.0.1:3210");
  });

  it("should refuse what is not an http address", () => {
    expect(() => consoleUrl({ IMPL_CONSOLE_URL: "console" })).toThrow(CliError);
    expect(() => consoleUrl({ IMPL_CONSOLE_URL: "ftp://127.0.0.1:21" })).toThrow("not an http address");
  });
});

describe("the socket of the command line", () => {
  it("should name the console itself as its origin and open on the first list of runs", async () => {
    const console_ = await standIn(() => undefined);
    open = console_;
    link = await connect(console_.base);
    expect(console_.origins).toEqual([console_.base]);
    expect(link.snapshot()).toEqual(snapshot);
  });

  it("should resolve a request on its acknowledgement, with the answer sent before it", async () => {
    const console_ = await standIn((message, send) => {
      send({ type: "worktree.result", runId: "r", outcome: "removed", message: "Worktree removed." });
      send({ type: "ack", ackId: message.ackId });
    });
    open = console_;
    link = await connect(console_.base);
    const answers = await link.request({ type: "worktree.remove", runId: "r" });
    expect(answerOf(answers, "worktree.result")).toMatchObject({ outcome: "removed" });
  });

  it("should not take the acknowledgement of another request for its own", async () => {
    const waiting: { message: Received; send: (reply: object) => void }[] = [];
    const console_ = await standIn((message, send) => { waiting.push({ message, send }); });
    open = console_;
    link = await connect(console_.base);
    let firstDone = false;
    const firstRequest = link.request({ type: "run.stop", runId: "a" }).then(() => { firstDone = true; });
    const secondRequest = link.request({ type: "run.stop", runId: "b" });
    while (waiting.length < 2) await new Promise((resolve) => setTimeout(resolve, 5));
    waiting[1]!.send({ type: "ack", ackId: waiting[1]!.message.ackId });
    await secondRequest;
    expect(firstDone).toBe(false);
    waiting[0]!.send({ type: "ack", ackId: waiting[0]!.message.ackId });
    await firstRequest;
  });

  it("should reject a request with the sentence of the refusal that names it", async () => {
    const console_ = await standIn((message, send) => send({ type: "error", message: "This run no longer exists.", ackId: message.ackId }));
    open = console_;
    link = await connect(console_.base);
    await expect(link.request({ type: "run.stop", runId: "gone" })).rejects.toThrow("This run no longer exists.");
  });

  it("should reject the requests still waiting when the console closes the socket", async () => {
    const console_ = await standIn(() => { for (const socket of console_.sockets.clients) socket.terminate(); });
    open = console_;
    link = await connect(console_.base);
    await expect(link.request({ type: "run.stop", runId: "r" })).rejects.toThrow("closed the connection");
    await link.closed;
  });

  it("should say the console refused the connection when it does not accept the origin", async () => {
    const console_ = await standIn(() => undefined, () => false);
    open = console_;
    await expect(connect(console_.base)).rejects.toThrow("refused the connection");
  });

  it("should end on the exit code of a stopped console when nothing listens", async () => {
    const console_ = await standIn(() => undefined);
    await new Promise((resolve) => console_.server.close(resolve));
    await expect(connect(console_.base)).rejects.toMatchObject({ exitCode: NOT_RUNNING });
    await expect(getJson(console_.base, "/api/runs")).rejects.toMatchObject({ exitCode: NOT_RUNNING });
  });
});

describe("a reading of the console's routes", () => {
  it("should return the body of an answer and fail on a refusal with the sentence it gives", async () => {
    const console_ = await standIn(() => undefined);
    open = console_;
    expect(await getJson(console_.base, "/api/runs")).toEqual(snapshot);
    await expect(getJson(console_.base, "/api/refused")).rejects.toThrow("This run no longer exists.");
  });
});
