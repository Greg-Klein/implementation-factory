import { describe, expect, it } from "@jest/globals";
import { deliveryEndpoint, deliveryStatus, mergeRequestStatus, mergeWatchStep, type MergeRequestStatus } from "../../server/domain";
import { MergeWatcher } from "../../server/merge-watch";
import type { MergeWatch } from "../../server/types";

const watch = (iid: number, overrides: Partial<MergeWatch> = {}): MergeWatch => ({
  issueUrl: `https://gitlab.com/acme/shop/-/issues/${100 + iid}`, repository: "/work/shop", mergeRequestUrl: `https://gitlab.com/acme/shop/-/merge_requests/${iid}`,
  branch: `feat/${100 + iid}`, state: "open", since: "2026-10-01T10:00:00.000Z", ...overrides,
});
const AT = "2026-10-01T10:05:00.000Z";

describe("the merge request a watch asks about", () => {
  it("should be named by its API path, its host and its number", () => {
    expect(deliveryEndpoint("https://gitlab.example.com/group/platform/repo/-/merge_requests/12#note_1")).toEqual({ forge: "gitlab", hostname: "gitlab.example.com", path: "projects/group%2Fplatform%2Frepo/merge_requests/12", number: "12" });
  });

  it("should be a pull request, asked to GitHub, when the address is one", () => {
    expect(deliveryEndpoint("https://github.com/acme/shop/pull/12#issuecomment-1")).toEqual({ forge: "github", hostname: "github.com", path: "repos/acme/shop/pulls/12", number: "12" });
    expect(deliveryEndpoint("https://github.example.com/acme/shop/pull/7/files")).toEqual({ forge: "github", hostname: "github.example.com", path: "repos/acme/shop/pulls/7", number: "7" });
  });

  it("should not be asked about when the address is neither a merge request nor a pull request", () => {
    expect(deliveryEndpoint("ticket-simule://acme-dashboard/-/merge_requests/128")).toBeUndefined();
    expect(deliveryEndpoint("https://gitlab.com/acme/shop/-/issues/12")).toBeUndefined();
    expect(deliveryEndpoint("https://github.com/acme/shop/issues/12")).toBeUndefined();
    expect(deliveryEndpoint("pas une url")).toBeUndefined();
  });

  it("should read the state GitLab gives", () => {
    expect(mergeRequestStatus("merged")).toBe("merged");
    expect(mergeRequestStatus("closed")).toBe("closed");
    expect(mergeRequestStatus("opened")).toBe("opened");
    // A merge in progress is not merged yet.
    expect(mergeRequestStatus("locked")).toBe("opened");
    expect(mergeRequestStatus(undefined)).toBe("unknown");
    expect(mergeRequestStatus("something new")).toBe("unknown");
  });

  it("should read the state GitHub gives, where a merge is a closing with `merged`", () => {
    expect(deliveryStatus("github", { state: "open", merged: false })).toBe("opened");
    expect(deliveryStatus("github", { state: "closed", merged: true })).toBe("merged");
    expect(deliveryStatus("github", { state: "closed", merged: false })).toBe("closed");
    // Closed with no word on the merge: holding is the safe reading.
    expect(deliveryStatus("github", { state: "closed" })).toBe("unknown");
    expect(deliveryStatus("github", {})).toBe("unknown");
    expect(deliveryStatus("gitlab", { state: "merged" })).toBe("merged");
  });
});

describe("what a watch becomes once GitLab answered", () => {
  it("should release what it holds once merged", () => {
    expect(mergeWatchStep(watch(1), "merged", AT)).toEqual({ released: "merged" });
  });

  it("should release what it holds when closed without a merge", () => {
    expect(mergeWatchStep(watch(1), "closed", AT)).toEqual({ released: "closed" });
  });

  it("should keep holding while the merge request is open", () => {
    expect(mergeWatchStep(watch(1, { state: "unknown" }), "opened", AT)).toEqual({ watch: watch(1, { state: "open", checkedAt: AT }) });
  });

  it("should keep holding, as unknown, when GitLab could not be asked", () => {
    expect(mergeWatchStep(watch(1), "unknown", AT)).toEqual({ watch: watch(1, { state: "unknown", checkedAt: AT }) });
  });
});

