import { describe, expect, it } from "@jest/globals";
import { defined } from "../../lib/defined";

describe("defined", () => {
  it("should drop the properties left undefined", () => {
    const kept = defined({ title: "Ticket", detail: undefined });
    expect(kept).toStrictEqual({ title: "Ticket" });
    expect("detail" in kept).toBe(false);
  });

  it("should keep the values that are empty without being undefined", () => {
    expect(defined({ text: "", count: 0, flag: false, nothing: null })).toStrictEqual({ text: "", count: 0, flag: false, nothing: null });
  });
});
