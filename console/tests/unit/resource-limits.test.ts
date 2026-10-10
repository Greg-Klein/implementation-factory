import { describe, expect, it, jest } from "@jest/globals";
import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";
import { readJsonBody, TerminalInputBudget, validateMessageLimits, WS_BUFFER_BYTES } from "../../server/resource-limits";
import { send } from "../../server/context";
import { WebSocket } from "ws";

describe("request limits", () => {
  it("should stop collecting a body at its byte limit", async () => {
    const request = new PassThrough(); const body = readJsonBody(request as unknown as IncomingMessage, 10);
    request.write(Buffer.alloc(11));
    await expect(body).rejects.toMatchObject({ status: 413 }); request.end();
  });
  it("should read an exact boundary and reject interrupted, invalid and slow bodies", async () => {
    const request = new PassThrough(); const body = readJsonBody(request as unknown as IncomingMessage, 2); request.end("{}");
    await expect(body).resolves.toEqual({});
    const invalid = new PassThrough(); const failed = readJsonBody(invalid as unknown as IncomingMessage); invalid.end("[]");
    await expect(failed).rejects.toMatchObject({ status: 400 });
    const interrupted = new PassThrough(); const aborted = readJsonBody(interrupted as unknown as IncomingMessage); interrupted.emit("aborted");
    await expect(aborted).rejects.toMatchObject({ status: 400 }); interrupted.end();
    const slow = new PassThrough(); await expect(readJsonBody(slow as unknown as IncomingMessage, 10, 5)).rejects.toMatchObject({ status: 408 }); slow.end();
  });
  it("should count UTF-8 bytes and refuse invalid PTY dimensions", () => {
    expect(() => validateMessageLimits({ type: "terminal.input", data: "é".repeat(4096) })).not.toThrow();
    expect(() => validateMessageLimits({ type: "terminal.input", data: "é".repeat(4097) })).toThrow("oversized");
    for (const cols of [0, -1, 501, 1.5, "80"]) expect(() => validateMessageLimits({ type: "terminal.resize", cols, rows: 24 })).toThrow("dimensions");
  });
  it("should replenish a terminal budget without resetting it on another connection", () => {
    let now = 0; const budget = new TerminalInputBudget(() => now);
    expect(budget.consume(128 * 1024)).toBe(true); expect(budget.consume(1)).toBe(false);
    now = 1000; expect(budget.consume(64 * 1024)).toBe(true); expect(budget.consume(1)).toBe(false);
  });
  it("should disconnect a slow socket without sending more data", () => {
    const socket = { readyState: WebSocket.OPEN, bufferedAmount: WS_BUFFER_BYTES, terminate: jest.fn(), send: jest.fn() };
    send(socket as unknown as WebSocket, { type: "ack", ackId: "x" });
    expect(socket.terminate).toHaveBeenCalledTimes(1); expect(socket.send).not.toHaveBeenCalled();
  });
});
