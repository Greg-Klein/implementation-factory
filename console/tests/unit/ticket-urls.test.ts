import { describe, expect, it } from "@jest/globals";
import { normalizeTicketUrl, parseDeliveryUrl, parseTicketUrl, parseTicketUrls, ticketIdentity, ticketReference } from "../../lib/ticket-urls";
import { admitBatch, runLockKey } from "../../server/domain";

const ISSUE = "https://gitlab.com/acme/shop/-/issues/101";

describe("a pasted ticket URL", () => {
  it("should be read without its query, its fragment or a trailing slash", () => {
    expect(normalizeTicketUrl(`${ISSUE}?tab=notes#note_12`)).toBe(ISSUE);
    expect(normalizeTicketUrl(`  ${ISSUE}/ `)).toBe(ISSUE);
    expect(ticketIdentity(`${ISSUE}#note_3`)).toBe(ISSUE);
  });

  it("should give one identity to the addresses of one ticket, and keep it an address of that ticket", () => {
    const identity = "https://gitlab.com/acme/shop/-/issues/101";
    expect(ticketIdentity("https://gitlab.com/acme/shop/-/work_items/101")).toBe(identity);
    expect(ticketIdentity("https://GitLab.com/Acme/Shop/-/issues/101/?tab=notes#note_3")).toBe(identity);
    expect(ticketIdentity(identity)).toBe(identity);
    expect(ticketIdentity("https://gitlab.com/acme/shop/-/issues/102")).toBe("https://gitlab.com/acme/shop/-/issues/102");
    expect(ticketIdentity("https://gitlab.com/acme/api/-/issues/101")).toBe("https://gitlab.com/acme/api/-/issues/101");
    expect(ticketIdentity("https://GitHub.com/Acme/Shop/issues/7#issuecomment-1")).toBe("https://github.com/acme/shop/issues/7");
    expect(ticketIdentity("ticket-simule://lot/A-1")).toBe("ticket-simule://lot/A-1");
  });

  it("should keep once a ticket pasted under two of its addresses", () => {
    const parsed = parseTicketUrls("https://gitlab.com/acme/shop/-/work_items/101\nhttps://gitlab.com/acme/shop/-/issues/101\nhttps://gitlab.com/acme/shop/-/issues/102");
    expect(parsed.tickets).toEqual(["https://gitlab.com/acme/shop/-/work_items/101", "https://gitlab.com/acme/shop/-/issues/102"]);
    expect(parsed.duplicates).toEqual(["https://gitlab.com/acme/shop/-/issues/101"]);
  });

  it("should accept an issue or a work item, on any host and under nested groups", () => {
    expect(normalizeTicketUrl("https://gitlab.example.com/group/platform/repo/-/work_items/42")).toBe("https://gitlab.example.com/group/platform/repo/-/work_items/42");
    expect(normalizeTicketUrl("http://gitlab.local/a/b/-/issues/7")).toBe("http://gitlab.local/a/b/-/issues/7");
  });

  it("should accept a GitHub issue, on github.com or a host of its own", () => {
    expect(normalizeTicketUrl("https://github.com/acme/shop/issues/101#issuecomment-9")).toBe("https://github.com/acme/shop/issues/101");
    expect(normalizeTicketUrl("https://github.example.com/acme/shop/issues/7/")).toBe("https://github.example.com/acme/shop/issues/7");
  });

  it("should tell the forge from the shape of the address", () => {
    expect(parseTicketUrl(ISSUE)).toEqual({ forge: "gitlab", hostname: "gitlab.com", project: "acme/shop", number: "101" });
    expect(parseTicketUrl("https://gitlab.example.com/group/platform/repo/-/work_items/42")).toEqual({ forge: "gitlab", hostname: "gitlab.example.com", project: "group/platform/repo", number: "42" });
    expect(parseTicketUrl("https://github.com/acme/shop/issues/101")).toEqual({ forge: "github", hostname: "github.com", project: "acme/shop", number: "101" });
    // A GitLab project may itself be called `issues`: `/-/` still decides.
    expect(parseTicketUrl("https://gitlab.com/acme/issues/-/issues/3")?.forge).toBe("gitlab");
    expect(parseDeliveryUrl("https://github.com/acme/shop/pull/12")).toEqual({ forge: "github", hostname: "github.com", project: "acme/shop", number: "12" });
    expect(parseDeliveryUrl("https://gitlab.com/acme/shop/-/merge_requests/12")).toEqual({ forge: "gitlab", hostname: "gitlab.com", project: "acme/shop", number: "12" });
  });

  it("should refuse what is not a ticket", () => {
    expect(normalizeTicketUrl("https://github.com/acme/shop/pull/12")).toBeUndefined();
    expect(normalizeTicketUrl("https://github.com/acme/shop/issues")).toBeUndefined();
    expect(normalizeTicketUrl("https://github.com/acme/issues/12")).toBeUndefined();
    expect(normalizeTicketUrl("https://github.com/acme/shop/issues/12/extra")).toBeUndefined();
    // The old GitLab address without `/-/` is not a GitHub issue.
    expect(normalizeTicketUrl("https://gitlab.com/acme/shop/issues/12")).toBeUndefined();
    expect(normalizeTicketUrl("ftp://github.com/acme/shop/issues/12")).toBeUndefined();
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

  it("should take GitLab and GitHub tickets in the same paste", () => {
    const parsed = parseTicketUrls(`${ISSUE}\nhttps://github.com/acme/shop/issues/101\nhttps://github.com/acme/shop/issues/101?x=1`);
    expect(parsed.tickets).toEqual([ISSUE, "https://github.com/acme/shop/issues/101"]);
    expect(parsed.duplicates).toEqual(["https://github.com/acme/shop/issues/101"]);
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

  it("should hold one ticket under one lock whether it is written as an issue or as a work item", () => {
    const issue = { repository: "/work/shop", issueUrl: "https://gitlab.com/acme/shop/-/issues/101" };
    const workItem = { repository: "/work/shop", issueUrl: "https://GitLab.com/acme/shop/-/work_items/101" };
    expect(runLockKey({ cwd: "/work/shop", issueUrl: workItem.issueUrl })).toBe("/work/shop\nhttps://gitlab.com/acme/shop/-/issues/101");
    const { accepted, duplicates } = admitBatch([workItem], [runLockKey({ cwd: "/work/shop", issueUrl: issue.issueUrl })]);
    expect(accepted).toEqual([]);
    expect(duplicates).toEqual([workItem]);
  });

  it("should tell the same ticket number of two repositories apart", () => {
    expect(admitBatch([ticket("/work/api", 101)], [key("/work/shop", 101)]).accepted).toHaveLength(1);
  });
});
