import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchMergeRequestStatus } from "../../server/ticket";

/**
 * The one call the server makes to a forge on its own, through the stand-in
 * `glab` and `gh` of tests/fake-claude: the right CLI for the address, and the
 * answer of each read the way that forge writes it. No real forge is reached.
 */
const storage = mkdtempSync(path.join(os.tmpdir(), "harness-forge-"));
const glabDirectory = path.join(storage, "glab");
const ghDirectory = path.join(storage, "gh");
const savedPath = process.env.PATH;

beforeAll(() => {
  mkdirSync(glabDirectory);
  mkdirSync(ghDirectory);
  process.env.FAKE_GLAB_DIR = glabDirectory;
  process.env.FAKE_GH_DIR = ghDirectory;
  process.env.PATH = `${path.resolve(__dirname, "..", "fake-claude")}${path.delimiter}${process.env.PATH ?? ""}`;
});
afterAll(() => {
  process.env.PATH = savedPath;
  delete process.env.FAKE_GLAB_DIR;
  delete process.env.FAKE_GH_DIR;
  rmSync(storage, { recursive: true, force: true });
});

const pullRequest = (number: number) => `https://github.com/acme/shop/pull/${number}`;
const mergeRequest = (iid: number) => `https://gitlab.com/acme/shop/-/merge_requests/${iid}`;

describe("the state of what delivers a ticket, asked to its forge", () => {
  it("should ask gh about a pull request and read a merge out of a closed one", async () => {
    writeFileSync(path.join(ghDirectory, "pull-request-1"), "open");
    writeFileSync(path.join(ghDirectory, "pull-request-2"), "merged");
    writeFileSync(path.join(ghDirectory, "pull-request-3"), "closed");
    expect(await fetchMergeRequestStatus(pullRequest(1), storage)).toBe("opened");
    expect(await fetchMergeRequestStatus(pullRequest(2), storage)).toBe("merged");
    expect(await fetchMergeRequestStatus(pullRequest(3), storage)).toBe("closed");
  });

  it("should ask glab about a merge request", async () => {
    writeFileSync(path.join(glabDirectory, "merge-request-1"), "merged");
    expect(await fetchMergeRequestStatus(mergeRequest(1), storage)).toBe("merged");
  });

  it("should never ask one forge about the other's address", async () => {
    // The same number exists on the other side: an answer here would mean the wrong CLI was called.
    writeFileSync(path.join(glabDirectory, "merge-request-9"), "merged");
    expect(await fetchMergeRequestStatus(pullRequest(9), storage)).toBe("unknown");
  });

  it("should answer unknown when the forge says nothing", async () => {
    expect(await fetchMergeRequestStatus(pullRequest(404), storage)).toBe("unknown");
    expect(await fetchMergeRequestStatus(mergeRequest(404), storage)).toBe("unknown");
  });
});
