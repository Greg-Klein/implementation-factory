/** What the server keeps of a run's terminal, in characters: holding more than it can replay is of no use. */
export const TERMINAL_BUFFER_LIMIT = 600_000;

/** Output kept for a terminal, cut to its most recent part. `slack`: how far past the limit it may grow before it is cut back to it. */
export function appendTerminalOutput(buffer: string, data: string, limit = TERMINAL_BUFFER_LIMIT, slack = 0) {
  const next = buffer + data;
  return next.length > limit + slack ? next.slice(-limit) : next;
}