/** A watcher on a clock and a GitLab the test controls. */
function watcher(held: MergeWatch[], answers: Record<string, MergeRequestStatus | Error>) {
  const clock = { now: 0 };
  const asked: string[] = [];
  const applied: [string, MergeRequestStatus][] = [];
  const instance = new MergeWatcher({
    held: () => held,
    check: async (entry) => {
      asked.push(entry.mergeRequestUrl);
      const answer = answers[entry.mergeRequestUrl] ?? "opened";
      if (answer instanceof Error) throw answer;
      return answer;
    },
    apply: (entry, status) => {
      applied.push([entry.mergeRequestUrl, status]);
      // The owner drops a watch that is over, as the registry does.
      if (status === "merged" || status === "closed") held.splice(held.indexOf(entry), 1);
    },
    intervalMs: 60_000,
    now: () => clock.now,
  });
  return { instance, clock, asked, applied };
}

describe("the timer that asks GitLab", () => {
  it("should not run while nothing is held", () => {
    const { instance, asked } = watcher([], {});
    instance.sync();
    expect(instance.running).toBe(false);
    expect(asked).toEqual([]);
  });

  it("should run while something is held, ask at once, and stop when nothing is", async () => {
    const held = [watch(1)];
    const { instance, asked } = watcher(held, {});
    instance.sync();
    expect(instance.running).toBe(true);
    await instance.tick();
    expect(asked).toEqual([watch(1).mergeRequestUrl]);
    held.length = 0;
    instance.sync();
    expect(instance.running).toBe(false);
  });

  it("should ask about a merge request once per interval, however often the queue changes", async () => {
    const { instance, clock, asked } = watcher([watch(1)], {});
    await instance.tick();
    clock.now = 30_000;
    instance.sync();
    await instance.tick();
    expect(asked).toHaveLength(1);
    clock.now = 60_000;
    await instance.tick();
    expect(asked).toHaveLength(2);
    instance.stop();
  });

  it("should hand every answer to its owner, and stop asking about a merged one", async () => {
    const held = [watch(1), watch(2)];
    const { instance, clock, asked, applied } = watcher(held, { [watch(1).mergeRequestUrl]: "merged" });
    await instance.tick();
    expect(applied).toEqual([[watch(1).mergeRequestUrl, "merged"], [watch(2).mergeRequestUrl, "opened"]]);
    clock.now = 60_000;
    await instance.tick();
    expect(asked.filter((url) => url === watch(1).mergeRequestUrl)).toHaveLength(1);
    expect(asked.filter((url) => url === watch(2).mergeRequestUrl)).toHaveLength(2);
  });

  it("should read a failing glab as an unknown state, and ask again at the next interval", async () => {
    const answers: Record<string, MergeRequestStatus | Error> = { [watch(1).mergeRequestUrl]: new Error("glab: command not found") };
    const { instance, clock, applied } = watcher([watch(1)], answers);
    await instance.tick();
    expect(applied).toEqual([[watch(1).mergeRequestUrl, "unknown"]]);
    answers[watch(1).mergeRequestUrl] = "merged";
    clock.now = 60_000;
    await instance.tick();
    expect(applied.at(-1)).toEqual([watch(1).mergeRequestUrl, "merged"]);
  });

  it("should ask at once about a watch that becomes held between two rounds", async () => {
    const held = [watch(1)];
    const { instance, clock, asked } = watcher(held, {});
    await instance.tick();
    clock.now = 10_000;
    held.push(watch(2));
    await instance.tick();
    expect(asked).toEqual([watch(1).mergeRequestUrl, watch(2).mergeRequestUrl]);
  });
});
