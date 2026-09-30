"use client";

import { CheckIcon, KanbanIcon } from "@phosphor-icons/react";
import type { PlanTask, PlanTaskStatus, RunState } from "@/lib/types";
import { AgentAvatar, AgentName } from "./agent-avatar";

const COLUMNS: { status: PlanTaskStatus; title: string }[] = [
  { status: "todo", title: "To Do" },
  { status: "in_progress", title: "In Progress" },
  { status: "done", title: "Done" },
];

const STATUS_LABEL: Record<PlanTaskStatus, string> = { todo: "À faire", in_progress: "En cours", done: "Terminée" };

function StatusMark({ status }: { status: PlanTaskStatus }) {
  if (status === "done") return <span role="img" aria-label={STATUS_LABEL.done} className="grid size-4.5 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[var(--on-accent)]"><CheckIcon size={10} weight="bold" /></span>;
  if (status === "in_progress") return <span role="img" aria-label={STATUS_LABEL.in_progress} className="size-4.5 shrink-0 rounded-full border-2 border-amber-200 border-t-amber-500" />;
  return <span role="img" aria-label={STATUS_LABEL.todo} className="size-4.5 shrink-0 rounded-full border-2 border-[var(--line-strong)]" />;
}

function TaskCard({ task }: { task: PlanTask }) {
  const assignee = task.assignee?.nickname ? task.assignee : undefined;
  return (
    <li data-testid="tracking-card" data-task-id={task.id} data-status={task.status} className="reveal rounded-lg border border-[var(--line)] bg-[var(--raised)] p-3">
      <div className="flex items-start gap-2.5">
        <StatusMark status={task.status} />
        <p className="min-w-0 flex-1 text-xs font-medium leading-relaxed text-[var(--ink)]">{task.title}</p>
      </div>
      <div className="mt-2.5 flex items-center gap-2 pl-7">
        {task.complexity && <span title="Complexité estimée par le plan" className="rounded-full bg-[var(--paper)] px-2 py-0.5 font-mono text-[10px] text-[var(--muted)]">{task.complexity}</span>}
        {assignee?.nickname && <span data-testid="tracking-card-assignee" className="flex min-w-0 items-center gap-1.5">
          <AgentAvatar nickname={assignee.nickname} avatar={assignee.avatar} size={18} />
          <AgentName name="" nickname={assignee.nickname} role={assignee.role} className="truncate text-[10px] text-[var(--ink)]" />
        </span>}
        <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--muted)]">{task.id}</span>
      </div>
    </li>
  );
}

export function TrackingPanel({ run }: { run: RunState }) {
  const tasks = run.planTasks;
  if (!tasks || tasks.length === 0) {
    return (
      <div data-testid="tracking-empty" className="grid flex-1 place-items-center p-8 text-center">
        <div className="max-w-xs">
          <KanbanIcon size={18} className="mx-auto text-[var(--muted)]" />
          <p className="mt-3 text-xs font-medium text-[var(--ink)]">Pas encore de plan pour ce run.</p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">Les tâches apparaissent ici dès que le plan d’implémentation est écrit, puis avancent seules au fil du run.</p>
        </div>
      </div>
    );
  }
  return (
    <div data-testid="tracking-board" className="grid min-h-0 flex-1 auto-rows-min gap-4 overflow-y-auto p-5 md:grid-cols-3">
      {COLUMNS.map(({ status, title }) => {
        const column = tasks.filter((task) => task.status === status);
        return (
          <section key={status} data-testid={`tracking-column-${status}`} aria-labelledby={`tracking-${status}`} className="rounded-lg border border-[var(--line)] bg-[var(--paper)] p-2.5">
            <h3 id={`tracking-${status}`} className="flex items-center gap-2 px-1.5 pb-2.5 pt-1 text-sm font-semibold">
              {title}
              <span role="status" aria-live="polite" aria-label={`${column.length} tâche${column.length > 1 ? "s" : ""}`} className="rounded-full bg-[var(--line)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--ink)]">{column.length}</span>
            </h3>
            <ul className="space-y-2">{column.map((task) => <TaskCard key={task.id} task={task} />)}</ul>
          </section>
        );
      })}
    </div>
  );
}
