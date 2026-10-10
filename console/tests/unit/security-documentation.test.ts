import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CHECK_IMAGE } from "../../server/isolated-checks";

describe("documented security defaults", () => {
  it("should describe automatic promotion, its opt-out and the required check image", () => {
    const security = readFileSync(path.resolve(process.cwd(), "../SECURITY.md"), "utf8");
    const example = readFileSync(path.resolve(process.cwd(), "../.env.example"), "utf8");
    expect(security).toContain("Automatic improvement and promotion are enabled by default.");
    expect(security).toContain("IMPL_SELF_IMPROVEMENT_AUTORUN=false");
    expect(security).not.toContain("There is no autonomous promotion");
    expect(security).toContain(CHECK_IMAGE);
    expect(example).toContain(`IMPL_CHECK_IMAGE='${CHECK_IMAGE}'`);
    expect(example).toContain("IMPL_SELF_IMPROVEMENT_AUTORUN='true'");
  });
});
