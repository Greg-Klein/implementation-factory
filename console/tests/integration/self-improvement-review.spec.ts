import { expect, test } from "@playwright/test";
import { resetRun } from "./helpers";

test.beforeEach(async ({ page }) => resetRun(page));

test("should reject invalid worktree names in the diff endpoint", async ({ request }) => {
  for (const name of ["../secret", "foo/bar", "foo bar", "; rm -rf", ""]) {
    const response = await request.get(`/api/self-improvement/diff?worktree=${encodeURIComponent(name)}`);
    expect(response.status(), `expected 400 for name "${name}"`).toBe(400);
  }
});

test("should return 404 for a valid but nonexistent worktree", async ({ request }) => {
  const response = await request.get("/api/self-improvement/diff?worktree=self-improvement-nonexistent");
  expect(response.status()).toBe(404);
});

/**
 * A panel action belongs to no run, so its failure is answered to the page that
 * asked rather than written into a run's state: it must never rewrite the
 * status of a run that already ended cleanly, nor be archived as its verdict.
 */
test("should answer a groundless approval to the page, without touching any run", async ({ page }) => {
  await page.goto("/");
  const error = await page.evaluate(() =>
    new Promise<string>((resolve, reject) => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      const timeout = window.setTimeout(() => { socket.close(); reject(new Error("timeout")); }, 4_000);
      socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "selfImprovement.approve", worktreeName: "self-improvement-fake" })));
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data) as { type: string; message?: string };
        if (message.type === "error" && message.message) {
          window.clearTimeout(timeout);
          socket.close();
          resolve(message.message);
        }
      });
    }),
  );
  expect(error).toContain("No self-improvement worktree");
});
