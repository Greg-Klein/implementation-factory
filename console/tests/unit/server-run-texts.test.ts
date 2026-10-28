import { describe, expect, it } from "@jest/globals";
import {
  actionLabel, agentRole, describeQueue, draftFindingFix, exitReport, findingCategoryLabel, INTERRUPTED_ANALYSIS, linkEdges, reviewPlanNotes,
  runLockKey, worktreeKeptDetail, worktreeRemoval, type ScheduleContext,
} from "../../server/domain";
import { processHook, answerQuestion } from "../../server/hooks";
import { RunSession } from "../../server/run-session";
import { removeWorktreeOnRequest } from "../../server/run-worktrees";
import { declaredDelivery } from "../../server/workflow-state";
import type { QueuedRun, ScheduledTicket } from "../../server/types";

const url = (iid: number) => `https://gitlab.com/acme/shop/-/issues/${iid}`;
const queued = (iid: number): QueuedRun => ({ id: `q${iid}`, cwd: "/work/shop", repository: "/work/shop", issueUrl: url(iid), instruction: "", queuedAt: "2026-10-01T10:00:00.000Z" });
const failed = (iid: number, failure?: string): ScheduledTicket => ({ issueUrl: url(iid), repository: "/work/shop", analysis: "failed", areas: [], files: [], ...(failure ? { failure } : {}) });

describe("what a run says about itself in French", () => {
  it("should name the end of a session in French", () => {
    expect(exitReport("user", 143, true, false, "fr")).toBe("Session arrêtée par l'utilisateur");
    expect(exitReport("queue", 143, true, false, "fr")).toBe("Place libérée pour la file");
    expect(exitReport(null, 1, true, false, "fr")).toBe("Session interrompue");
  });

  it("should say what the agent is doing in French, with the file and the target it names", () => {
    expect(actionLabel("Bash", "glab issue view 258", undefined, "fr")).toBe("Lecture du ticket GitLab");
    expect(actionLabel("Bash", "./scripts/deploy.sh", undefined, "fr")).toBe("Commande shell");
    expect(actionLabel("Read", undefined, "/repo/console/server/domain.ts", "fr")).toBe("Lecture de domain.ts");
    expect(actionLabel("Grep", undefined, "createsBranch", "fr")).toBe("Recherche de \"createsBranch\"");
    expect(actionLabel("WebFetch", undefined, "https://nextjs.org/docs", "fr")).toBe("Requête vers nextjs.org");
    expect(actionLabel("mcp__playwright__browser_click", undefined, undefined, "fr")).toBe("Pilotage du navigateur");
    expect(actionLabel("SomeToolAddedLater", undefined, undefined, "fr")).toBeUndefined();
  });

  it("should give an agent its role in French", () => {
    expect(agentRole("implementation-factory:senior-reviewer", "fr")).toBe("Reviewer senior");
    expect(agentRole("review-orchestrator", "fr")).toBe("Orchestrateur de revue");
    expect(agentRole("some-plugin:general-purpose", "fr")).toBe("general-purpose");
  });

  it("should write the feed of the hooks in the language of the run", () => {
    const session = new RunSession("demo-fr", { status: "running", phase: 1, language: "fr" });
    processHook(session, { runId: session.id, payload: { hook_event_name: "SubagentStart", agent_type: "implementation-factory:developer", agent_id: "a1" } });
    expect(session.state.activities.map((activity) => activity.title)).toContain("implementation-factory:developer démarre");
    expect(session.state.agents[0]?.role).toBe("Developer");
  });

  it("should refuse an answer in the language of the run", () => {
    const session = new RunSession("demo-fr-answer", { status: "running", phase: 1, language: "fr" });
    expect(() => answerQuestion(session, {})).toThrow("Aucune question n'attend de réponse.");
  });

  it("should keep a run in English while the factory speaks French", () => {
    const session = new RunSession("demo-en", { status: "running", phase: 1, language: "en" });
    expect(() => answerQuestion(session, {})).toThrow("No question is waiting for an answer.");
  });

  it("should refuse a worktree removal in the language of the run", async () => {
    const session = new RunSession("run-fr-worktree", { status: "completed", phase: 10, language: "fr" });
    await expect(removeWorktreeOnRequest(session, false)).resolves.toEqual({ outcome: "refused", message: "Ce run n'a pas de worktree." });
  });

  it("should say why a worktree is kept in French, risks included", () => {
    const decision = worktreeRemoval({ status: "stopped", sessionActive: false, issueUrl: url(1) }, { exists: true, clean: false, pushed: true }, "fr");
    expect(decision.reasons).toEqual(["aucune merge request", "des modifications non commitées"]);
    expect(decision.risks).toEqual(["des modifications non commitées"]);
    expect(worktreeKeptDetail(decision.reasons, "fr")).toBe("Worktree conservé : aucune merge request, des modifications non commitées");
  });

  it("should name a declared delivery on the wrong forge in French", () => {
    const workflow = { schemaVersion: 1, revision: 1, state: "completed", receivedAt: "2026-10-04T16:00:00.000Z", result: { delivery: "merge_request", mergeRequestUrl: "https://github.com/acme/shop/pull/12" } } as never;
    expect(declaredDelivery(workflow, url(1), "fr").refused).toBe("https://github.com/acme/shop/pull/12 n'est pas sur GitLab, où se trouve le ticket.");
  });

  it("should write the review order remarks in French", () => {
    expect(reviewPlanNotes({ "qa-plan.md": "2026-09-27T09:11:00.000Z", "qa-report.md": "2026-09-27T09:10:00.000Z" }, "fr"))
      .toEqual(["Le plan de test QA (qa-plan.md) est arrivé après le rapport QA : rien ne montre qu'il a été écrit en premier."]);
  });
});

