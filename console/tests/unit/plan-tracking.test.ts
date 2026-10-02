import { beforeEach, describe, expect, it } from "@jest/globals";

import { agentIdentity, agentRole, isDeveloperDelegation, pairDelegation, planTaskBoard, plannedTasks } from "../../server/domain";
import { claudeCode } from "../../server/engine/claude-code";
import { processHook } from "../../server/hooks";
import { RunSession } from "../../server/run-session";
import type { AgentState, PlanTask } from "../../server/types";

const plan: PlanTask[] = [
  { id: "T1", title: "Modèle", complexity: "S", status: "todo" },
  { id: "T2", title: "Panneau", complexity: "M", status: "todo" },
  { id: "T3", title: "Tests", status: "todo" },
];

const agent = (id: string, nickname: string): AgentState => ({ id, name: "implementation-harness:developer", nickname, avatar: `/avatars/${nickname.toLowerCase()}.webp`, role: "Dev", status: "running", startedAt: "2026-09-27T10:00:00.000Z" });

describe("plan task ids read from a delegation", () => {
  const delegate = (tool: string, input: Record<string, unknown>) => claudeCode.event({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: input });

  it("should read the task id from the report file the developer is told to write", () => {
    expect(delegate("Agent", { subagent_type: "implementation-harness:developer", description: "Implement T2", prompt: "Task T2. Write .claude/tasks/developer-report-T2.md and dev-evidence-T2.json." }))
      .toMatchObject({ kind: "tool.start", tool: "Agent", target: "implementation-harness:developer", planTaskIds: ["T2"] });
  });

  it("should read it from the legacy Task tool and count a repeated id once", () => {
    expect(delegate("Task", { subagent_type: "developer", prompt: "developer-report-T1.md, then again developer-report-T1.md" }))
      .toMatchObject({ planTaskIds: ["T1"] });
  });

  it("should carry no task id when the prompt names no suffixed report", () => {
    expect(delegate("Agent", { subagent_type: "developer", prompt: "Write developer-report-<task-id>.md, then merge into developer-report.md" }))
      .not.toHaveProperty("planTaskIds");
    expect(delegate("Read", { file_path: "/repo/.claude/tasks/developer-report-T1.md" })).not.toHaveProperty("planTaskIds");
  });
});

describe("plan tasks read from planner-output.json", () => {
  it("should keep the id, title and complexity of every task", () => {
    const content = JSON.stringify({ tasks: [{ id: "T1", title: "Modèle", complexity: "S", file_paths: [] }, { id: "T2", title: "Panneau" }] });
    expect(plannedTasks(content)).toEqual([
      { id: "T1", title: "Modèle", complexity: "S", status: "todo" },
      { id: "T2", title: "Panneau", status: "todo" },
    ]);
  });

  it("should keep the description and the files a task touches, for its detail", () => {
    const content = JSON.stringify({ tasks: [{ id: "T1", title: "Modèle", description: "  Ajouter le modèle.\n\n\n\nPuis   le persister.  ", file_paths: ["src/model.ts", ""] }] });
    expect(plannedTasks(content)).toEqual([
      { id: "T1", title: "Modèle", status: "todo", description: "Ajouter le modèle.\n\nPuis le persister.", filePaths: ["src/model.ts"] },
    ]);
  });

  it("should skip a task without an id and fall back to the id for a missing title", () => {
    expect(plannedTasks(JSON.stringify({ tasks: [{ title: "Orpheline" }, { id: "T9" }] }))).toEqual([{ id: "T9", title: "T9", status: "todo" }]);
  });

  it("should return nothing for a half-written or foreign file", () => {
    expect(plannedTasks("{\"tasks\": [")).toBeUndefined();
    expect(plannedTasks(JSON.stringify({ summary: "pas de tâches" }))).toBeUndefined();
  });
});

describe("agent names and roles", () => {
  it("should give names in start order, alternating women and men", () => {
    expect([0, 1, 2, 3].map((index) => agentIdentity(index).nickname)).toEqual(["Léa", "Tom", "Chloé", "Hugo"]);
    expect(agentIdentity(1).avatar).toBe("/avatars/tom.webp");
  });

  it("should number a name once the pool has gone round, and keep its picture", () => {
    expect(agentIdentity(12)).toEqual({ nickname: "Léa 2", avatar: "/avatars/lea.webp" });
    expect(agentIdentity(25).nickname).toBe("Tom 3");
  });

  it("should map every workflow agent type to a short French role", () => {
    expect(agentRole("implementation-harness:developer")).toBe("Dev");
    expect(agentRole("ticket-planner")).toBe("Planif");
    expect(agentRole("implementation-harness:senior-reviewer")).toBe("Revue");
    expect(agentRole("qa-reviewer")).toBe("QA");
    expect(agentRole("implementation-harness:designer-reviewer")).toBe("Design");
    expect(agentRole("review-orchestrator")).toBe("Orchestration");
    expect(agentRole("Explore")).toBe("Exploration");
  });

  it("should fall back to the bare type for an unknown agent", () => {
    expect(agentRole("some-plugin:general-purpose")).toBe("general-purpose");
  });

  it("should only count a developer as working a plan task", () => {
    expect(isDeveloperDelegation("implementation-harness:developer")).toBe(true);
    expect(isDeveloperDelegation("implementation-harness:senior-reviewer")).toBe(false);
    expect(isDeveloperDelegation(undefined)).toBe(false);
  });
});

