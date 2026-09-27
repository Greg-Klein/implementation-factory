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

test("should refuse a request addressed to a foreign name", async ({ request }) => {
  const response = await request.get("/api/runs", { headers: { Host: "evil.example:3211" } });
  expect(response.status()).toBe(403);
});

test("should refuse a hook that does not carry the secret", async ({ request }) => {
  const response = await request.post("/api/hooks", { data: { runId: "anything", payload: { hook_event_name: "Stop" } } });
  expect(response.status()).toBe(401);
});
