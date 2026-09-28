import { describe, expect, it } from "@jest/globals";
import {
  coverageSentence, deriveAcceptanceCoverage, parseCriteriaRegistry, parseEvidenceReport, parsePlanLinks, renderAcceptanceSummary,
  type CoverageInput, type EvidenceRecord, type ParsedReport,
} from "../../server/acceptance";
import type { AcceptanceReportVersion } from "../../server/types";

const NOW = "2026-09-27T10:00:00.000Z";
const CURRENT = "snap-current";
const OLD = "snap-old";

const registryJson = {
  schemaVersion: 1,
  revision: 1,
  criteria: [
    { id: "AC1", text: "Le filtre garde sa valeur au retour", source: { kind: "ticket", excerpt: "Conserver le filtre" }, verification: { expected: "Dernière valeur", requiredChecks: [{ id: "AC1-C1", description: "Quitter puis revenir", method: "test" }] } },
    { id: "AC2", text: "Le formulaire reste utilisable à 200 %", verification: { requiredChecks: [{ id: "AC2-C1", description: "Zoom 200 %", method: "browser" }, { id: "AC2-C2", description: "Clavier seul", method: "browser" }] } },
    { id: "AC3", text: "Une erreur serveur est affichée" },
  ],
};

function registry(value: unknown = registryJson) {
  const parsed = parseCriteriaRegistry(value);
  if (!parsed.registry) throw new Error("registry expected");
  return parsed.registry;
}

let versionCounter = 0;
function report(file: string, value: Record<string, unknown>, version = 1): { version: AcceptanceReportVersion; records: EvidenceRecord[] } {
  versionCounter += 1;
  const parsed = parseEvidenceReport(value, { file, version, receivedAt: `2026-09-27T09:${String(versionCounter).padStart(2, "0")}:00.000Z`, hash: `h${versionCounter}` }, (source) => `evidence/${file}/v${version}/${source}`);
  if (!("records" in parsed)) throw new Error(`report expected: ${JSON.stringify(parsed.diagnostics)}`);
  const ok = parsed as ParsedReport;
  return { version: { file, version, receivedAt: NOW, hash: `h${versionCounter}`, source: ok.source, items: ok.records.length, current: true }, records: ok.records };
}

function qa(items: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return { schemaVersion: 2, source: "qa", criteriaRevision: 1, codeSnapshot: { atStart: CURRENT, atEnd: CURRENT }, items, ...extra };
}

function coverage(partial: Partial<CoverageInput>) {
  return deriveAcceptanceCoverage({ registry: registry(), reports: [], currentSnapshot: { id: CURRENT, capturedAt: NOW }, knownSnapshots: new Set([CURRENT, OLD]), now: NOW, ...partial });
}

function criterion(view: ReturnType<typeof coverage>, id: string) {
  const found = view.criteria.find((entry) => entry.id === id);
  if (!found) throw new Error(`criterion ${id} missing`);
  return found;
}

describe("acceptance criteria registry", () => {
  it("should keep identifiers, provenance and required checks", () => {
    const parsed = registry();
    expect(parsed.criteria.map((entry) => entry.id)).toEqual(["AC1", "AC2", "AC3"]);
    expect(parsed.criteria[0].source).toEqual({ kind: "ticket", excerpt: "Conserver le filtre" });
    expect(parsed.criteria[1].checks.map((check) => check.id)).toEqual(["AC2-C1", "AC2-C2"]);
  });

  it("should turn a criterion without checks into its own single check", () => {
    expect(registry().criteria[2].checks).toEqual([{ id: "AC3", description: "Une erreur serveur est affichée" }]);
  });

  it("should report duplicates and malformed entries without dropping the rest", () => {
    const parsed = parseCriteriaRegistry({ schemaVersion: 1, criteria: [{ id: "AC1", text: "a" }, { id: "AC1", text: "b" }, { text: "no id" }, { id: "AC2", text: "c" }] });
    expect(parsed.registry?.criteria.map((entry) => entry.id)).toEqual(["AC1", "AC2"]);
    expect(parsed.diagnostics.filter((entry) => entry.level === "error")).toHaveLength(2);
  });

  it("should warn on an unknown schema version and refuse a document without criteria", () => {
    expect(parseCriteriaRegistry({ schemaVersion: 9, criteria: [] }).diagnostics[0].level).toBe("warning");
    expect(parseCriteriaRegistry({ nope: true }).registry).toBeUndefined();
    expect(parseCriteriaRegistry(null).registry).toBeUndefined();
  });
});

