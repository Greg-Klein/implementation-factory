import { describe, expect, it } from "@jest/globals";
import { normalizeTicketUrl, parseTicketUrls, ticketIdentity, ticketReference } from "../../lib/ticket-urls";
import { admitBatch, runLockKey } from "../../server/domain";

const ISSUE = "https://gitlab.com/acme/shop/-/issues/101";

describe("a pasted ticket URL", () => {
  it("should be read without its query, its fragment or a trailing slash", () => {
    expect(normalizeTicketUrl(`${ISSUE}?tab=notes#note_12`)).toBe(ISSUE);
    expect(normalizeTicketUrl(`  ${ISSUE}/ `)).toBe(ISSUE);
    expect(ticketIdentity(`${ISSUE}#note_3`)).toBe(ISSUE);
  });

  it("should accept an issue or a work item, on any host and under nested groups", () => {
    expect(normalizeTicketUrl("https://gitlab.example.com/group/platform/repo/-/work_items/42")).toBe("https://gitlab.example.com/group/platform/repo/-/work_items/42");
    expect(normalizeTicketUrl("http://gitlab.local/a/b/-/issues/7")).toBe("http://gitlab.local/a/b/-/issues/7");
  });

  it("should refuse what is not a ticket", () => {
    expect(normalizeTicketUrl("https://gitlab.com/acme/shop/-/merge_requests/12")).toBeUndefined();
    expect(normalizeTicketUrl("https://gitlab.com/acme/shop/-/issues/")).toBeUndefined();
    expect(normalizeTicketUrl("acme/shop#101")).toBeUndefined();
    expect(normalizeTicketUrl("")).toBeUndefined();
  });

  it("should be called by its number", () => {
    expect(ticketReference(`${ISSUE}?x=1`)).toBe("#101");
    expect(ticketReference("ticket-simule://IH-42")).toBe("IH-42");
  });
});

describe("a pasted list of tickets", () => {
  it("should read one URL per line, in the order pasted, skipping blank lines", () => {
    const parsed = parseTicketUrls(`${ISSUE}\n\n  https://gitlab.com/acme/shop/-/issues/102  \r\nhttps://gitlab.com/acme/api/-/work_items/7\n`);
    expect(parsed.tickets).toEqual([ISSUE, "https://gitlab.com/acme/shop/-/issues/102", "https://gitlab.com/acme/api/-/work_items/7"]);
    expect(parsed.invalid).toEqual([]);
  });

  it("should read several URLs on one line", () => {
    expect(parseTicketUrls(`${ISSUE}, https://gitlab.com/acme/shop/-/issues/102; https://gitlab.com/acme/shop/-/issues/103`).tickets).toHaveLength(3);
  });

  it("should flag what is not a ticket with the line it sits on", () => {
    const parsed = parseTicketUrls(`${ISSUE}\nticket 102\nhttps://example.com/page`);
    expect(parsed.tickets).toEqual([ISSUE]);
    expect(parsed.invalid).toEqual([{ line: 2, text: "ticket" }, { line: 2, text: "102" }, { line: 3, text: "https://example.com/page" }]);
  });

  it("should keep a ticket pasted twice once, however its URL varies", () => {
    const parsed = parseTicketUrls(`${ISSUE}\n${ISSUE}?tab=notes\n${ISSUE}/`);
    expect(parsed.tickets).toEqual([ISSUE]);
    expect(parsed.duplicates).toEqual([ISSUE]);
  });

  it("should read nothing out of an empty field", () => {
    expect(parseTicketUrls("  \n ")).toEqual({ tickets: [], invalid: [], duplicates: [] });
  });
});

describe("the tickets a batch brings in", () => {
  const ticket = (repository: string, iid: number) => ({ repository, issueUrl: `https://gitlab.com/acme/shop/-/issues/${iid}` });
  const key = (repository: string, iid: number) => runLockKey({ cwd: repository, issueUrl: ticket(repository, iid).issueUrl });

  it("should leave out a ticket already queued, running or waiting for its merge", () => {
    const { accepted, duplicates } = admitBatch([ticket("/work/shop", 101), ticket("/work/shop", 102), ticket("/work/shop", 103)], [key("/work/shop", 102)]);
    expect(accepted.map((entry) => entry.issueUrl)).toEqual([ticket("/work/shop", 101).issueUrl, ticket("/work/shop", 103).issueUrl]);
    expect(duplicates).toEqual([ticket("/work/shop", 102)]);
  });

  it("should take a ticket once when the batch names it twice", () => {
    const { accepted, duplicates } = admitBatch([ticket("/work/shop", 101), { ...ticket("/work/shop", 101), issueUrl: `${ticket("/work/shop", 101).issueUrl}?tab=notes` }], []);
    expect(accepted).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
  });

  it("should tell the same ticket number of two repositories apart", () => {
    expect(admitBatch([ticket("/work/api", 101)], [key("/work/shop", 101)]).accepted).toHaveLength(1);
  });
});
