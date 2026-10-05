import { describe, expect, it } from "@jest/globals";
import { scheduleInput, validateSchedule } from "../../server/domain";

// Every ticket here is invented, as contracts/schedule.md requires of its own examples.
const url = (iid: number) => `https://gitlab.com/acme/shop/-/issues/${iid}`;
const input = { tickets: [url(101), url(102), url(103)], known: [url(98)] };
const prediction = (iid: number, overrides: Record<string, unknown> = {}) => ({ issue_url: url(iid), areas: [], files: [`src/${iid}.ts`], confidence: "high", summary: `Ticket ${iid}.`, ...overrides });
const output = (overrides: Record<string, unknown> = {}) => ({ tickets: [prediction(101), prediction(102), prediction(103)], edges: [], ...overrides });
const error = (value: unknown) => {
  const result = validateSchedule(input, value);
  return result.ok ? undefined : result.error;
};

describe("the input file of a scheduling session", () => {
  it("should list the language, the new tickets and the known predictions with their state", () => {
    expect(scheduleInput("/work/shop", "fr", [url(101)], [{ state: "running", ticket: { issueUrl: url(98), repository: "/work/shop", analysis: "done", areas: ["src/checkout"], files: ["src/checkout/cart.tsx"], confidence: "high", summary: "Récapitulatif du panier." } }])).toEqual({
      repository: "/work/shop",
      language: "fr",
      tickets: [{ issue_url: url(101) }],
      known: [{ issue_url: url(98), areas: ["src/checkout"], files: ["src/checkout/cart.tsx"], state: "running" }],
    });
  });
});

describe("the output file of a scheduling session", () => {
  it("should be accepted when it follows the contract", () => {
    const result = validateSchedule(input, output({ edges: [
      { a: url(101), b: url(98), kind: "overlap", reason: "Les deux tickets modifient le panier." },
      { a: url(101), b: url(102), kind: "depends_on", order: [url(102), url(101)], reason: "Le premier lit ce que le second calcule." },
    ] }));
    expect(result).toEqual({ ok: true, schedule: {
      tickets: [101, 102, 103].map((iid) => ({ issueUrl: url(iid), areas: [], files: [`src/${iid}.ts`], confidence: "high", summary: `Ticket ${iid}.` })),
      edges: [
        { a: url(101), b: url(98), kind: "overlap", reason: "Les deux tickets modifient le panier." },
        { a: url(101), b: url(102), kind: "depends_on", order: [url(102), url(101)], reason: "Le premier lit ce que le second calcule." },
      ],
    } });
  });

  it("should accept an empty batch", () => {
    expect(validateSchedule({ tickets: [], known: [] }, { tickets: [], edges: [] })).toEqual({ ok: true, schedule: { tickets: [], edges: [] } });
  });

  it("should be refused when it is not an object holding the two arrays", () => {
    expect(error(undefined)).toBeDefined();
    expect(error([])).toBeDefined();
    expect(error({ tickets: [] })).toMatch(/array/);
    expect(error({ edges: [] })).toMatch(/array/);
  });

  it("should be refused when a ticket is unknown, missing or repeated", () => {
    expect(error(output({ tickets: [prediction(101), prediction(102), prediction(104)] }))).toMatch(/not in the input/);
    expect(error(output({ tickets: [prediction(101), prediction(102), prediction(98)] }))).toMatch(/not in the input/);
    expect(error(output({ tickets: [prediction(101), prediction(102)] }))).toMatch(/no prediction/);
    expect(error(output({ tickets: [prediction(101), prediction(101), prediction(102)] }))).toMatch(/twice/);
  });

  it("should be refused on a confidence outside the enum or an empty summary", () => {
    expect(error(output({ tickets: [prediction(101, { confidence: "certain" }), prediction(102), prediction(103)] }))).toMatch(/confidence/);
    expect(error(output({ tickets: [prediction(101, { summary: "  " }), prediction(102), prediction(103)] }))).toMatch(/summary is empty/);
  });

  it("should be refused when an edge names an unknown ticket, itself, or two known tickets", () => {
    const edge = (overrides: Record<string, unknown>) => output({ edges: [{ a: url(101), b: url(102), kind: "overlap", reason: "Shared file.", ...overrides }] });
    expect(error(edge({ b: url(404) }))).toMatch(/unknown ticket/);
    expect(error(edge({ b: url(101) }))).toMatch(/to itself/);
    expect(validateSchedule({ tickets: [url(101)], known: [url(98), url(99)] }, { tickets: [prediction(101)], edges: [{ a: url(98), b: url(99), kind: "overlap", reason: "Shared file." }] })).toMatchObject({ ok: false, error: expect.stringMatching(/already known/) });
  });

  it("should be refused on a kind outside the enum or an empty reason", () => {
    const edge = (overrides: Record<string, unknown>) => output({ edges: [{ a: url(101), b: url(102), kind: "overlap", reason: "Shared file.", ...overrides }] });
    expect(error(edge({ kind: "blocks" }))).toMatch(/edge kind/);
    expect(error(edge({ reason: "" }))).toMatch(/reason is empty/);
  });

  it("should be refused when a dependency has no valid order, or an overlap carries one", () => {
    const edge = (overrides: Record<string, unknown>) => output({ edges: [{ a: url(101), b: url(102), kind: "depends_on", reason: "Needs the result.", ...overrides }] });
    expect(error(edge({}))).toMatch(/no valid order/);
    expect(error(edge({ order: [url(101)] }))).toMatch(/no valid order/);
    expect(error(edge({ order: [url(101), url(103)] }))).toMatch(/no valid order/);
    expect(error(edge({ order: [url(101), url(101)] }))).toMatch(/no valid order/);
    expect(error(edge({ kind: "overlap", order: [url(101), url(102)] }))).toMatch(/overlap carries an order/);
    expect(validateSchedule(input, edge({ order: [url(102), url(101)] })).ok).toBe(true);
  });

  it("should be refused when two edges link the same pair, whichever is `a`", () => {
    expect(error(output({ edges: [
      { a: url(101), b: url(102), kind: "overlap", reason: "Shared file." },
      { a: url(102), b: url(101), kind: "depends_on", order: [url(101), url(102)], reason: "Needs the result." },
    ] }))).toMatch(/same pair/);
  });
});