describe("plan links", () => {
  it("should read criterion links, dependencies and the registry revision", () => {
    const plan = parsePlanLinks({ criteria_revision: 2, tasks: [{ id: "T1", title: "Store", criterion_ids: ["AC1"], dependencies: ["T0"] }] });
    expect(plan).toEqual({ criteriaRevision: 2, tasks: [{ id: "T1", title: "Store", criterionIds: ["AC1"], dependencies: ["T0"] }], legacyCriteria: [] });
  });

  it("should accept the historical plan without identifiers", () => {
    expect(parsePlanLinks({ acceptance_criteria: ["Given x"], tasks: [{ id: "T1" }] })?.legacyCriteria).toEqual(["Given x"]);
    expect(parsePlanLinks("nope")).toBeUndefined();
  });
});

describe("evidence reports", () => {
  it("should read the historical format as reported or observed results with no link", () => {
    const { records } = report("qa-evidence.json", { source: "qa", items: [{ label: "Lint", verdict: "pass", command: "npm run lint" }] });
    expect(records[0].view).toMatchObject({ label: "Lint", verdict: "pass", basis: "observed", criterionIds: [], freshness: "unknown" });
  });

  it("should call a developer's own evidence a reported result", () => {
    const { records } = report("dev-evidence-T1.json", { source: "developer", items: [{ id: "D1", label: "x", verdict: "measured", criterionIds: ["AC1"] }] });
    expect(records[0].view.basis).toBe("reported");
  });

  it("should reject an unreadable report and flag unknown verdicts", () => {
    expect("records" in parseEvidenceReport({ items: "x" }, { file: "qa-evidence.json", version: 1, receivedAt: NOW, hash: "h" })).toBe(false);
    const parsed = parseEvidenceReport({ source: "qa", items: [{ label: "x", verdict: "green" }, "junk"] }, { file: "qa-evidence.json", version: 1, receivedAt: NOW, hash: "h" }) as ParsedReport;
    expect(parsed.records[0].view.verdict).toBe("unverified");
    expect(parsed.diagnostics.map((entry) => entry.message).join(" ")).toContain("Verdict inconnu");
    expect(parsed.diagnostics).toHaveLength(2);
  });

  it("should flag an identifier used twice in one report", () => {
    const parsed = parseEvidenceReport(qa([{ id: "Q1", label: "a", verdict: "pass" }, { id: "Q1", label: "b", verdict: "pass" }]), { file: "qa-evidence.json", version: 1, receivedAt: NOW, hash: "h" }) as ParsedReport;
    expect(parsed.diagnostics.some((entry) => entry.message.includes("double"))).toBe(true);
  });

  it("should map attachments to their archived copy of that version", () => {
    const { records } = report("qa-evidence.json", qa([{ id: "Q1", label: "a", verdict: "pass", screenshot: "assets/result.png", attachments: ["assets/log.txt"] }]), 2);
    expect(records[0].view.attachments).toEqual([
      { source: "assets/result.png", path: "evidence/qa-evidence.json/v2/assets/result.png", archived: true },
      { source: "assets/log.txt", path: "evidence/qa-evidence.json/v2/assets/log.txt", archived: true },
    ]);
  });
});