describe("what the queue says in French", () => {
  it("should write the detail of a failed analysis for the ticket that waits", () => {
    const context: ScheduleContext = { tickets: [failed(101, INTERRUPTED_ANALYSIS), { ...failed(102), analysis: "done", confidence: "high" }] };
    const [first] = describeQueue([queued(101), queued(102)], new Map(), context, "fr");
    expect(first).toMatchObject({ analysisFailure: "console redémarrée pendant l'analyse" });
    const [, second] = describeQueue([queued(101), queued(102)], new Map(), context, "fr");
    expect(second).toMatchObject({ reason: "order", cause: "analysis_failed", detail: expect.stringContaining("a échoué (console redémarrée pendant l'analyse)") });
  });

  it("should keep the English text of the same entries by default", () => {
    const context: ScheduleContext = { tickets: [failed(101, "timeout")] };
    expect(describeQueue([queued(101)], new Map(), context)[0]).toMatchObject({ analysisFailure: "timeout" });
    expect(describeQueue([queued(101), queued(102)], new Map(), context)[1]).toMatchObject({ detail: expect.stringContaining("failed (timeout)") });
    expect(runLockKey(queued(101))).toBeTruthy();
  });

  it("should write the dependency read from the forge in French", () => {
    const [edge] = linkEdges("/work/shop", url(102), { blockedBy: [url(101)], blocks: [] }, [url(101)], "fr");
    expect(edge?.reason).toBe("GitLab indique que #102 est bloqué par #101.");
  });
});

describe("what a source fix says in French", () => {
  it("should title and label a proposal in French", () => {
    const group = { category: "type-escape", label: "A type silenced", runs: 3, findings: 3, examples: [] };
    const draft = draftFindingFix(group, { language: "fr", stack: { tool: "eslint", packages: ["eslint", "typescript-eslint"] }, existingFiles: ["AGENTS.md"] });
    expect(draft.title).toBe("Bloquer type-escape avec ESLint");
    expect(draft.label).toBe("Un type réduit au silence : any, conversion risquée, assertion non nulle");
    expect(findingCategoryLabel("type-escape", "A type silenced", "en")).toBe("A type silenced");
  });
});
