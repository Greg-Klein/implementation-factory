import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchIssueLinks, fetchMergeRequestStatus } from "../../server/ticket";

/**
 * The one call the server makes to a forge on its own, through the stand-in
 * `glab` and `gh` of tests/fake-claude: the right CLI for the address, and the
 * answer of each read the way that forge writes it. No real forge is reached.
 */
const storage = mkdtempSync(path.join(os.tmpdir(), "factory-forge-"));
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

describe("the blocking links of a ticket, asked to its forge", () => {
  it("should read both directions out of the one list GitLab answers, and leave a plain relation out", async () => {
    writeFileSync(path.join(glabDirectory, "issue-links-7"), JSON.stringify([
      { iid: 5, link_type: "is_blocked_by", web_url: "https://gitlab.com/acme/shop/-/issues/5" },
      { iid: 8, link_type: "blocks", web_url: "https://gitlab.com/acme/shop/-/issues/8" },
      { iid: 9, link_type: "relates_to", web_url: "https://gitlab.com/acme/shop/-/issues/9" },
    ]));
    expect(await fetchIssueLinks("https://gitlab.com/acme/shop/-/work_items/7", storage)).toEqual({
      blockedBy: ["https://gitlab.com/acme/shop/-/issues/5"], blocks: ["https://gitlab.com/acme/shop/-/issues/8"],
    });
  });

  it("should ask GitHub for each direction", async () => {
    writeFileSync(path.join(ghDirectory, "issue-7-blocked_by"), JSON.stringify([{ number: 5, html_url: "https://github.com/acme/shop/issues/5" }]));
    writeFileSync(path.join(ghDirectory, "issue-7-blocking"), JSON.stringify([{ number: 8, html_url: "https://github.com/acme/shop/issues/8" }]));
    expect(await fetchIssueLinks("https://github.com/acme/shop/issues/7", storage)).toEqual({
      blockedBy: ["https://github.com/acme/shop/issues/5"], blocks: ["https://github.com/acme/shop/issues/8"],
    });
  });

  it("should answer nothing rather than no link when the forge cannot be read", async () => {
    expect(await fetchIssueLinks("https://gitlab.com/acme/shop/-/issues/404", storage)).toBeUndefined();
    // One direction answered is not the whole answer.
    writeFileSync(path.join(ghDirectory, "issue-12-blocked_by"), "[]");
    expect(await fetchIssueLinks("https://github.com/acme/shop/issues/12", storage)).toBeUndefined();
  });
});

describe("the call the console makes to a forge", () => {
  const calls = (directory: string) => readFileSync(path.join(directory, "calls.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);

  it("should name the host of the address and the one endpoint, and nothing else", async () => {
    writeFileSync(path.join(glabDirectory, "merge-request-41"), "merged");
    expect(await fetchMergeRequestStatus("https://gitlab.example.com/group/platform/repo/-/merge_requests/41", storage)).toBe("merged");
    expect(calls(glabDirectory).at(-1)).toEqual(["api", "--hostname", "gitlab.example.com", "projects/group%2Fplatform%2Frepo/merge_requests/41"]);

    writeFileSync(path.join(ghDirectory, "pull-request-41"), "open");
    expect(await fetchMergeRequestStatus("https://github.example.com/acme/shop/pull/41", storage)).toBe("opened");
    expect(calls(ghDirectory).at(-1)).toEqual(["api", "--hostname", "github.example.com", "repos/acme/shop/pulls/41"]);
  });

  it("should not let an address put an option in front of the endpoint", async () => {
    writeFileSync(path.join(glabDirectory, "merge-request-42"), "opened");
    // Whatever the project is called, it stays one argument: the endpoint.
    expect(await fetchMergeRequestStatus("https://gitlab.com/--method/DELETE/-/merge_requests/42", storage)).toBe("opened");
    expect(calls(glabDirectory).at(-1)).toEqual(["api", "--hostname", "gitlab.com", "projects/--method%2FDELETE/merge_requests/42"]);
  });
});