describe("pairing a delegation with the agent it started", () => {
  it("should pair each start with the oldest unpaired delegation of its type", () => {
    let delegations = [{ agentType: "implementation-harness:developer", taskIds: ["T1"] }, { agentType: "implementation-harness:developer", taskIds: ["T2"] }];
    delegations = pairDelegation(delegations, "implementation-harness:developer", "a1");
    delegations = pairDelegation(delegations, "implementation-harness:developer", "a2");
    expect(delegations).toEqual([
      { agentType: "implementation-harness:developer", taskIds: ["T1"], agentId: "a1" },
      { agentType: "implementation-harness:developer", taskIds: ["T2"], agentId: "a2" },
    ]);
  });

  it("should leave the delegations alone when another type of agent starts", () => {
    const delegations = [{ agentType: "developer", taskIds: ["T1"] }];
    expect(pairDelegation(delegations, "implementation-harness:senior-reviewer", "r1")).toBe(delegations);
  });
});

describe("the tracking board", () => {
  it("should leave every task to do before anything happened", () => {
    expect(planTaskBoard(plan, [], [], []).map((task) => task.status)).toEqual(["todo", "todo", "todo"]);
  });

  it("should move a delegated task to in progress, and a reported one to done", () => {
    const board = planTaskBoard(plan, [{ agentType: "developer", taskIds: ["T1"] }, { agentType: "developer", taskIds: ["T2"] }], [], ["planner-output.json", "developer-report-T1.md"]);
    expect(board.map((task) => task.status)).toEqual(["done", "in_progress", "todo"]);
  });

  it("should not count the merged report as a task report", () => {
    expect(planTaskBoard(plan, [], [], ["developer-report.md"]).every((task) => task.status === "todo")).toBe(true);
  });

  it("should keep a done task done when it is reworked, under its latest agent", () => {
    const delegations = [{ agentType: "developer", taskIds: ["T1"], agentId: "a1" }, { agentType: "developer", taskIds: ["T1"], agentId: "a4" }];
    const [task] = planTaskBoard(plan, delegations, [agent("a1", "Léa"), agent("a4", "Inès")], ["developer-report-T1.md"]);
    expect(task).toMatchObject({ status: "done", assignee: { agentId: "a4", nickname: "Inès", avatar: "/avatars/inès.webp", role: "Dev" } });
  });

  it("should show no assignee until the delegated agent has started", () => {
    const [task] = planTaskBoard(plan, [{ agentType: "developer", taskIds: ["T1"] }], [], []);
    expect(task.status).toBe("in_progress");
    expect(task).not.toHaveProperty("assignee");
  });
});

describe("the tracking board fed by hooks", () => {
  let session: RunSession;
  const hook = (payload: Record<string, unknown>) => processHook(session, { runId: session.id, payload });
  const launch = (taskId: string) => hook({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: "implementation-harness:developer", prompt: `Write developer-report-${taskId}.md` } });
  const start = (agentId: string, type = "implementation-harness:developer") => hook({ hook_event_name: "SubagentStart", agent_type: type, agent_id: agentId });

  beforeEach(() => {
    session = new RunSession("demo-plan", { status: "running", phase: 4, planTasks: plan });
  });

  it("should assign two parallel launches to the agents in the order they start", () => {
    launch("T1");
    launch("T2");
    start("a1");
    start("a2");
    expect(session.state.planTasks).toMatchObject([
      { id: "T1", status: "in_progress", assignee: { agentId: "a1", nickname: "Léa", role: "Dev" } },
      { id: "T2", status: "in_progress", assignee: { agentId: "a2", nickname: "Tom", role: "Dev" } },
      { id: "T3", status: "todo" },
    ]);
  });

  it("should not let a reviewer take a developer's task", () => {
    launch("T1");
    start("r1", "implementation-harness:senior-reviewer");
    start("a1");
    expect(session.state.planTasks?.[0]).toMatchObject({ assignee: { agentId: "a1", nickname: "Tom" } });
  });

  it("should not record a reviewer handed the per-task reports as a delegation", () => {
    hook({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: "implementation-harness:senior-reviewer", prompt: "Read developer-report-T3.md" } });
    expect(session.state.planTasks?.[2].status).toBe("todo");
  });

  it("should keep the name an agent was given when it starts again", () => {
    start("a1");
    start("a2");
    start("a1");
    expect(session.state.agents.find((entry) => entry.id === "a1")).toMatchObject({ nickname: "Léa", role: "Dev" });
  });
});
