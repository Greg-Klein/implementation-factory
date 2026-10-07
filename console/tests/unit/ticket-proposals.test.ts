import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { branchName, handledStillFound, openProposals, readProposalSnapshot } from "../../server/domain";
import { TicketProposals, type ProposalLaunch } from "../../server/ticket-proposals";
import type { TicketProposal } from "../../server/types";

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

  it("should read the base branch the watcher named, and drop one that is not a plain branch name", () => {
    expect(readProposalSnapshot({ tickets: [{ url: url(1), baseBranch: " feat-87-loyalty " }, { url: url(2), baseBranch: "--upload-pack=x" }, { url: url(3), baseBranch: 12 }] }))
      .toEqual([{ issueUrl: url(1), baseBranch: "feat-87-loyalty" }, { issueUrl: url(2) }, { issueUrl: url(3) }]);
  });

  it("should tell an empty snapshot from a file that is not one", () => {
    expect(readProposalSnapshot({ tickets: [] })).toEqual([]);
    expect(readProposalSnapshot([url(1)])).toBeUndefined();
    expect(readProposalSnapshot({ version: 1 })).toBeUndefined();
  });
});

describe("a branch name read from the watcher's file", () => {
  it("should accept the plain shapes of a branch", () => {
    for (const name of ["develop", "feat-87-loyalty", "feature/loyalty_v2", "release/1.4"]) expect(branchName(name)).toBe(name);
  });

  it("should refuse an option, a range, a ref syntax or a hidden path", () => {
    for (const name of ["", "-x", "a..b", "a b", "a//b", "feat/", "feat.", "feat.lock", "feat/.hidden", "HEAD~1", "a:b", "refs@{1}", "x".repeat(201), undefined, 3]) expect(branchName(name)).toBeUndefined();
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
  let launched: TicketProposal[][];
  /** By default the console decides nothing about what it is handed, the way it answers while shutting down. */
  let launch: (proposals: TicketProposal[]) => Promise<ProposalLaunch>;
  const write = (iids: number[]) => writeFileSync(file, JSON.stringify({ version: 1, tickets: iids.map((iid) => ({ url: url(iid) })) }));
  const proposals = () => new TicketProposals({
    file, handledFile, intervalMs: 60_000, taken: () => taken, changed: () => { changes += 1; },
    launch: (found) => { launched.push(found); return launch(found); },
  });
  const open = (source: TicketProposals) => source.open().map((proposal) => proposal.issueUrl);

  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), "ticket-proposals-"));
    file = path.join(directory, "ticket-proposals.json");
    handledFile = path.join(directory, "handled.json");
    taken = [];
    changes = 0;
    launched = [];
    launch = async () => ({ started: [], refused: [] });
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

  it("should forget a decision when the watcher finds nothing any more", async () => {
    const source = proposals();
    write([1]);
    await source.read();
    await source.handle([url(1)]);
    write([]);
    await source.read();
    expect(JSON.parse(readFileSync(handledFile, "utf8"))).toEqual([]);
    write([1]);
    await source.read();
    expect(open(source)).toEqual([url(1)]);
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

  it("should queue none of the tickets listed when the decisions of the last process cannot be read, and keep that file aside", async () => {
    launch = async (found) => ({ started: found.map((proposal) => proposal.issueUrl), refused: [] });
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    writeFileSync(handledFile, '["https://gitlab.com/acme/shop/-/work_it');
    write([1, 2]);
    const source = proposals();
    await source.start();
    source.stop();
    logged.mockRestore();
    expect(launched).toEqual([]);
    expect(source.open()).toEqual([]);
    expect(JSON.parse(readFileSync(handledFile, "utf8"))).toEqual(["https://gitlab.com/acme/shop/-/issues/1", "https://gitlab.com/acme/shop/-/issues/2"]);
    const aside = readdirSync(directory).filter((name) => name.startsWith("handled.json.unreadable-"));
    expect(aside).toHaveLength(1);
    expect(readFileSync(path.join(directory, aside[0]!), "utf8")).toBe('["https://gitlab.com/acme/shop/-/work_it');

    // A ticket the watcher finds afterwards is new, and queued as usual.
    write([1, 2, 3]);
    await source.read();
    expect(launched.map((batch) => batch.map((proposal) => proposal.issueUrl))).toEqual([[url(3)]]);
  });

  it("should launch the new tickets of a reading together, with the base the watcher named, and not again once queued", async () => {
    launch = async (found) => ({ started: found.map((proposal) => proposal.issueUrl), refused: [] });
    const source = proposals();
    writeFileSync(file, JSON.stringify({ tickets: [{ url: url(1), baseBranch: "feat-87" }, { url: url(2) }] }));
    await source.read();
    expect(launched).toEqual([[{ issueUrl: url(1), baseBranch: "feat-87" }, { issueUrl: url(2) }]]);
    expect(source.open()).toEqual([]);

    write([1, 2, 3]);
    await source.read();
    expect(launched.map((batch) => batch.map((proposal) => proposal.issueUrl))).toEqual([[url(1), url(2)], [url(3)]]);
  });

  it("should not hand a ticket the console already has to the launch", async () => {
    const source = proposals();
    write([1, 2]);
    taken = [url(1), url(2)];
    await source.read();
    expect(launched).toEqual([]);
  });

  it("should list a refused ticket with its reason and not try it again until it leaves the file", async () => {
    launch = async (found) => ({ started: [], refused: found.map((proposal) => ({ issueUrl: proposal.issueUrl, reason: "No checkout found." })) });
    const source = proposals();
    write([1]);
    await source.read();
    await source.read();
    expect(launched).toHaveLength(1);
    expect(source.open()).toEqual([{ issueUrl: url(1), refusal: "No checkout found." }]);

    write([]);
    await source.read();
    write([1]);
    await source.read();
    expect(launched).toHaveLength(2);
  });

  it("should refuse every ticket handed over with the reason when the launch throws", async () => {
    launch = async () => { throw new Error("claude was not found in PATH."); };
    const source = proposals();
    write([1, 2]);
    await source.read();
    expect(source.open().map((proposal) => proposal.refusal)).toEqual(["claude was not found in PATH.", "claude was not found in PATH."]);
  });

  it("should drop a refused ticket the user dismissed, across a restart", async () => {
    launch = async (found) => ({ started: [], refused: found.map((proposal) => ({ issueUrl: proposal.issueUrl, reason: "No checkout found." })) });
    const source = proposals();
    write([1]);
    await source.read();
    await source.handle([url(1)]);
    expect(source.open()).toEqual([]);

    const restarted = proposals();
    await restarted.start();
    restarted.stop();
    expect(launched).toHaveLength(1);
  });
});
