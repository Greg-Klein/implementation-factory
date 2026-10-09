import { describe, expect, it } from "@jest/globals";
import { scheduleDirectory } from "../../server/domain";

describe("scheduleDirectory", () => {
  it("should leave the plugin when the data directory sits inside it", () => {
    expect(scheduleDirectory("/work/factory/console/data", "/work/factory", "/tmp", "ada")).toBe("/tmp/implementation-factory-ada/schedule");
  });

  it("should leave the plugin when the data directory is the plugin itself", () => {
    expect(scheduleDirectory("/work/factory", "/work/factory", "/tmp", "ada")).toBe("/tmp/implementation-factory-ada/schedule");
  });

  it("should keep a data directory that is outside the plugin", () => {
    expect(scheduleDirectory("/var/factory-data", "/work/factory", "/tmp", "ada")).toBe("/var/factory-data/schedule");
  });

  it("should not take a sibling whose name starts like the plugin for the plugin", () => {
    expect(scheduleDirectory("/work/factory-data", "/work/factory", "/tmp", "ada")).toBe("/work/factory-data/schedule");
  });
});
