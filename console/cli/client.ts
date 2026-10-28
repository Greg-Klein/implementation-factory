import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { languageOf, type Language } from "../lib/i18n";
import { texts } from "../lib/i18n/texts";
import type { ClientMessage, FactorySnapshot, ServerMessage } from "../server/types.js";

/**
 * What the command line says its errors in. The console decides the language,
 * known once its snapshot is read; until then, and when no console answers, the
 * setting of the shell decides.
 */
let language: Language = languageOf(process.env.IMPL_LANGUAGE);

export function setClientLanguage(next: Language) {
  language = next;
}

const say = () => texts(language).cli;

/** The language the console speaks, or undefined when it does not answer. */
export async function consoleLanguage(base: string): Promise<Language | undefined> {
  try {
    const response = await fetch(`${base}/api/runs`, { signal: AbortSignal.timeout(2_000) });
    const body = await response.json() as { language?: unknown };
    return response.ok && typeof body.language === "string" ? languageOf(body.language) : undefined;
  } catch {
    // No console, or one that does not answer like it: the command that follows says so itself.
    return undefined;
  }
}

/** A failure the command line says in one sentence, with the exit code it ends on. */
export class CliError extends Error {
  constructor(message: string, readonly exitCode = 1) { super(message); }
}

/** Exit code of a command that found no console to talk to, the one `status` gives a stopped server. */
export const NOT_RUNNING = 3;

/** How long a message may go unanswered: a launch creates a worktree and may read the forge first. */
const REQUEST_TIMEOUT_MS = 180_000;

/** Where the console listens, without a trailing slash. An empty variable is an absent one. */
export function consoleUrl(env: Record<string, string | undefined>) {
  const given = env.IMPL_CONSOLE_URL?.trim();
  const url = given || `http://${env.IMPL_HOST?.trim() || "127.0.0.1"}:${env.IMPL_PORT?.trim() || "3210"}`;
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new CliError(say().consoleUrlNotAddress(url)); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new CliError(say().consoleUrlNotHttp(url));
  return parsed.origin;
}

function notRunning(base: string) {
  return new CliError(say().notRunning(base), NOT_RUNNING);
}

/** One reading of the HTTP API. A refusal carries the sentence the console gave for it. */
export async function getJson(base: string, route: string): Promise<unknown> {
  let response: Response;
  try { response = await fetch(`${base}${route}`); } catch { throw notRunning(base); }
  let body: unknown;
  try { body = await response.json(); } catch { throw new CliError(say().notConsoleAnswer(base, route, response.status)); }
  if (!response.ok) {
    const reason = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : `HTTP ${response.status}`;
    throw new CliError(reason);
  }
  return body;
}

export type Listener = (message: ServerMessage) => void;

/** The socket of the console, as the page holds it: the list of runs, and the run this client subscribed to. */
export type Link = {
  /** The latest list of runs the console sent. */
  snapshot(): FactorySnapshot;
  /** Sends without waiting: keystrokes, a resize, a subscription. */
  send(message: ClientMessage): void;
  /**
   * Sends and waits for the console to say it handled the message. Resolves
   * with what it sent meanwhile, the answer of the message among it, and
   * rejects with the refusal.
   */
  request(message: ClientMessage): Promise<ServerMessage[]>;
  listen(listener: Listener): () => void;
  /** Settles when the console closes the socket, a stop or a restart. */
  closed: Promise<void>;
  close(): void;
};

function readMessage(raw: WebSocket.RawData): ServerMessage | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.toString()); } catch { return undefined; }
  if (!parsed || typeof parsed !== "object" || typeof (parsed as { type?: unknown }).type !== "string") return undefined;
  return parsed as ServerMessage;
}

/**
 * Opens the socket and waits for the first list of runs. The console only
 * accepts a socket from a page it served: this client names the console itself
 * as its origin, which a page of another site cannot do.
 */
export function connect(base: string): Promise<Link> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base.replace(/^http/, "ws")}/ws`, { origin: base });
    const listeners = new Set<Listener>();
    const pending = new Map<string, { received: ServerMessage[]; resolve: (messages: ServerMessage[]) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
    let snapshot: FactorySnapshot | undefined;
    let opened = false;
    let release: () => void = () => undefined;
    const closed = new Promise<void>((done) => { release = done; });

    const link: Link = {
      snapshot: () => snapshot!,
      send: (message) => socket.send(JSON.stringify(message)),
      request: (message) => new Promise((done, refuse) => {
        const ackId = randomUUID();
        const timer = setTimeout(() => {
          pending.delete(ackId);
          refuse(new CliError(say().noAnswerInTime));
        }, REQUEST_TIMEOUT_MS);
        pending.set(ackId, { received: [], resolve: done, reject: refuse, timer });
        socket.send(JSON.stringify({ ...message, ackId }));
      }),
      listen: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      closed,
      close: () => socket.close(),
    };

    socket.on("message", (raw) => {
      const message = readMessage(raw);
      if (!message) return;
      if (message.type === "factory") snapshot = message.snapshot;
      if (message.type === "ack" || (message.type === "error" && message.ackId)) {
        const waiting = pending.get(message.ackId!);
        if (waiting) {
          pending.delete(message.ackId!);
          clearTimeout(waiting.timer);
          if (message.type === "ack") waiting.resolve(waiting.received);
          else waiting.reject(new CliError(message.message));
          return;
        }
      }
      for (const waiting of pending.values()) waiting.received.push(message);
      for (const listener of listeners) listener(message);
      if (!opened && snapshot) { opened = true; resolve(link); }
    });
    socket.on("unexpected-response", (_request, response) => {
      reject(new CliError(response.statusCode === 403
        ? say().refusedHost(base)
        : say().refusedHttp(base, response.statusCode)));
    });
    socket.on("error", () => { if (!opened) reject(notRunning(base)); });
    socket.on("close", () => {
      for (const waiting of pending.values()) { clearTimeout(waiting.timer); waiting.reject(new CliError(say().closedBeforeAnswer)); }
      pending.clear();
      if (!opened) reject(notRunning(base));
      release();
    });
  });
}

/** The one answer of a given type among what a request received. */
export function answerOf<T extends ServerMessage["type"]>(messages: ServerMessage[], type: T): Extract<ServerMessage, { type: T }> | undefined {
  return messages.find((message): message is Extract<ServerMessage, { type: T }> => message.type === type);
}
