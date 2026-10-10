import { describe, expect, it } from "@jest/globals";
import { containerArguments, checkSteps } from "../../server/isolated-checks";
import { autoMergeBlockers } from "../../server/auto-merge-policy";

describe("isolated improvement checks", () => {
  it("should start without host mounts, privileges or forwarded environment", () => {
    const args = containerArguments("isolated", "trusted-image");
    expect(args).toEqual(expect.arrayContaining(["--network", "bridge", "--read-only", "--cap-drop", "ALL", "no-new-privileges", "--user", "1000:1000", "--memory", "4g", "--pids-limit", "256"]));
    for (const flag of ["--mount", "--volume", "--env", "--env-file", "--privileged", "--publish", "--use-api-socket"]) expect(args).not.toContain(flag);
  });
  it("should use trusted executable commands rather than candidate package scripts", () => {
    const steps = checkSteps(true);
    expect(steps.some((step) => step.args.includes("run"))).toBe(false);
    expect(steps[0]?.args).toEqual(["npm", "rebuild", "--offline"]);
    expect(steps.at(-1)?.args).toEqual(["node_modules/.bin/playwright", "test"]);
  });
  it("should protect the runner, dependency definitions and check configuration", () => {
    for (const file of ["console/server/isolated-checks.ts", "console/package.json", "console/package-lock.json", "console/jest.config.cjs", "console/playwright.config.ts", "console/scripts/postinstall.mjs"]) {
      expect(autoMergeBlockers([{ status: "M", path: file, added: 1, removed: 1 }], "")[0]).toContain("protected");
    }
  });
});
