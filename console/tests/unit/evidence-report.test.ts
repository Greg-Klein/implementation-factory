import { describe, expect, it } from "@jest/globals";

import { normalizeEvidenceReport, readAcceptanceView } from "../../lib/evidence";

describe("an evidence report as the page draws it", () => {
  it("should keep a well-formed report as it was written", () => {
    expect(normalizeEvidenceReport({
      schemaVersion: 2, source: "qa", status: "PASS_WITH_WARNINGS",
      items: [{ id: "QA-1", label: "The filter keeps its value", verdict: "pass", expected: "status=open", actual: "status=open", command: "npm test", note: "Second round", kind: "attempt", screenshot: "assets/filter.png", attachments: ["assets/list.png", { path: "assets/detail.png" }] }],
    })).toEqual({
      source: "qa", status: "PASS_WITH_WARNINGS",
      items: [{ id: "QA-1", label: "The filter keeps its value", verdict: "pass", expected: "status=open", actual: "status=open", command: "npm test", note: "Second round", kind: "attempt", screenshot: "assets/filter.png", attachments: ["assets/list.png", { path: "assets/detail.png" }] }],
    });
  });

  it("should drop the entries of items that are not objects", () => {
    expect(normalizeEvidenceReport({ items: [null, "pass", 3, ["nested"], { label: "Kept", verdict: "fail" }] })).toEqual({ items: [{ label: "Kept", verdict: "fail" }] });
  });

  it("should leave out an object written where a text is drawn", () => {
    expect(normalizeEvidenceReport({ source: { name: "qa" }, status: { value: "PASS" }, items: [{ label: { text: "Login" }, verdict: "pass", expected: { code: 200 }, actual: ["200"], note: null, screenshot: 4, attachments: "assets/a.png" }] }))
      .toEqual({ items: [{ label: "", verdict: "pass" }] });
  });

  it("should write a number or a boolean as text", () => {
    expect(normalizeEvidenceReport({ status: 5, items: [{ id: 12, label: 404, verdict: "measured", expected: 200, actual: false }] }))
      .toEqual({ status: "5", items: [{ id: "12", label: "404", verdict: "measured", expected: "200", actual: "false" }] });
  });

  it("should read a verdict it does not know as unverified, a name every object carries included", () => {
    expect(normalizeEvidenceReport({ items: [{ label: "A", verdict: "constructor" }, { label: "B", verdict: 1 }, { label: "C" }, { label: "D", verdict: "not_run" }] }).items.map((item) => item.verdict))
      .toEqual(["unverified", "unverified", "unverified", "not_run"]);
  });

  it("should read a file that holds no report as a report with no item", () => {
    expect(normalizeEvidenceReport(null)).toEqual({ items: [] });
    expect(normalizeEvidenceReport(["pass"])).toEqual({ items: [] });
    expect(normalizeEvidenceReport({ source: "design", items: { first: {} } })).toEqual({ source: "design", items: [] });
  });
});

describe("the coverage as the server answers it", () => {
  const view = { available: true, updatedAt: "2026-10-06T08:00:00.000Z", counts: { total: 1, verified: 1, failed: 0, blocked: 0, unverified: 0, stale: 0 }, sentence: "1 of 1 criterion verified.", criteria: [{ id: "AC1" }], general: [], generalHistory: [], diagnostics: [], reports: [] };

  it("should hand back a view that holds its lists and its counts", () => {
    expect(readAcceptanceView(view)).toBe(view);
  });

  it("should refuse a view with a list missing, a list of something else or no counts", () => {
    expect(readAcceptanceView({ ...view, generalHistory: undefined })).toBeUndefined();
    expect(readAcceptanceView({ ...view, criteria: [null] })).toBeUndefined();
    expect(readAcceptanceView({ ...view, counts: null })).toBeUndefined();
    expect(readAcceptanceView("unavailable")).toBeUndefined();
  });
});
