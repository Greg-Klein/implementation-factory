import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { deliveryProjects, originProject, projectPath, readProposalSnapshot } from "../../server/domain";

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "impl-delivery-")));
process.env.IMPL_SEARCH_ROOTS = root;

afterAll(() => rmSync(root, { recursive: true, force: true }));

const supportTicket = "https://gitlab.com/acme/support/-/work_items/7";

function checkout(name: string, remote: string) {
  const directory = path.join(root, name);
  mkdirSync(directory, { recursive: true });
  execFileSync("git", ["-C", directory, "init", "-q", "-b", "main"]);
  execFileSync("git", ["-C", directory, "remote", "add", "origin", remote]);
  execFileSync("git", ["-C", directory, "-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "--allow-empty", "-m", "init"]);
  return directory;
}

describe("the project a checkout pushes to", () => {
  it("should read the origin remote before any other", () => {
    const config = '[core]\n\tbare = false\n[remote "fork"]\n\turl = git@gitlab.com:me/shop.git\n[remote "origin"]\n\turl = https://gitlab.com/acme/shop.git\n';
    expect(originProject(config)).toBe("acme/shop");
  });

  it("should fall back on the first remote when there is no origin", () => {
    expect(originProject('[remote "upstream"]\n\turl = git@gitlab.com:acme/app/material.git\n')).toBe("acme/app/material");
    expect(originProject("[core]\n\tbare = false\n")).toBeUndefined();
  });
});

describe("the projects a ticket is delivered in", () => {
  it("should say nothing when the only merge request goes to the ticket's own project", () => {
    expect(deliveryProjects("https://gitlab.com/acme/shop/-/issues/3", ["acme/shop"])).toBeUndefined();
    expect(deliveryProjects("https://gitlab.com/acme/shop/-/issues/3", ["Acme/Shop"])).toBeUndefined();
  });

  it("should name the project when the ticket lives in another one", () => {
    expect(deliveryProjects(supportTicket, ["acme/shop"])).toEqual(["acme/shop"]);
  });

  it("should name every project when there are several, the ticket's own included", () => {
    expect(deliveryProjects("https://gitlab.com/acme/shop/-/issues/3", ["acme/shop", "acme/api", "acme/shop"])).toEqual(["acme/shop", "acme/api"]);
  });

  it("should say nothing when no project could be read", () => {
    expect(deliveryProjects(supportTicket, [undefined])).toBeUndefined();
  });
});

describe("the repositories a watcher names for a ticket", () => {
  it("should keep the plain project paths and drop the rest", () => {
    expect(projectPath(" acme/app/material/ ")).toBe("acme/app/material");
    expect(projectPath("material")).toBeUndefined();
    expect(projectPath("acme/../etc")).toBeUndefined();
    expect(projectPath("--upload-pack=x/y z")).toBeUndefined();
    expect(readProposalSnapshot({ tickets: [{ url: supportTicket, repositories: ["acme/shop", "acme/shop", "nope", 4] }, { url: "https://gitlab.com/acme/shop/-/issues/1", repositories: [] }] }))
      .toEqual([{ issueUrl: supportTicket, repositories: ["acme/shop"] }, { issueUrl: "https://gitlab.com/acme/shop/-/issues/1" }]);
  });
});

describe("resolving tickets to the checkouts their merge requests go to", () => {
  let shop: string;
  let api: string;
  beforeAll(() => {
    shop = checkout("shop", "https://gitlab.com/acme/shop.git");
    api = checkout("api", "git@gitlab.com:acme/api.git");
  });

  it("should send back a ticket with no checkout instead of refusing the batch", async () => {
    const { resolvePastedTickets } = await import("../../server/ticket-source");
    await expect(resolvePastedTickets([supportTicket, "https://gitlab.com/acme/shop/-/issues/3"])).resolves.toEqual({
      resolved: [{ issueUrl: "https://gitlab.com/acme/shop/-/issues/3", repository: shop }],
      unresolved: [{ issueUrl: supportTicket, project: "acme/support" }],
    });
  });

  it("should give one entry per chosen checkout, each told of every project", async () => {
    const { resolvePastedTickets } = await import("../../server/ticket-source");
    const { resolved, unresolved } = await resolvePastedTickets([supportTicket], { [`${supportTicket}?tab=notes`]: [shop, api, shop] });
    expect(unresolved).toEqual([]);
    expect(resolved).toEqual([
      { issueUrl: supportTicket, repository: shop, deliveries: ["acme/shop", "acme/api"] },
      { issueUrl: supportTicket, repository: api, deliveries: ["acme/shop", "acme/api"] },
    ]);
  });

  it("should resolve the projects a watcher named, with the base it named", async () => {
    const { resolveProposedTickets } = await import("../../server/ticket-source");
    await expect(resolveProposedTickets([{ issueUrl: supportTicket, repositories: ["acme/api"], baseBranch: "develop" }, { issueUrl: "https://gitlab.com/acme/other/-/issues/1", repositories: ["acme/missing"] }])).resolves.toEqual({
      resolved: [{ issueUrl: supportTicket, repository: api, baseBranch: "develop", deliveries: ["acme/api"] }],
      refused: [{ issueUrl: "https://gitlab.com/acme/other/-/issues/1", reason: "No checkout found for acme/missing. Add its root to IMPL_SEARCH_ROOTS." }],
    });
  });
});
