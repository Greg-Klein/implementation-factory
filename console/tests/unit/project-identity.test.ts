import { describe, expect, it } from "@jest/globals";
import { remoteProjectIdentity, sameProject, ticketProjectIdentity } from "../../server/project-identity";
import { deliveryProjects } from "../../server/domain";
import { detectProjectDirectory } from "../../server/repository";

describe("project identity", () => {
  it("should distinguish the same project path on different servers", () => {
    const github = remoteProjectIdentity("git@github.com:team/app.git")!;
    const gitlab = remoteProjectIdentity("https://gitlab.example.com/team/app.git")!;
    expect(sameProject(github, gitlab)).toBe(false);
    expect(sameProject(github, remoteProjectIdentity("ssh://git@github.com/team/app.git")!)).toBe(true);
    expect(deliveryProjects("https://github.com/team/app/issues/1", [gitlab])).toEqual(["https://gitlab.example.com/team/app"]);
  });
  it("should resolve a private forge from its ticket without guessing the product from its hostname", () => {
    expect(sameProject(remoteProjectIdentity("git@code.example.com:team/app.git")!, ticketProjectIdentity("https://code.example.com/team/app/-/issues/1")!)).toBe(true);
  });
  it("should require one identified checkout and never select an ambiguous or legacy row", async () => {
    const identity = remoteProjectIdentity("git@github.com:team/app.git")!;
    const row = { project: "team/app", identity, path: "/a", resolvedPath: "/a", exists: true };
    const ticket = "https://github.com/team/app/issues/1";
    await expect(detectProjectDirectory(ticket, [row])).resolves.toMatchObject({ path: "/a" });
    await expect(detectProjectDirectory(ticket, [row, { ...row, path: "/b" }])).resolves.toBeUndefined();
    const { identity: _identity, ...legacy } = row;
    await expect(detectProjectDirectory(ticket, [legacy])).resolves.toBeUndefined();
  });
});
