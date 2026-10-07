import { describe, expect, it } from "@jest/globals";
import { linkEdges, overlayEdges } from "../../server/domain";
import type { ScheduleEdge } from "../../server/types";

/** The blocking links of a forge turned into edges of the schedule. Every ticket here is invented. */
const SHOP = "/work/shop";
const url = (iid: number) => `https://gitlab.com/acme/shop/-/issues/${iid}`;

describe("the dependencies a forge states between tickets", () => {
  it("should order a blocked ticket after the one that blocks it, in both directions", () => {
    const edges = linkEdges(SHOP, url(102), { blockedBy: [url(101)], blocks: [url(103)] }, [url(101), url(103), url(104)]);
    expect(edges).toEqual([
      { repository: SHOP, a: url(102), b: url(101), kind: "depends_on", order: [url(101), url(102)], reason: "GitLab marks #102 as blocked by #101." },
      { repository: SHOP, a: url(102), b: url(103), kind: "depends_on", order: [url(102), url(103)], reason: "GitLab marks #103 as blocked by #102." },
    ]);
  });

  it("should give nothing for a link to a ticket the console does not have", () => {
    expect(linkEdges(SHOP, url(102), { blockedBy: [url(90)], blocks: [] }, [url(101)])).toEqual([]);
  });

  it("should match a ticket whatever form its address takes, and keep the address the console knows", () => {
    const known = "https://gitlab.com/acme/shop/-/issues/101?show=details";
    const [edge] = linkEdges(SHOP, url(102), { blockedBy: ["https://gitlab.com/Acme/shop/-/work_items/101"], blocks: [] }, [known]);
    expect(edge).toMatchObject({ b: known, order: [known, url(102)] });
  });

  it("should never link a ticket to itself, to another project's ticket of the same number, or twice to the same one", () => {
    const links = { blockedBy: [url(102), "https://gitlab.com/acme/api/-/issues/101", url(103)], blocks: [] };
    expect(linkEdges(SHOP, url(102), links, [url(102), url(101), url(103), `${url(103)}/`]).map((edge) => edge.b)).toEqual([url(103)]);
  });

  it("should name the forge of the ticket", () => {
    const issue = (number: number) => `https://github.com/acme/shop/issues/${number}`;
    expect(linkEdges(SHOP, issue(2), { blockedBy: [issue(1)], blocks: [] }, [issue(1)])[0]!.reason).toBe("GitHub marks #2 as blocked by #1.");
  });

  it("should replace the edge of a pair by the one put over it, whichever ticket each names first", () => {
    const overlap: ScheduleEdge = { repository: SHOP, a: url(101), b: url(102), kind: "overlap", reason: "Same file." };
    const other: ScheduleEdge = { repository: SHOP, a: url(103), b: url(104), kind: "overlap", reason: "Same file." };
    const stated = linkEdges(SHOP, url(102), { blockedBy: [url(101)], blocks: [] }, [url(101)])[0]!;
    expect(overlayEdges([overlap, other], [stated])).toEqual([stated, other]);
  });
});
