import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import process from "node:process";

let input = "";
for await (const chunk of process.stdin) input += chunk;

const endpoint = process.env.IMPL_HARNESS_HOOK_URL;
if (!endpoint) process.exit(0);

/** Whether the harness could not take the event, as opposed to having refused it. */
function undelivered(response) {
  return !response || response.status >= 500;
}

async function post(body, timeout) {
  try {
    return await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    return undefined;
  }
}

try {
  const payload = JSON.parse(input || "{}");
  const waitsForHarnessAnswer = payload.hook_event_name === "PreToolUse" && payload.tool_name === "AskUserQuestion";
  // One identifier across the retry and the spool, so the harness applies the event once.
  const body = JSON.stringify({
    runId: process.env.IMPL_RUN_ID,
    hookId: randomUUID(),
    receivedAt: new Date().toISOString(),
    payload,
  });
  if (waitsForHarnessAnswer) {
    // The question blocks until the user answers, and only the live request can
    // carry that answer back: it is neither retried nor spooled.
    const response = await post(body, 3_600_000);
    if (response?.ok) {
      const result = await response.json();
      if (result.hookOutput) process.stdout.write(JSON.stringify(result.hookOutput));
    }
  } else {
    let response = await post(body, 800);
    if (undelivered(response)) response = await post(body, 1_500);
    // Lost, an agent stop leaves the run waiting forever on an agent long gone.
    // Spooled, it is applied late instead.
    if (undelivered(response) && process.env.IMPL_HOOK_SPOOL) appendFileSync(process.env.IMPL_HOOK_SPOOL, `${body}\n`);
  }
} catch {
  // The harness is optional: hooks must never interrupt Claude Code.
}
