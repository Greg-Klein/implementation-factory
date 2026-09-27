"use client";

import { ArrowRightIcon, CheckIcon, CircleNotchIcon, FileTextIcon, RobotIcon, WarningIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { activeAgents, elapsedLabel, generatedDocuments, healthNotice, isDemoRun } from "@/lib/run-state";
import { useNow } from "@/lib/use-now";
import type { RunState } from "@/lib/types";
import { AgentAvatar, AgentName } from "./agent-avatar";
import { DocumentViewer } from "./document-viewer";

export function ActivityPanel({ run, onFeedback, onShowQuestion }: { run: RunState; onFeedback: (body: string) => void; onShowQuestion: () => void }) {
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
    // La demonstration montre le panneau sans alimenter la boucle : un retour
    // simule ecrirait un vrai fichier dans data/feedback/pending/.
    if (!demo) onFeedback(feedback);
    setFeedback("");
    setQueued(true);
  };
  return (
    <aside className="scrollbar-thin flex min-h-0 flex-col bg-[#f7f8f4] lg:overflow-y-auto">
      {ended && <div className="mx-4 mb-4 mt-4 shrink-0 rounded-3 border border-[var(--line)] bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] font-semibold" htmlFor="run-feedback">Faire progresser le harnais</label>
          {demo && <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[9px] text-[var(--accent)]">démo</span>}
        </div>
        <textarea id="run-feedback" value={feedback} onChange={(event) => { setFeedback(event.target.value); setQueued(false); }} rows={2} placeholder="Ce qui a ralenti, manqué ou mal fonctionné…" className="field mt-2 resize-none text-[11px] leading-4" />
        <button type="button" disabled={!feedback.trim()} onClick={submitFeedback} className="mt-2 w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-[11px] font-semibold text-white transition hover:opacity-90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35">Ajouter à la boucle d’auto-amélioration</button>
        {queued && <p className="mt-2 text-[10px] leading-4 text-[var(--accent)]">{demo ? "Retour simulé. Rien n’a été enregistré." : <>Retour enregistré. Lance <code>impl improve</code> pour produire l&apos;amélioration.</>}</p>}
      </div>}
      {run.error && !healthNotice(run)?.incident && <div className="m-4 flex gap-2.5 rounded-2.5 border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800"><WarningIcon className="mt-0.5 shrink-0" size={15} /> {run.error}</div>}
      {!(ended && runningAgents.length === 0) && <section aria-labelledby="active-agents-title" className="shrink-0 border-b border-[var(--line)] p-5">
        <div className="mb-4 flex items-center justify-between"><h2 id="active-agents-title" className="text-xs font-semibold">Agents</h2><span className="font-mono text-[10px] text-[var(--muted)]">{runningAgents.length} actif{runningAgents.length > 1 ? "s" : ""}</span></div>
        {runningAgents.length === 0 ? <div className="flex items-center gap-3 py-2 text-xs text-[var(--muted)]"><div className="grid size-8 place-items-center rounded-full border border-dashed border-[var(--line)]"><RobotIcon size={14} /></div>Aucun agent actif</div> :
          <div className="space-y-2.5">{runningAgents.slice(0, 5).map((agent, index) => <div key={agent.id} className="reveal flex items-center gap-3" style={{ animationDelay: `${index * 55}ms` }}>
            {agent.nickname ? <div className="relative">
              <AgentAvatar nickname={agent.nickname} avatar={agent.avatar} />
              <span className={`absolute -bottom-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full bg-white shadow-[inset_0_0_0_1px_var(--line)] ${agent.status === "failed" ? "text-amber-600" : "text-[var(--accent)]"}`}>{agent.status === "running" ? <CircleNotchIcon className="animate-spin" size={9} /> : agent.status === "failed" ? <WarningIcon size={9} weight="fill" /> : <CheckIcon size={8} weight="bold" />}</span>
            </div> : <div className={`grid size-8 place-items-center rounded-full bg-white shadow-[inset_0_0_0_1px_var(--line)] ${agent.status === "failed" ? "text-amber-600" : "text-[var(--accent)]"}`}>{agent.status === "running" ? <CircleNotchIcon className="animate-spin" size={14} /> : agent.status === "failed" ? <WarningIcon size={14} weight="fill" /> : <CheckIcon size={13} weight="bold" />}</div>}
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
        <button type="button" disabled={documents.length === 0} onClick={() => setDocumentsOpen(true)} title="Contexte, plans, rapports de tests et de review, description de MR" className="flex w-full items-center justify-between rounded-md text-xs transition hover:text-[var(--accent)] disabled:cursor-default disabled:text-[var(--muted)]"><span className="flex items-center gap-2 font-medium"><FileTextIcon size={14} /> Documents générés</span><span className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--accent)]">{documents.length}<ArrowRightIcon size={11} /></span></button>
      </section>
      {documentsOpen && <DocumentViewer runId={run.id ?? ""} archived={Boolean(run.archived)} documents={documents} workflowActive={run.status === "starting" || run.status === "running" || run.status === "attention"} pendingQuestionCount={run.pendingQuestion?.questions.length ?? 0} onClose={() => setDocumentsOpen(false)} onAnswer={() => { setDocumentsOpen(false); onShowQuestion(); }} />}
    </aside>
  );
}
