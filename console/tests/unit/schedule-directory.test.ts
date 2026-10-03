import { describe, expect, it } from "@jest/globals";
import { scheduleDirectory } from "../../server/domain";

describe("scheduleDirectory", () => {
  it("should leave the plugin when the data directory sits inside it", () => {
    expect(scheduleDirectory("/work/harness/console/data", "/work/harness", "/tmp", "ada")).toBe("/tmp/implementation-harness-ada/schedule");
  });

  it("should leave the plugin when the data directory is the plugin itself", () => {
    expect(scheduleDirectory("/work/harness", "/work/harness", "/tmp", "ada")).toBe("/tmp/implementation-harness-ada/schedule");
  });

  it("should keep a data directory that is outside the plugin", () => {
    expect(scheduleDirectory("/var/harness-data", "/work/harness", "/tmp", "ada")).toBe("/var/harness-data/schedule");
  });

  it("should not take a sibling whose name starts like the plugin for the plugin", () => {
    expect(scheduleDirectory("/work/harness-data", "/work/harness", "/tmp", "ada")).toBe("/work/harness-data/schedule");
  });
});
