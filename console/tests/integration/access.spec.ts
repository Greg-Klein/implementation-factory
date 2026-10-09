import { expect, test } from "@playwright/test";
import WebSocket from "ws";

const socketUrl = "ws://127.0.0.1:3211/ws";

/** The status the server answered the upgrade with, or "open" when it let the socket through. */
function upgrade(headers: Record<string, string>) {
  return new Promise<number | "open">((resolve) => {
    const socket = new WebSocket(socketUrl, { headers });
    socket.on("open", () => { socket.close(); resolve("open"); });
    socket.on("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
    socket.on("error", () => resolve(0));
  });
}

test("should refuse a socket opened by a page the console did not serve", async () => {
  expect(await upgrade({ Origin: "https://evil.example" })).toBe(403);
  expect(await upgrade({})).toBe(403);
  expect(await upgrade({ Origin: "http://127.0.0.1:3211" })).toBe("open");
});

test("should refuse a socket addressed to a foreign name, whatever origin it claims", async () => {
  expect(await upgrade({ Host: "evil.example:3211", Origin: "http://127.0.0.1:3211" })).toBe(403);
  expect(await upgrade({ Host: "evil.example:3211", Origin: "http://evil.example:3211" })).toBe(403);
});

/** What the server answers a raw message with, on a socket it accepted. */
function answerTo(raw: string) {
  return new Promise<{ type: string; message?: string }>((resolve, reject) => {
    const socket = new WebSocket(socketUrl, { headers: { Origin: "http://127.0.0.1:3211" } });
    socket.on("open", () => socket.send(raw));
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as { type: string; message?: string };
      // The list of runs is sent to every page that connects: the answer is what follows it.
      if (message.type === "factory") return;
      socket.close();
      resolve(message);
    });
    socket.on("error", reject);
  });
}

test("should answer a message it cannot read or does not know, instead of dropping it", async () => {
  expect(await answerTo("{not json")).toMatchObject({ type: "error" });
  expect(await answerTo("null")).toEqual({ type: "error", message: "Unreadable message." });
  expect(await answerTo(JSON.stringify({ type: "run.destroy", runId: "x" }))).toEqual({ type: "error", message: "Unknown message type: run.destroy.", runId: "x" });
});

test("should answer a malformed address, and still serve the next request", async ({ request }) => {
  expect((await request.get("/api/runs/%")).status()).toBe(400);
  expect((await request.get("/api/archive/runs/%E0%A4%A")).status()).toBe(400);
  expect((await request.get("/api/runs")).status()).toBe(200);
});

test("should serve nothing of an archived run it does not hold", async ({ request }) => {
  expect((await request.get("/api/archive/runs/unknown-run")).status()).toBe(404);
  expect((await request.get("/api/archive/runs/unknown-run/acceptance")).status()).toBe(404);
  expect((await request.get("/api/archive/artifacts?runId=unknown-run&path=..%2Frun.json")).status()).toBe(404);
});

test("should refuse a request addressed to a foreign name", async ({ request }) => {
  const response = await request.get("/api/runs", { headers: { Host: "evil.example:3211" } });
  expect(response.status()).toBe(403);
});

test("should refuse a hook that does not carry the secret", async ({ request }) => {
  const response = await request.post("/api/hooks", { data: { runId: "anything", payload: { hook_event_name: "Stop" } } });
  expect(response.status()).toBe(401);
  const wrong = await request.post("/api/hooks?token=not-the-secret", { data: { runId: "anything", payload: { hook_event_name: "Stop" } } });
  expect(wrong.status()).toBe(401);
});