describe("acceptance coverage", () => {
  it("should leave every criterion unverified when no evidence exists", () => {
    const view = coverage({});
    expect(view.counts).toMatchObject({ total: 3, verified: 0, unverified: 3 });
    expect(criterion(view, "AC1").checks[0].reasons).toContain("Aucune preuve ne couvre ce contrôle.");
  });

  it("should verify a criterion whose check passed on the current code", () => {
    const view = coverage({ reports: [report("qa-evidence.json", qa([{ id: "Q1", label: "Filtre conservé", verdict: "pass", checkIds: ["AC1-C1"] }]))] });
    expect(criterion(view, "AC1").status).toBe("verified");
  });

  it("should fail a criterion as soon as one current check fails", () => {
    const view = coverage({ reports: [report("qa-evidence.json", qa([{ id: "Q1", label: "Zoom", verdict: "pass", checkIds: ["AC2-C1"] }, { id: "Q2", label: "Clavier", verdict: "fail", actual: "focus perdu", checkIds: ["AC2-C2"] }]))] });
    expect(criterion(view, "AC2").status).toBe("failed");
    expect(criterion(view, "AC2").checks[1].reasons[0]).toContain("focus perdu");
  });

  it("should not let one passing check cover the others", () => {
    const view = coverage({ reports: [report("qa-evidence.json", qa([{ id: "Q1", label: "Zoom", verdict: "pass", checkIds: ["AC2-C1"] }]))] });
    expect(criterion(view, "AC2").status).toBe("unverified");
  });

  it("should mark a check blocked by an identified obstacle", () => {
    const view = coverage({ reports: [report("qa-evidence.json", qa([{ id: "Q1", label: "Erreur serveur", verdict: "not_run", criterionIds: ["AC3"], blocker: { reason: "Environnement de test inaccessible", action: "Fournir un compte" } }]))] });
    expect(criterion(view, "AC3").status).toBe("blocked");
    expect(criterion(view, "AC3").checks[0].reasons[0]).toContain("Environnement de test inaccessible");
  });

  it("should lift a blocker once another source reports a result on the same check", () => {
    const view = coverage({ reports: [
      report("dev-evidence.json", qa([{ id: "D1", label: "Erreur serveur", verdict: "not_run", criterionIds: ["AC3"], blocker: { reason: "Session requise", action: "Mesure déléguée au pilote" } }], { source: "developer", codeSnapshot: undefined })),
      report("qa-evidence.json", qa([{ id: "Q1", label: "Erreur serveur", verdict: "pass", criterionIds: ["AC3"] }], { codeSnapshot: undefined })),
    ] });
    expect(criterion(view, "AC3").status).toBe("unverified");
    expect(criterion(view, "AC3").checks[0].reasons.join(" ")).toContain("Version inconnue");
  });

  it("should put failure before blocking before incomplete coverage", () => {
    const view = coverage({ reports: [report("qa-evidence.json", qa([
      { id: "Q1", label: "Zoom", verdict: "not_run", checkIds: ["AC2-C1"], blocker: "Pas de navigateur" },
      { id: "Q2", label: "Clavier", verdict: "fail", checkIds: ["AC2-C2"] },
    ]))] });
    expect(criterion(view, "AC2").status).toBe("failed");
  });

  it("should not count a not-run check without a blocker as blocked", () => {
    const view = coverage({ reports: [report("qa-evidence.json", qa([{ id: "Q1", label: "Filtre", verdict: "not_run", actual: "pas lancé", checkIds: ["AC1-C1"] }]))] });
    expect(criterion(view, "AC1").status).toBe("unverified");
    expect(criterion(view, "AC1").checks[0].reasons[0]).toContain("Non exécuté");
  });

  it("should keep a green lint out of every functional criterion", () => {
    const view = coverage({ reports: [report("qa-evidence.json", qa([{ id: "G1", label: "Lint", verdict: "pass", command: "npm run lint" }]))] });
    expect(view.counts.verified).toBe(0);
    expect(view.general.map((entry) => entry.label)).toEqual(["Lint"]);
  });

  it("should never present an empty registry as fully verified", () => {
    const view = deriveAcceptanceCoverage({ registry: registry({ schemaVersion: 1, criteria: [] }), reports: [], now: NOW });
    expect(view.counts.total).toBe(0);
    expect(coverageSentence(view.counts)).toBe("Aucun critère d'acceptation identifié");
    expect(renderAcceptanceSummary(view).markdown).toContain("Rien n'est présenté comme vérifié");
  });

  it("should show evidence that names only a multi-check criterion without counting it", () => {
    const view = coverage({ reports: [report("qa-evidence.json", qa([{ id: "Q1", label: "Vague", verdict: "pass", criterionIds: ["AC2"] }]))] });
    expect(criterion(view, "AC2").status).toBe("unverified");
    expect(criterion(view, "AC2").unassigned.map((entry) => entry.label)).toEqual(["Vague"]);
  });

  it("should diagnose references to unknown criteria and checks", () => {
    const view = coverage({ reports: [report("qa-evidence.json", qa([{ id: "Q1", label: "x", verdict: "pass", criterionIds: ["AC9"], checkIds: ["AC9-C1"] }]))] });
    const messages = view.diagnostics.map((entry) => entry.message).join(" ");
    expect(messages).toContain("critère inconnu : AC9");
    expect(messages).toContain("contrôle inconnu : AC9-C1");
  });

  it("should list a criterion no plan task covers", () => {
    const view = coverage({ plan: parsePlanLinks({ tasks: [{ id: "T1", title: "a", criterion_ids: ["AC1", "AC7"] }] }) });
    expect(criterion(view, "AC1").tasks).toEqual([{ id: "T1", title: "a" }]);
    expect(criterion(view, "AC2").reasons).toContain("Aucune tâche du plan ne traite ce critère.");
    expect(view.diagnostics.some((entry) => entry.message.includes("AC7"))).toBe(true);
  });

  it("should never read a done task on the board as a verified criterion", () => {
    const view = coverage({ plan: parsePlanLinks({ tasks: [{ id: "T1", title: "a", criterion_ids: ["AC1"] }] }), reports: [report("developer-report.json", { source: "developer", items: [] })] });
    expect(criterion(view, "AC1").status).toBe("unverified");
  });

  describe("code version", () => {
    it("should call evidence taken on older code stale", () => {
      const view = coverage({ reports: [report("qa-evidence.json", qa([{ id: "Q1", label: "Filtre", verdict: "pass", checkIds: ["AC1-C1"] }], { codeSnapshot: { atStart: OLD, atEnd: OLD } }))] });
      expect(criterion(view, "AC1").status).toBe("unverified");
      expect(criterion(view, "AC1").checks[0].evidence[0].freshness).toBe("stale");
      expect(view.counts.stale).toBe(1);
    });

    it("should call a measurement inconclusive when the code moved during it", () => {
      const view = coverage({ reports: [report("qa-evidence.json", qa([{ id: "Q1", label: "Filtre", verdict: "pass", checkIds: ["AC1-C1"] }], { codeSnapshot: { atStart: OLD, atEnd: CURRENT } }))] });
      expect(criterion(view, "AC1").checks[0].evidence[0].freshness).toBe("inconclusive");
      expect(criterion(view, "AC1").status).toBe("unverified");
    });

    it("should not trust an identifier the snapshot utility never produced", () => {
      const view = coverage({ reports: [report("qa-evidence.json", qa([{ id: "Q1", label: "Filtre", verdict: "pass", checkIds: ["AC1-C1"] }], { codeSnapshot: { atStart: "snap-made-up" } }))] });
      expect(criterion(view, "AC1").checks[0].evidence[0].freshness).toBe("unknown");
      expect(criterion(view, "AC1").status).toBe("unverified");
    });

    it("should not verify anything when the current code cannot be identified", () => {
      const view = coverage({ currentSnapshot: undefined, reports: [report("qa-evidence.json", qa([{ id: "Q1", label: "Filtre", verdict: "pass", checkIds: ["AC1-C1"] }]))] });
      expect(criterion(view, "AC1").status).toBe("unverified");
      expect(criterion(view, "AC1").checks[0].reasons.join(" ")).toContain("Version inconnue");
    });

    it("should count a failure of unknown version as a current failure", () => {
      const view = coverage({ reports: [report("qa-evidence.json", { schemaVersion: 2, source: "qa", items: [{ id: "Q1", label: "Filtre", verdict: "fail", checkIds: ["AC1-C1"] }] })] });
      expect(criterion(view, "AC1").status).toBe("failed");
    });
  });

  describe("review rounds", () => {
    const roundOne = () => report("qa-evidence.json", qa([{ id: "Q1-R1", label: "Filtre", verdict: "fail", checkIds: ["AC1-C1"], screenshot: "assets/result.png" }], { codeSnapshot: { atStart: OLD, atEnd: OLD }, round: 1 }), 1);

    it("should let a round two success replace a round one failure it names", () => {
      const view = coverage({ reports: [roundOne(), report("qa-evidence.json", qa([{ id: "Q1-R2", label: "Filtre", verdict: "pass", checkIds: ["AC1-C1"], supersedes: ["Q1-R1"], screenshot: "assets/result.png" }], { round: 2 }), 2)] });
      const check = criterion(view, "AC1").checks[0];
      expect(check.status).toBe("verified");
      expect(check.history.map((entry) => [entry.id, entry.supersededBy])).toEqual([["Q1-R1", "Q1-R2"]]);
      // Same file name, two rounds: each version keeps its own capture.
      expect(check.history[0].attachments[0].path).toBe("evidence/qa-evidence.json/v1/assets/result.png");
      expect(check.evidence[0].attachments[0].path).toBe("evidence/qa-evidence.json/v2/assets/result.png");
    });

    it("should keep an older failure standing when nothing replaces it explicitly", () => {
      const view = coverage({ reports: [roundOne(), report("qa-evidence.json", qa([{ id: "Q1-R2", label: "Filtre", verdict: "pass", checkIds: ["AC1-C1"] }], { round: 2 }), 2)] });
      expect(criterion(view, "AC1").status).toBe("unverified");
      expect(criterion(view, "AC1").checks[0].reasons[0]).toContain("Q1-R1");
    });

    it("should report a current pass and a current failure as a failure with a conflict", () => {
      const view = coverage({ reports: [report("qa-evidence.json", qa([{ id: "A", label: "Filtre", verdict: "fail", checkIds: ["AC1-C1"] }, { id: "B", label: "Filtre bis", verdict: "pass", checkIds: ["AC1-C1"] }]))] });
      expect(criterion(view, "AC1").status).toBe("failed");
      expect(criterion(view, "AC1").checks[0].reasons.join(" ")).toContain("contradictoires");
    });

    it("should refuse a replacement taken on stale code or on another check", () => {
      const stale = coverage({ reports: [roundOne(), report("qa-evidence.json", qa([{ id: "Q1-R2", label: "Filtre", verdict: "pass", checkIds: ["AC1-C1"], supersedes: ["Q1-R1"] }], { codeSnapshot: { atStart: OLD } }), 2)] });
      expect(criterion(stale, "AC1").checks[0].history).toHaveLength(0);
      const elsewhere = coverage({ reports: [roundOne(), report("qa-evidence.json", qa([{ id: "Q9", label: "Zoom", verdict: "pass", checkIds: ["AC2-C1"], supersedes: ["Q1-R1"] }]), 2)] });
      expect(elsewhere.diagnostics.some((entry) => entry.message.includes("ne contrôle pas la même chose"))).toBe(true);
    });

    it("should count one observation once across a per-task file, the merged file and a round copy", () => {
      const item = { id: "D1", label: "Filtre", verdict: "measured", checkIds: ["AC1-C1"] };
      const developer = (file: string) => report(file, { schemaVersion: 2, source: "developer", criteriaRevision: 1, codeSnapshot: { atStart: CURRENT }, items: [item] });
      const view = coverage({ reports: [developer("dev-evidence-T1.json"), developer("dev-evidence.json"), developer("dev-evidence-round1.json")] });
      expect(criterion(view, "AC1").checks[0].evidence).toHaveLength(1);
      expect(criterion(view, "AC1").status).toBe("verified");
    });

    it("should keep a previous round's gates apart from the current ones", () => {
      const gate = (round: number) => report("qa-evidence.json", qa([{ id: `QA-R${round}-1`, label: "Lint", verdict: "pass", command: "npm run lint" }], { round }), round);
      const view = coverage({ reports: [gate(1), gate(2)] });
      expect(view.general.map((entry) => entry.id)).toEqual(["QA-R2-1"]);
      expect(view.generalHistory.map((entry) => entry.id)).toEqual(["QA-R1-1"]);
      const withCopy = coverage({ reports: [gate(1), report("qa-evidence-round1.json", qa([{ id: "QA-R1-1", label: "Lint", verdict: "pass", command: "npm run lint" }], { round: 1 })), gate(2)] });
      expect(withCopy.general.map((entry) => entry.id)).toEqual(["QA-R2-1"]);
    });

    it("should keep every archived version in the report list, the latest marked current", () => {
      const view = coverage({ reports: [roundOne(), report("qa-evidence.json", qa([]), 2)] });
      expect(view.reports.map((entry) => [entry.version, entry.current])).toEqual([[1, false], [2, true]]);
    });
  });

  describe("confirmations", () => {
    const developer = (snapshot: string) => report("dev-evidence.json", { schemaVersion: 2, source: "developer", criteriaRevision: 1, codeSnapshot: { atStart: snapshot }, items: [{ id: "D1", label: "Filtre mesuré", verdict: "measured", checkIds: ["AC1-C1"] }] });

    it("should resolve a confirmation to the evidence it inspected", () => {
      const view = coverage({ reports: [developer(CURRENT), report("qa-evidence.json", qa([{ id: "Q1", label: "Filtre confirmé", verdict: "confirmed", confirms: "D1", checkIds: ["AC1-C1"] }]))] });
      expect(criterion(view, "AC1").status).toBe("verified");
      expect(criterion(view, "AC1").checks[0].evidence.find((entry) => entry.id === "Q1")?.basis).toBe("confirmation");
    });

    it("should not make a confirmation of stale evidence current", () => {
      const view = coverage({ reports: [developer(OLD), report("qa-evidence.json", qa([{ id: "Q1", label: "Filtre confirmé", verdict: "confirmed", confirms: "D1", checkIds: ["AC1-C1"] }]))] });
      expect(criterion(view, "AC1").status).toBe("unverified");
    });

    it("should refuse a confirmation whose reference is missing", () => {
      const view = coverage({ reports: [report("qa-evidence.json", qa([{ id: "Q1", label: "Filtre confirmé", verdict: "confirmed", confirms: "D404", checkIds: ["AC1-C1"] }]))] });
      expect(criterion(view, "AC1").status).toBe("unverified");
      expect(criterion(view, "AC1").checks[0].reasons.join(" ")).toContain("introuvable");
    });
  });

  it("should stop counting evidence checked against an older wording of a criterion", () => {
    const changed = registry({ ...registryJson, revision: 2, criteria: [{ ...registryJson.criteria[0], revision: 2 }, ...registryJson.criteria.slice(1)] });
    const view = coverage({ registry: changed, reports: [report("qa-evidence.json", qa([{ id: "Q1", label: "Filtre", verdict: "pass", checkIds: ["AC1-C1"] }]))] });
    expect(criterion(view, "AC1").status).toBe("unverified");
    expect(criterion(view, "AC1").checks[0].reasons[0]).toContain("version antérieure du critère");
  });

  it("should rebuild criteria from an older plan without ever verifying them", () => {
    const view = deriveAcceptanceCoverage({ plan: parsePlanLinks({ acceptance_criteria: ["Given a, then b"], tasks: [] }), reports: [], now: NOW });
    expect(view.available).toBe(false);
    expect(view.criteria[0]).toMatchObject({ id: "AC1", reconstructed: true, status: "unverified" });
  });
});

