import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { handledStillFound, openProposals, readProposalSnapshot, ticketIdentity } from "./domain.js";
import type { TicketProposal } from "./types.js";
import { isMissingFile, reportFailure } from "./context.js";

export type TicketProposalsOptions = {
  /** The snapshot a watcher writes, see contracts/ticket-proposals.md. */
  file: string;
  /** Where the decisions already taken are kept. */
  handledFile: string;
  intervalMs: number;
  /** The addresses of the tickets the console already has: queued, held by a run, or behind a merge request. */
  taken(): Iterable<string>;
  /** Called when what is proposed may have changed. */
  changed(): void;
  /** Queues the tickets read since the last time. Those refused, with the reason, are not tried again while they stay in the file. */
  launch(proposals: TicketProposal[]): Promise<ProposalLaunch>;
};

/** What became of the tickets handed to `launch`. One named in neither list is tried again at the next reading. */
export type ProposalLaunch = { started: string[]; refused: { issueUrl: string; reason: string }[] };

/**
 * Reads the file an outside watcher keeps up to date and remembers which of
 * its tickets the user already decided on. The console never asks GitLab for
 * tickets and the watcher never talks to the console: the file is all they
 * share, so either one can be down, replaced or rewritten without the other.
 *
 * Every ticket read for the first time is launched at once, as a batch like
 * a pasted one: the queue and the batch analysis decide when it runs. One the
 * console cannot launch stays listed with its reason and is not tried again
 * until it leaves the file or the console restarts, so a missing checkout is
 * said once rather than at every reading.
 */
export class TicketProposals {
  private found: TicketProposal[] = [];
  private handled: string[] = [];
  private refused = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private reading: Promise<void> | null = null;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly options: TicketProposalsOptions) {}

  /** Reads the decisions kept from the last process, then the file, then the file again at every interval. */
  async start() {
    try {
      const stored = JSON.parse(await readFile(this.options.handledFile, "utf8")) as unknown;
      if (Array.isArray(stored)) this.handled = stored.filter((entry): entry is string => typeof entry === "string");
    } catch { /* nothing was decided yet */ }
    await this.read();
    if (this.timer) return;
    this.timer = setInterval(() => void this.read(), this.options.intervalMs);
    this.timer.unref?.();
  }

  /** The tickets found and not started yet: refused, or about to be launched. */
  open(): TicketProposal[] {
    return openProposals(this.found, this.options.taken(), this.handled).map((proposal) => {
      const refusal = this.refused.get(ticketIdentity(proposal.issueUrl));
      return refusal ? { ...proposal, refusal } : proposal;
    });
  }

  /** Of these addresses, the ones still open right now, in their bare form. */
  proposed(issueUrls: string[]) {
    const asked = new Set(issueUrls.map(ticketIdentity));
    return this.open().map((proposal) => proposal.issueUrl).filter((issueUrl) => asked.has(ticketIdentity(issueUrl)));
  }

  /** Records that these tickets were accepted or dismissed: they are not proposed again while the watcher still finds them. */
  async handle(issueUrls: string[]) {
    this.handled = [...new Set([...this.handled, ...issueUrls.map(ticketIdentity)])];
    await this.persist();
    this.options.changed();
  }

  /** One reading of the file. Readings never overlap. */
  read(): Promise<void> {
    this.reading ??= this.readOnce().finally(() => { this.reading = null; });
    return this.reading;
  }

  private async readOnce() {
    let found: TicketProposal[] | undefined;
    let missing = false;
    try {
      found = readProposalSnapshot(JSON.parse(await readFile(this.options.file, "utf8")) as unknown);
    } catch (error) {
      // No file: no watcher, or one that was removed, and nothing is proposed.
      // A file that does not parse is one caught mid-write or broken: what was read last still stands.
      missing = isMissingFile(error);
      if (missing) found = [];
    }
    if (!found) return;
    const before = JSON.stringify(this.found);
    this.found = found;
    const present = new Set(found.map((proposal) => ticketIdentity(proposal.issueUrl)));
    for (const issueUrl of this.refused.keys()) if (!present.has(issueUrl)) this.refused.delete(issueUrl);
    // Only a snapshot says a ticket left the filter, an empty one included: a missing file says nothing about the decisions taken.
    const kept = missing ? this.handled : handledStillFound(this.handled, found);
    const forgot = kept.length !== this.handled.length;
    this.handled = kept;
    if (forgot) await this.persist();
    if (forgot || before !== JSON.stringify(found)) this.options.changed();
    await this.launchNew();
  }

  private async launchNew() {
    const fresh = this.open().filter((proposal) => !proposal.refusal);
    if (fresh.length === 0) return;
    const outcome = await this.options.launch(fresh.map(({ refusal: _refusal, ...proposal }) => proposal)).catch((error: unknown) => ({
      started: [], refused: fresh.map((proposal) => ({ issueUrl: proposal.issueUrl, reason: error instanceof Error ? error.message : String(error) })),
    }));
    for (const { issueUrl, reason } of outcome.refused) this.refused.set(ticketIdentity(issueUrl), reason);
    if (outcome.started.length > 0) await this.handle(outcome.started);
    else if (outcome.refused.length > 0) this.options.changed();
  }

  /** Written whole and renamed into place, one write after the other. */
  private persist() {
    const content = `${JSON.stringify(this.handled, null, 2)}\n`;
    const file = this.options.handledFile;
    this.writes = this.writes.then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, content);
      await rename(`${file}.tmp`, file);
    }).catch(reportFailure("Handled tickets not saved", file));
    return this.writes;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
