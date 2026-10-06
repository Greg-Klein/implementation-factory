import type { ServerMessage } from "./types";

/** What became of the launch this page is waiting on: a run to open, a place in the queue, or a refusal. */
export type LaunchAnswer = { outcome: "started"; runId: string } | { outcome: "queued" } | { outcome: "refused" };

/**
 * A launch is answered by the message that carries its request id, and by no
 * other: the state of a run the page subscribed to meanwhile, the launch of
 * another page or a notice about the queue say nothing about this one.
 */
export function launchAnswer(pendingRequestId: string | undefined, message: ServerMessage): LaunchAnswer | undefined {
  if (!pendingRequestId) return undefined;
  if (message.type !== "run.started" && message.type !== "notice" && message.type !== "error") return undefined;
  if (message.requestId !== pendingRequestId) return undefined;
  if (message.type === "run.started") return { outcome: "started", runId: message.runId };
  return { outcome: message.type === "notice" ? "queued" : "refused" };
}
