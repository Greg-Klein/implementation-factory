import type { IncomingMessage } from "node:http";

export const HTTP_BODY_BYTES = 2_000_000;
export const WS_MESSAGE_BYTES = 1_000_000;
export const WS_BUFFER_BYTES = 4_000_000;
export const TERMINAL_INPUT_BYTES = 8_192;
const TEXT_BYTES = 65_536;

export class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function readJsonBody(request: IncomingMessage, limit = HTTP_BODY_BYTES, timeout = 30_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [], bytes = 0, finished = false;
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      if (finished) return;
      finished = true; clearTimeout(timer); chunks = [];
      if (error) reject(error); else resolve(value!);
    };
    const timer = setTimeout(() => finish(new RequestError("Request body timed out.", 408)), timeout);
    request.on("data", (chunk: Buffer) => {
      if (finished) return;
      bytes += chunk.length;
      if (bytes > limit) { finish(new RequestError("Request body is too large.", 413)); return; }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (finished) return;
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8") || "{}");
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        finish(undefined, value as Record<string, unknown>);
      } catch { finish(new RequestError("Invalid JSON object.", 400)); }
    });
    request.on("error", (error) => finish(error));
    request.on("aborted", () => finish(new RequestError("Request body was interrupted.", 400)));
  });
}

export function validateMessageLimits(message: Record<string, unknown>) {
  for (const key of ["runId", "cwd", "issueUrl", "instruction", "text", "body", "data"]) {
    const value = message[key];
    if (value === undefined || value === null) continue;
    const limit = key === "data" ? TERMINAL_INPUT_BYTES : TEXT_BYTES;
    if (typeof value !== "string" || Buffer.byteLength(value) > limit) throw new Error(`Invalid or oversized ${key}.`);
  }
  if (message.type === "terminal.resize") {
    for (const key of ["cols", "rows"]) {
      const value = message[key];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 500) throw new Error("Terminal dimensions must be integers between 1 and 500.");
    }
  }
}

/** Shared across sockets so reconnecting cannot reset the terminal input budget. */
export class TerminalInputBudget {
  private available = 128 * 1024;
  private at: number;
  constructor(private readonly clock = () => Date.now()) { this.at = clock(); }
  consume(bytes: number) {
    const now = this.clock();
    this.available = Math.min(128 * 1024, this.available + Math.max(0, now - this.at) * (64 * 1024 / 1000));
    this.at = now;
    if (bytes > this.available) return false;
    this.available -= bytes; return true;
  }
}
