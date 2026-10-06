/** What the server keeps of a run's terminal, in characters: holding more than it can replay is of no use. */
export const TERMINAL_BUFFER_LIMIT = 600_000;

/** Output waiting for a terminal to be written to, cut to its most recent part. */
export function appendTerminalOutput(buffer: string, data: string, limit = TERMINAL_BUFFER_LIMIT) {
  const next = buffer + data;
  return next.length > limit ? next.slice(-limit) : next;
}