describe("acceptance summary", () => {
  it("should say the same thing as the tab and never link a local file as reachable", () => {
    const view = coverage({ reports: [report("qa-evidence.json", qa([
      { id: "Q1", label: "Filtre", verdict: "pass", checkIds: ["AC1-C1"], screenshot: "assets/filtre.png" },
      { id: "Q2", label: "Erreur | serveur", verdict: "not_run", criterionIds: ["AC3"], blocker: "Environnement inaccessible" },
      { id: "G1", label: "Lint", verdict: "pass", command: "npm run lint" },
    ]))] });
    const summary = renderAcceptanceSummary(view);
    expect(summary.json.sentence).toBe("1 critère vérifié sur 3 · 1 bloqué · 1 non vérifié");
    expect(summary.markdown).toContain(summary.json.sentence);
    expect(summary.markdown).toContain("- **AC3** bloqué");
    expect(summary.markdown).toContain("Erreur \\| serveur");
    expect(summary.markdown).toContain("`assets/filtre.png`");
    expect(summary.markdown).not.toMatch(/\]\((?:\.|\/|assets|localhost|http:\/\/127)/);
    expect(summary.json.localAttachments).toEqual(["assets/filtre.png"]);
    expect(summary.json.criteria.find((entry) => entry.id === "AC1")?.status).toBe("verified");
  });

  it("should say criterion traceability is unavailable for a run without a registry", () => {
    const view = deriveAcceptanceCoverage({ reports: [], now: NOW });
    expect(renderAcceptanceSummary(view).markdown).toContain("Traçabilité par critère indisponible pour ce run");
  });
});
