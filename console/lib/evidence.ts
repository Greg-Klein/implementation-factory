import type { AcceptanceView, EvidenceItem, EvidenceReport, EvidenceSource, EvidenceVerdict } from "./types";

const VERDICTS: readonly EvidenceVerdict[] = ["pass", "fail", "not_run", "measured", "confirmed", "unverified"];
const SOURCES: readonly EvidenceSource[] = ["qa", "design", "developer"];

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** What can be written as text: an object or a list where a sentence was expected is left out, not printed as `[object Object]`. */
function scalar(value: unknown): string | undefined {
  return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : undefined;
}

function evidenceItem(value: unknown): EvidenceItem | undefined {
  const item = record(value);
  if (!item) return undefined;
  const optional = (key: "id" | "expected" | "actual" | "command" | "note" | "kind") => {
    const text = scalar(item[key]);
    return text === undefined ? {} : { [key]: text };
  };
  return {
    label: scalar(item.label) ?? "",
    // Looked up in a list, never used as a key: `constructor` is not a verdict.
    verdict: VERDICTS.find((verdict) => verdict === item.verdict) ?? "unverified",
    ...optional("id"), ...optional("kind"), ...optional("expected"), ...optional("actual"), ...optional("command"), ...optional("note"),
    ...(typeof item.screenshot === "string" ? { screenshot: item.screenshot } : {}),
    ...(Array.isArray(item.attachments) ? { attachments: item.attachments } : {}),
  };
}

/**
 * An evidence file is written by an agent and served as it is: the page draws
 * only what this returns. Whatever is not an object is dropped, a number or a
 * boolean where text is drawn becomes text, and an unknown verdict reads as
 * unverified, as the coverage computed by the server already reads it.
 */
export function normalizeEvidenceReport(value: unknown): EvidenceReport {
  const report = record(value);
  if (!report) return { items: [] };
  const source = SOURCES.find((entry) => entry === report.source);
  const status = scalar(report.status);
  return {
    ...(source ? { source } : {}),
    ...(status !== undefined ? { status } : {}),
    items: Array.isArray(report.items) ? report.items.flatMap((entry) => evidenceItem(entry) ?? []) : [],
  };
}

/**
 * The coverage is computed and validated by the server, but an archived run
 * serves the one an older console stored: without the lists and the counts the
 * panel reads on every render, it is no coverage at all.
 */
export function readAcceptanceView(value: unknown): AcceptanceView | undefined {
  const view = record(value);
  if (!view || !record(view.counts) || typeof view.sentence !== "string") return undefined;
  const lists = [view.criteria, view.general, view.generalHistory, view.diagnostics, view.reports];
  return lists.every((list) => Array.isArray(list) && list.every((entry) => record(entry))) ? view as AcceptanceView : undefined;
}
