import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { handledStillFound, openProposals, readProposalSnapshot } from "../../server/domain";
import { TicketProposals } from "../../server/ticket-proposals";

const url = (iid: number) => `https://gitlab.com/acme/shop/-/work_items/${iid}`;

describe("the snapshot a watcher writes", () => {
  it("should read the tickets with their title and source", () => {
    expect(readProposalSnapshot({ version: 1, tickets: [{ url: url(1), title: " Fix the cart ", source: "acme/shop" }, { url: url(2) }] }))
      .toEqual([{ issueUrl: url(1), title: "Fix the cart", source: "acme/shop" }, { issueUrl: url(2) }]);
  });

  it("should keep a ticket once and skip what is not a ticket address", () => {
    expect(readProposalSnapshot({ tickets: [{ url: url(1) }, { url: `${url(1)}?tab=notes` }, { url: "https://example.com" }, { title: "no address" }, "text"] }))
      .toEqual([{ issueUrl: url(1) }]);
  });

  it("should tell an empty snapshot from a file that is not one", () => {
    expect(readProposalSnapshot({ tickets: [] })).toEqual([]);
    expect(readProposalSnapshot([url(1)])).toBeUndefined();
    expect(readProposalSnapshot({ version: 1 })).toBeUndefined();
  });
});

describe("what is still to decide", () => {
  const found = [1, 2, 3].map((iid) => ({ issueUrl: url(iid) }));

  it("should leave out the tickets the console already has and those already decided on", () => {
    expect(openProposals(found, [`${url(1)}#note_4`], [url(3)])).toEqual([{ issueUrl: url(2) }]);
  });

  it("should forget a decision once the watcher no longer finds the ticket", () => {
    expect(handledStillFound([url(1), url(9)], found)).toEqual([url(1)]);
  });
});

describe("the proposals the console reads", () => {
  let directory: string;
  let file: string;
  let handledFile: string;
  let taken: string[];
  let changes: number;
  const write = (iids: number[]) => writeFileSync(file, JSON.stringify({ version: 1, tickets: iids.map((iid) => ({ url: url(iid) })) }));
  const proposals = () => new TicketProposals({ file, handledFile, intervalMs: 60_000, taken: () => taken, changed: () => { changes += 1; } });
  const open = (source: TicketProposals) => source.open().map((proposal) => proposal.issueUrl);

  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), "ticket-proposals-"));
    file = path.join(directory, "ticket-proposals.json");
    handledFile = path.join(directory, "handled.json");
    taken = [];
    changes = 0;
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("should propose nothing when no watcher wrote a file", async () => {
    const source = proposals();
    await source.read();
    expect(source.open()).toEqual([]);
    expect(changes).toBe(0);
  });

  it("should propose what the file names, and say so only when it changed", async () => {
    const source = proposals();
    write([1, 2]);
    await source.read();
    await source.read();
    expect(open(source)).toEqual([url(1), url(2)]);
    expect(changes).toBe(1);
  });

  it("should not propose a ticket the console already has", async () => {
    const source = proposals();
    write([1, 2]);
    taken = [url(2)];
    await source.read();
    expect(open(source)).toEqual([url(1)]);
  });

  it("should not propose again a ticket decided on, across a restart", async () => {
    const source = proposals();
    write([1, 2]);
    await source.read();
    await source.handle([url(1)]);
    expect(open(source)).toEqual([url(2)]);

    const restarted = proposals();
    await restarted.start();
    restarted.stop();
    expect(open(restarted)).toEqual([url(2)]);
  });

  it("should propose a ticket again when it left the file and came back", async () => {
    const source = proposals();
    write([1, 2]);
    await source.read();
    await source.handle([url(1)]);
    write([2]);
    await source.read();
    expect(JSON.parse(readFileSync(handledFile, "utf8"))).toEqual([]);
    write([1, 2]);
    await source.read();
    expect(open(source)).toEqual([url(1), url(2)]);
  });

  it("should keep what it read last when the file is caught mid-write", async () => {
    const source = proposals();
    write([1]);
    await source.read();
    writeFileSync(file, '{"version": 1, "tickets": [');
    await source.read();
    expect(open(source)).toEqual([url(1)]);
  });

  it("should keep the decisions when the file disappears", async () => {
    const source = proposals();
    write([1]);
    await source.read();
    await source.handle([url(1)]);
    rmSync(file);
    await source.read();
    expect(source.open()).toEqual([]);
    write([1]);
    await source.read();
    expect(source.open()).toEqual([]);
  });

  it("should only name, among the addresses asked, the ones proposed right now", async () => {
    const source = proposals();
    write([1]);
    await source.read();
    expect(source.proposed([`${url(1)}?x=1`, url(7)])).toEqual([url(1)]);
  });
});
