"use client";

import { CheckIcon, KanbanIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanTask, PlanTaskStatus, RunState } from "@/lib/types";
import { detailParagraphs, hasMoreDetail, markCode, taskAbstract } from "@/lib/plan-task";
import { AgentAvatar, AgentName } from "./agent-avatar";
import { InlineText } from "./inline-text";

const COLUMNS: { status: PlanTaskStatus; title: string }[] = [
  { status: "todo", title: "To Do" },
  { status: "in_progress", title: "In Progress" },
  { status: "done", title: "Done" },
];

const STATUS_LABEL: Record<PlanTaskStatus, string> = { todo: "To do", in_progress: "In progress", done: "Done" };

function StatusMark({ status }: { status: PlanTaskStatus }) {
  if (status === "done") return <span role="img" aria-label={STATUS_LABEL.done} className="grid size-4.5 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[var(--on-accent)]"><CheckIcon size={10} weight="bold" /></span>;
  if (status === "in_progress") return <span role="img" aria-label={STATUS_LABEL.in_progress} className="size-4.5 shrink-0 rounded-full border-2 border-amber-200 border-t-amber-500" />;
  return <span role="img" aria-label={STATUS_LABEL.todo} className="size-4.5 shrink-0 rounded-full border-2 border-[var(--line-strong)]" />;
}

function Assignee({ task }: { task: PlanTask }) {
  const assignee = task.assignee?.nickname ? task.assignee : undefined;
  if (!assignee?.nickname) return null;
  return (
    <span data-testid="tracking-card-assignee" className="flex min-w-0 items-center gap-1.5">
      <AgentAvatar nickname={assignee.nickname} avatar={assignee.avatar} size={18} />
      <AgentName name="" nickname={assignee.nickname} role={assignee.role} className="truncate text-[10px] text-[var(--ink)]" />
    </span>
  );
}

function TaskCard({ task, onOpen }: { task: PlanTask; onOpen: () => void }) {
  return (
    <li data-testid="tracking-card" data-task-id={task.id} data-status={task.status} className="reveal">
      <button type="button" onClick={onOpen} aria-haspopup="dialog" className="block w-full rounded-lg border border-[var(--line)] bg-[var(--raised)] p-3 text-left transition hover:border-[var(--line-strong)] active:translate-y-px">
        <span className="flex items-start gap-2.5">
          <StatusMark status={task.status} />
          <span className="block min-w-0 flex-1 text-xs font-medium leading-relaxed text-[var(--ink)]">{task.title}</span>
        </span>
        <span className="mt-2.5 flex items-center gap-2 pl-7">
          {task.complexity && <span title="Complexity estimated by the plan" className="rounded-full bg-[var(--paper)] px-2 py-0.5 font-mono text-[10px] text-[var(--muted)]">{task.complexity}</span>}
          <Assignee task={task} />
          <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--muted)]">{task.id}</span>
        </span>
      </button>
    </li>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[var(--line)] pt-4">
      <h3 className="text-[10px] uppercase tracking-[.16em] text-[var(--muted)]">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function IdChips({ ids }: { ids: string[] }) {
  return <p className="flex flex-wrap gap-1.5">{ids.map((id) => <span key={id} className="rounded-full bg-[var(--paper)] px-2 py-0.5 font-mono text-[10px] text-[var(--ink)]">{id}</span>)}</p>;
}

/** What the plan asks of one task, kept to what a reader needs to follow it: the developer-facing detail stays folded, the verification steps and criterion texts stay in the plan document. */
function TaskDetail({ task, onClose }: { task: PlanTask; onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  const abstract = taskAbstract(task);
  useEffect(() => {
    dialog.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      // Looked up on close, not kept from opening: the card is remounted in another column when the task moves while its detail is open.
      document.querySelector<HTMLElement>(`[data-testid="tracking-card"][data-task-id="${CSS.escape(task.id)}"] button`)?.focus();
    };
  }, [onClose, task.id]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#17201bb8] p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="task-detail-title" data-testid="task-detail" className="reveal flex max-h-[80vh] w-[min(560px,94vw)] flex-col overflow-hidden rounded-4.5 border border-white/15 bg-[var(--surface)] shadow-[0_32px_90px_-28px_rgba(0,0,0,.6)] outline-none">
        <header className="flex items-start gap-3 border-b border-[var(--line)] px-5 py-4">
          <StatusMark status={task.status} />
          <div className="min-w-0 flex-1">
            <h2 id="task-detail-title" className="text-sm font-semibold leading-snug text-[var(--ink)]">{task.title}</h2>
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-[var(--muted)]">
              <span className="font-mono">{task.id}</span>
              <span>{STATUS_LABEL[task.status]}</span>
              {task.complexity && <span title="Complexity estimated by the plan" className="rounded-full bg-[var(--paper)] px-2 py-0.5 font-mono">{task.complexity}</span>}
              <Assignee task={task} />
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-7 shrink-0 place-items-center rounded-md text-[var(--muted)] transition hover:bg-[var(--paper)] hover:text-[var(--ink)] active:translate-y-px"><XIcon size={14} /></button>
        </header>
        <div className="scrollbar-thin min-h-0 space-y-4 overflow-y-auto px-5 py-4">
          {abstract
            ? <p className="text-xs leading-relaxed text-[var(--ink)]"><InlineText text={markCode(abstract)} /></p>
            : <p className="text-xs leading-relaxed text-[var(--muted)]">The plan does not describe this task beyond its title.</p>}
          {task.description && hasMoreDetail(task) && <details className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-medium text-[var(--muted)] transition hover:text-[var(--ink)]">Detail for the developer</summary>
            <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-[var(--ink)]">
              {detailParagraphs(task.description).map((paragraph, index) => <p key={index}><InlineText text={markCode(paragraph)} /></p>)}
            </div>
          </details>}
          {task.filePaths && <DetailSection title="Files">
            <ul className="space-y-1">{task.filePaths.map((file) => <li key={file} className="break-all font-mono text-[11px] text-[var(--ink)]">{file}</li>)}</ul>
          </DetailSection>}
          {task.criterionIds && <DetailSection title="Criteria covered"><IdChips ids={task.criterionIds} /></DetailSection>}
          {task.dependencies && <DetailSection title="Depends on"><IdChips ids={task.dependencies} /></DetailSection>}
        </div>
      </section>
    </div>
  );
}

export function TrackingPanel({ run }: { run: RunState }) {
  const tasks = run.planTasks;
  const [openId, setOpenId] = useState<string>();
  const close = useCallback(() => setOpenId(undefined), []);
  const opened = tasks?.find((task) => task.id === openId);
  if (!tasks || tasks.length === 0) {
    return (
      <div data-testid="tracking-empty" className="grid flex-1 place-items-center p-8 text-center">
        <div className="max-w-xs">
          <KanbanIcon size={18} className="mx-auto text-[var(--muted)]" />
          <p className="mt-3 text-xs font-medium text-[var(--ink)]">No plan for this run yet.</p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">Tasks appear here as soon as the implementation plan is written, then move on their own as the run goes.</p>
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
              <span role="status" aria-live="polite" aria-label={`${column.length} task${column.length > 1 ? "s" : ""}`} className="rounded-full bg-[var(--line)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--ink)]">{column.length}</span>
            </h3>
            <ul className="space-y-2">{column.map((task) => <TaskCard key={task.id} task={task} onOpen={() => setOpenId(task.id)} />)}</ul>
          </section>
        );
      })}
      {opened && <TaskDetail task={opened} onClose={close} />}
    </div>
  );
}
