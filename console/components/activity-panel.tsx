"use client";

import { ArrowRightIcon, CheckIcon, CircleNotchIcon, FileTextIcon, RobotIcon, WarningIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { activeAgents, elapsedLabel, generatedDocuments, healthNotice, isDemoRun } from "@/lib/run-state";
import { useNow } from "@/lib/use-now";
import type { RunState } from "@/lib/types";
import { AgentAvatar, AgentName } from "./agent-avatar";
import { DocumentViewer } from "./document-viewer";

export function ActivityPanel({ run, onFeedback, refusedFeedback, onShowQuestion }: { run: RunState; onFeedback: (body: string) => boolean; refusedFeedback?: { requestId: string; body: string }; onShowQuestion: () => void }) {
  const runningAgents = activeAgents(run.agents);
  const now = useNow(runningAgents.length > 0);
  const [feedback, setFeedback] = useState("");
  const [queued, setQueued] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const demo = isDemoRun(run.id);
  const documents = generatedDocuments(run.artifacts);
  const ended = run.status === "completed" || run.status === "stopped" || run.status === "failed";
  const submitFeedback = () => {
    if (!feedback.trim()) return;
    // The demonstration shows the panel without feeding the loop: a simulated
    // feedback would write a real file in data/feedback/pending/.
    // Not sent, the text stays in the field: the page says why above.
    if (!demo && !onFeedback(feedback)) return;
    setFeedback("");
    setQueued(true);
  };
  // The server answers nothing when it saves a feedback, so the field is cleared
  // as soon as it left. A refusal comes after: the text goes back, unless the
  // user already started another one.
  useEffect(() => {
    if (!refusedFeedback) return;
    setQueued(false);
    setFeedback((current) => current || refusedFeedback.body);
  }, [refusedFeedback?.requestId]);
  return (
    <aside className="scrollbar-thin flex min-h-0 flex-col bg-[var(--tint)] lg:overflow-y-auto">
      {ended && <div className="mx-4 mb-4 mt-4 shrink-0 rounded-3 border border-[var(--line)] bg-[var(--raised)] p-4">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] font-semibold" htmlFor="run-feedback">Improve the harness</label>
          {demo && <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[9px] text-[var(--accent)]">demo</span>}
        </div>
        <textarea id="run-feedback" value={feedback} onChange={(event) => { setFeedback(event.target.value); setQueued(false); }} rows={2} placeholder="What was slow, missing or broken…" className="field mt-2 resize-none text-[11px] leading-4" />
        <button type="button" disabled={!feedback.trim()} onClick={submitFeedback} className="mt-2 w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-[11px] font-semibold text-[var(--on-accent)] transition hover:opacity-90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35">Add to the self-improvement loop</button>
        {queued && <p className="mt-2 text-[10px] leading-4 text-[var(--accent)]">{demo ? "Simulated feedback. Nothing was saved." : <>Feedback saved. Run <code>impl improve</code> to produce the improvement.</>}</p>}
      </div>}
      {run.error && !healthNotice(run)?.incident && <div className="m-4 flex gap-2.5 rounded-2.5 border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800"><WarningIcon className="mt-0.5 shrink-0" size={15} /> {run.error}</div>}
      {!(ended && runningAgents.length === 0) && <section aria-labelledby="active-agents-title" className="shrink-0 border-b border-[var(--line)] p-5">
        <div className="mb-4 flex items-center justify-between"><h2 id="active-agents-title" className="text-xs font-semibold">Agents</h2><span className="font-mono text-[10px] text-[var(--muted)]">{runningAgents.length} active</span></div>
        {runningAgents.length === 0 ? <div className="flex items-center gap-3 py-2 text-xs text-[var(--muted)]"><div className="grid size-8 place-items-center rounded-full border border-dashed border-[var(--line)]"><RobotIcon size={14} /></div>No active agent</div> :
          <div className="space-y-2.5">{runningAgents.slice(0, 5).map((agent, index) => <div key={agent.id} className="reveal flex items-center gap-3" style={{ animationDelay: `${index * 55}ms` }}>
            {agent.nickname ? <div className="relative">
              <AgentAvatar nickname={agent.nickname} avatar={agent.avatar} />
              <span className={`absolute -bottom-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full bg-[var(--raised)] shadow-[inset_0_0_0_1px_var(--line)] ${agent.status === "failed" ? "text-amber-600" : "text-[var(--accent)]"}`}>{agent.status === "running" ? <CircleNotchIcon className="animate-spin" size={9} /> : agent.status === "failed" ? <WarningIcon size={9} weight="fill" /> : <CheckIcon size={8} weight="bold" />}</span>
            </div> : <div className={`grid size-8 place-items-center rounded-full bg-[var(--raised)] shadow-[inset_0_0_0_1px_var(--line)] ${agent.status === "failed" ? "text-amber-600" : "text-[var(--accent)]"}`}>{agent.status === "running" ? <CircleNotchIcon className="animate-spin" size={14} /> : agent.status === "failed" ? <WarningIcon size={14} weight="fill" /> : <CheckIcon size={13} weight="bold" />}</div>}
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={agent.name}><AgentName name={agent.name} nickname={agent.nickname} role={agent.role} /></p><p className="mt-0.5 font-mono text-[9px] text-[var(--muted)]">{elapsedLabel(agent.startedAt, agent.endedAt, now)}</p></div>
          </div>)}</div>}
      </section>}
      {/*
        The event feed used to live here. It was the noisiest surface of the
        console and the one the conversation, the terminal and the progression
        already say between them, so its column is spent on the decisions and
        the documents instead. Every event is still archived in full in
        data/runs/<id>/run.json, which is what the self-audit reads.
      */}
      <div className="flex-1" />
      <section className="shrink-0 border-t border-[var(--line)] p-5">
        <button type="button" disabled={documents.length === 0} onClick={() => setDocumentsOpen(true)} title="Context, plans, test and review reports, MR description" className="flex w-full items-center justify-between rounded-md text-xs transition hover:text-[var(--accent)] disabled:cursor-default disabled:text-[var(--muted)]"><span className="flex items-center gap-2 font-medium"><FileTextIcon size={14} /> Generated documents</span><span className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--accent)]">{documents.length}<ArrowRightIcon size={11} /></span></button>
      </section>
      {documentsOpen && <DocumentViewer runId={run.id ?? ""} archived={Boolean(run.archived)} documents={documents} workflowActive={run.status === "starting" || run.status === "running" || run.status === "attention"} pendingQuestionCount={run.pendingQuestion?.questions.length ?? 0} onClose={() => setDocumentsOpen(false)} onAnswer={() => { setDocumentsOpen(false); onShowQuestion(); }} />}
    </aside>
  );
}
