import { describe, expect, it } from "@jest/globals";
import path from "node:path";
import { artifactWatchRoot, runWorktreePath, belongsToRun, isEvidenceReport, isPanelEvidence, isRunDocument, phaseForArtifact, resolveArtifactPath, reviewPlanNotes, watchedForArtifacts } from "../../server/domain";

describe("artifact handling", () => {
  it("should resolve files located inside the run directory", () => {
    const root = path.resolve("/tmp/implementation-harness-run/artifacts");
    expect(resolveArtifactPath(root, "reviews/senior.md")).toBe(path.join(root, "reviews/senior.md"));
  });

  it("should reject path traversal and sibling directories", () => {
    const root = path.resolve("/tmp/implementation-harness-run/artifacts");
    expect(resolveArtifactPath(root, "../run.json")).toBeUndefined();
    expect(resolveArtifactPath(root, "/tmp/secret.txt")).toBeUndefined();
    expect(resolveArtifactPath(root, "../../artifacts-copy/secret.txt")).toBeUndefined();
  });

  it("should keep the working material of the agents out of the documents", () => {
    expect(isRunDocument("developer-report.md")).toBe(true);
    expect(isRunDocument("planner-output.JSON")).toBe(true);
    expect(isRunDocument("assets/live-desktop-1728-toggle-inactive.png")).toBe(false);
    expect(isRunDocument("assets/icon-tooltip-arrow.svg")).toBe(false);
  });

  it("should keep the documents of the previous run out of this one", () => {
    const startedAt = "2026-09-07T13:07:30.000Z";
    expect(belongsToRun(Date.parse("2026-09-07T13:07:31.000Z"), startedAt)).toBe(true);
    expect(belongsToRun(Date.parse("2026-08-27T08:37:00.000Z"), startedAt)).toBe(false);
    expect(belongsToRun(Date.now(), null)).toBe(false);
  });

  it("should recognize only the evidence files the Preuves tab reads", () => {
    expect(isPanelEvidence("qa-evidence.json")).toBe(true);
    expect(isPanelEvidence("design-evidence.json")).toBe(true);
    expect(isPanelEvidence("dev-evidence.json")).toBe(true);
    // The round copies are history the tab never shows: a badge on one would
    // point at nothing new.
    expect(isPanelEvidence("qa-evidence-round1.json")).toBe(false);
    expect(isPanelEvidence("qa-report.md")).toBe(false);
    expect(isPanelEvidence("evidence.json")).toBe(false);
  });

  it("should archive the screenshots of a per-task or per-round evidence file too", () => {
    expect(isEvidenceReport("dev-evidence.json")).toBe(true);
    // One developer per task, one file per developer: waiting for the merged
    // file would leave these screenshots out of the archive.
    expect(isEvidenceReport("dev-evidence-T7.json")).toBe(true);
    expect(isEvidenceReport("dev-evidence-rework1.json")).toBe(true);
    expect(isEvidenceReport("qa-evidence-round1.json")).toBe(true);
    expect(isEvidenceReport("design-evidence-round2.json")).toBe(true);
    expect(isEvidenceReport("evidence.json")).toBe(false);
    expect(isEvidenceReport("dev-evidence.md")).toBe(false);
    expect(isEvidenceReport("dev-evidence-T7-extra.json")).toBe(false);
  });

  it("should follow the task directory and nothing else beside it", () => {
    const taskRoot = path.resolve("/Users/someone/project/.claude/tasks");
    expect(artifactWatchRoot(taskRoot)).toBe(path.resolve("/Users/someone/project/.claude"));
    expect(watchedForArtifacts(taskRoot, artifactWatchRoot(taskRoot))).toBe(true);
    expect(watchedForArtifacts(taskRoot, taskRoot)).toBe(true);
    expect(watchedForArtifacts(taskRoot, path.join(taskRoot, "qa-report.md"))).toBe(true);
    expect(watchedForArtifacts(taskRoot, path.join(taskRoot, "assets", "shot.png"))).toBe(true);
    expect(watchedForArtifacts(taskRoot, path.resolve("/Users/someone/project/.claude/worktrees"))).toBe(false);
    expect(watchedForArtifacts(taskRoot, path.resolve("/Users/someone/project/.claude/settings.local.json"))).toBe(false);
    expect(watchedForArtifacts(taskRoot, `${taskRoot}-backup`)).toBe(false);
  });

  // Two runs of one repository each read their own task directory: the one in their worktree.
  it("should follow the task directory of the run's own worktree, never the one of the main checkout or of another run", () => {
    const taskRoot = (cwd: string) => path.join(cwd, ".claude", "tasks");
    const first = taskRoot(runWorktreePath("/work/repo", "run-1"));
    const second = taskRoot(runWorktreePath("/work/repo", "run-2"));
    expect(artifactWatchRoot(first)).toBe(path.join("/work/repo", ".claude", "worktrees", "run-1", ".claude"));
    expect(watchedForArtifacts(first, path.join(first, "planner-output.json"))).toBe(true);
    expect(watchedForArtifacts(first, path.join(second, "planner-output.json"))).toBe(false);
    expect(watchedForArtifacts(first, path.join(taskRoot("/work/repo"), "planner-output.json"))).toBe(false);
  });

  it("should map generated documents to workflow phases", () => {
    expect(phaseForArtifact("ticket-context.md")).toBe(1);
    expect(phaseForArtifact("nested/developer-report-2.md")).toBe(5);
    expect(phaseForArtifact("browser-recipe.md")).toBe(5);
    expect(phaseForArtifact("senior-review.md")).toBe(6);
    expect(phaseForArtifact("mr-description.md")).toBe(8);
    expect(phaseForArtifact("unknown.txt")).toBe(0);
  });
});

describe("reviewer plans", () => {
  it("should not let a reviewer's plan open or close a phase", () => {
    expect(phaseForArtifact("qa-plan.md")).toBe(0);
    expect(phaseForArtifact("design-inventory.md")).toBe(0);
    expect(phaseForArtifact("qa-report.md")).toBe(6);
    expect(phaseForArtifact("designer-review.md")).toBe(6);
  });

  it("should say nothing when each plan arrived before its report, or while no report exists", () => {
    expect(reviewPlanNotes(undefined)).toEqual([]);
    expect(reviewPlanNotes({ "qa-plan.md": "2026-09-27T09:00:00.000Z" })).toEqual([]);
    expect(reviewPlanNotes({
      "qa-plan.md": "2026-09-27T09:00:00.000Z", "qa-report.md": "2026-09-27T09:10:00.000Z",
      "design-inventory.md": "2026-09-27T09:01:00.000Z", "designer-review.md": "2026-09-27T09:12:00.000Z",
    })).toEqual([]);
  });

  it("should note a plan that arrived after its report, or never", () => {
    const late = reviewPlanNotes({ "qa-plan.md": "2026-09-27T09:11:00.000Z", "qa-report.md": "2026-09-27T09:10:00.000Z" });
    expect(late).toEqual(["Le plan de test QA (qa-plan.md) est arrivé après le rapport QA : rien ne montre qu'il a été écrit en premier."]);
    const missing = reviewPlanNotes({ "designer-review.md": "2026-09-27T09:12:00.000Z" });
    expect(missing).toEqual(["L'inventaire design (design-inventory.md) n'est pas arrivé avant la revue de design : rien ne montre qu'il a été écrit en premier."]);
  });

  it("should not judge an order from an arrival time it cannot read", () => {
    expect(reviewPlanNotes({ "qa-plan.md": "2026-09-27T09:11:00.000Z", "qa-report.md": "not a date" })).toEqual([]);
  });
});
