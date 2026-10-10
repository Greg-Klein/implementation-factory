import { hookTlsOptions } from "./hook-tls.mjs";
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import process from "node:process";
import { gateObserve, gateStop } from "./gate.mjs";
import { denial, guardDecision } from "./guard.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;

// Decided here, with or without a console: a refused call never happened, so
// the factory is not told about a tool that will never report its end.
try {
  const refused = guardDecision(JSON.parse(input || "{}"));
  if (refused) {
    process.stdout.write(JSON.stringify(denial(refused)));
    process.exit(0);
  }
} catch {
  // A guard that cannot read the call lets it through.
}

// Judged here for the same reason: an agent sent back to work has not stopped,
// and the factory would otherwise close an agent that is still editing.
try {
  const payload = JSON.parse(input || "{}");
  gateObserve(payload);
  const sentBack = await gateStop(payload);
  if (sentBack) {
    process.stdout.write(JSON.stringify({ decision: "block", reason: sentBack }));
    process.exit(0);
  }
} catch {
  // A gate that cannot run lets the agent go.
}

const endpoint = process.env.IMPL_HOOK_URL;
if (!endpoint) process.exit(0);

/** Whether the factory could not take the event, as opposed to having refused it. */
function undelivered(response) {
  return !response || response.status >= 500;
}

/**
 * Not `fetch`: its dispatcher gives up on a response whose headers take more
 * than five minutes, whatever the abort signal says, and a question the user
 * takes longer than that to answer then falls back to the terminal dialog.
 */
function post(body, timeout) {
  return new Promise((resolve) => {
    const request = endpoint?.startsWith("https:") ? httpsRequest : httpRequest;
    const outgoing = request(endpoint, { ...hookTlsOptions(endpoint, process.env.IMPL_HOOK_TLS_CERT), method: "POST", headers: { "content-type": "application/json" }, timeout }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, ok: response.statusCode >= 200 && response.statusCode < 300, json: () => JSON.parse(text) }));
      response.on("error", () => resolve(undefined));
    });
    outgoing.on("timeout", () => outgoing.destroy());
    outgoing.on("error", () => resolve(undefined));
    outgoing.end(body);
  });
}

try {
  const payload = JSON.parse(input || "{}");
  const waitsForFactoryAnswer = payload.hook_event_name === "PreToolUse" && payload.tool_name === "AskUserQuestion";
  // One identifier across the retry and the spool, so the factory applies the event once.
  const body = JSON.stringify({
    runId: process.env.IMPL_RUN_ID,
    hookId: randomUUID(),
    receivedAt: new Date().toISOString(),
    payload,
  });
  if (waitsForFactoryAnswer) {
    // The question blocks until the user answers, and only the live request can
    // carry that answer back: it is neither retried nor spooled.
    const response = await post(body, 3_600_000);
    if (response?.ok) {
      const result = response.json();
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
  // The factory is optional: hooks must never interrupt Claude Code.
}
