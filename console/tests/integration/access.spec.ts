import { controlToken } from "../fixtures";
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
  expect(await upgrade({ Origin: "http://127.0.0.1:3211" })).toBe(401);
  expect(await upgrade({ Origin: "http://127.0.0.1:3211", Authorization: `Bearer ${controlToken}` })).toBe("open");
});

test("should refuse a socket addressed to a foreign name, whatever origin it claims", async () => {
  expect(await upgrade({ Host: "evil.example:3211", Origin: "http://127.0.0.1:3211" })).toBe(403);
  expect(await upgrade({ Host: "evil.example:3211", Origin: "http://evil.example:3211" })).toBe(403);
});

/** What the server answers a raw message with, on a socket it accepted. */
function answerTo(raw: string) {
  return new Promise<{ type: string; message?: string }>((resolve, reject) => {
    const socket = new WebSocket(socketUrl, { headers: { Origin: "http://127.0.0.1:3211", Authorization: `Bearer ${controlToken}` } });
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

test("should associate the browser without leaving the token in its URL", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:3211/#access=${controlToken}`);
    await expect(page.getByRole("heading", { name: "Connect to Implementation Factory" })).not.toBeVisible();
    await expect.poll(() => page.url().includes("access=")).toBe(false);
    const cookies = await context.cookies();
    expect(cookies.find((cookie) => cookie.name === "impl_session")).toMatchObject({ httpOnly: true, sameSite: "Strict" });
    expect((await context.request.get("http://127.0.0.1:3211/api/runs")).status()).toBe(200);
  } finally { await context.close(); }
});

test("should deny anonymous and forged-cookie API reads", async ({ playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3211", storageState: { cookies: [], origins: [] } });
  try {
    expect((await anonymous.get("/api/runs")).status()).toBe(401);
    expect((await anonymous.get("/api/runs", { headers: { Cookie: "impl_session=forged" } })).status()).toBe(401);
    expect((await anonymous.post("/api/auth/session", { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);
    expect((await anonymous.get("/api/health")).status()).toBe(200);
  } finally { await anonymous.dispose(); }
});

test("should refuse an oversized hook body and keep serving", async ({ request }) => {
  const { hookToken } = await import("../fixtures");
  expect((await request.post(`/api/hooks?token=${hookToken}`, { data: { padding: "x".repeat(2_000_001) } })).status()).toBe(413);
  expect((await request.get("/api/runs")).status()).toBe(200);
});

test("should reject oversized terminal input and invalid dimensions without closing another client", async () => {
  expect(await answerTo(JSON.stringify({ type: "terminal.input", runId: "absent", data: "x".repeat(8193) }))).toMatchObject({ type: "error", message: "Invalid or oversized data." });
  expect(await answerTo(JSON.stringify({ type: "terminal.resize", runId: "absent", cols: -1, rows: 24 }))).toMatchObject({ type: "error" });
  expect(await upgrade({ Origin: "http://127.0.0.1:3211", Authorization: `Bearer ${controlToken}` })).toBe("open");
});
