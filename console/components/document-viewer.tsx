"use client";

import { CircleNotchIcon, FileTextIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { artifactUrl, pendingAnswerLabel } from "@/lib/run-state";
import type { ArtifactResponse } from "@/lib/types";

export function DocumentViewer({ runId, archived = false, documents, workflowActive, pendingQuestionCount, onClose, onAnswer }: { runId: string; archived?: boolean; documents: string[]; workflowActive: boolean; pendingQuestionCount: number; onClose: () => void; onAnswer: () => void }) {
  const [selected, setSelected] = useState(() => documents.at(-1) ?? "");
  const [document, setDocument] = useState<ArtifactResponse>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setDocument(undefined);
    fetch(artifactUrl({ id: runId, archived }, selected), { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as ArtifactResponse;
        if (!response.ok) throw new Error(result.error ?? "Impossible de charger ce document.");
        setDocument(result);
      })
      .catch((error) => { if (!controller.signal.aborted) setDocument({ path: selected, content: error instanceof Error ? error.message : "Impossible de charger ce document." }); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [runId, selected, archived]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Documents générés" className="fixed inset-0 z-50 grid place-items-center bg-[#17201bb8] p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="grid h-[min(760px,88vh)] w-[min(1120px,94vw)] grid-cols-[270px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-5 border border-white/15 bg-[var(--surface)] shadow-[0_32px_90px_-28px_rgba(0,0,0,.6)]">
        <aside className="flex min-h-0 flex-col border-r border-[var(--line)] bg-[#f1f3ee] p-4">
          <div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-semibold">Documents générés</p><p className="mt-1 font-mono text-[9px] text-[var(--muted)]">{documents.length} fichier{documents.length > 1 ? "s" : ""}</p></div><FileTextIcon size={16} className="text-[var(--accent)]" /></div>
          <nav className="scrollbar-thin min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" aria-label="Liste des documents">
            {documents.map((name) => <button key={name} type="button" onClick={() => setSelected(name)} className={`w-full rounded-lg px-3 py-2.5 text-left font-mono text-[10px] leading-4 transition ${selected === name ? "bg-[var(--ink)] text-white" : "text-[var(--muted)] hover:bg-white hover:text-[var(--ink)]"}`}><span className="block break-all">{name}</span></button>)}
          </nav>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--line)] px-5"><div className="min-w-0"><p className="truncate text-xs font-semibold">{selected}</p><p className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--muted)]">{workflowActive && <span className="size-1.5 rounded-full bg-[var(--accent)] status-breathe" />}{workflowActive ? "Le workflow continue en arrière-plan" : "Aperçu en lecture seule"}</p></div><button type="button" onClick={onClose} aria-label="Fermer" className="grid size-8 place-items-center rounded-full border border-[var(--line)] transition hover:bg-white active:scale-95"><XIcon size={14} /></button></header>
          {pendingQuestionCount > 0 && <div className="flex shrink-0 items-center justify-between gap-4 border-b border-amber-200 bg-amber-50 px-5 py-3 text-amber-900"><div className="flex min-w-0 items-center gap-2.5"><WarningIcon size={15} weight="fill" className="shrink-0" /><p className="truncate text-[11px] font-semibold">{pendingAnswerLabel(pendingQuestionCount)}</p></div><button type="button" onClick={onAnswer} className="shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-[10px] font-semibold transition hover:bg-amber-100 active:translate-y-px">Répondre</button></div>}
          <div className="scrollbar-thin min-h-0 flex-1 overflow-auto bg-white p-6">
            {loading ? <div className="flex items-center gap-2 text-xs text-[var(--muted)]"><CircleNotchIcon className="animate-spin" size={14} />Chargement du document…</div>
              : document?.encoding === "base64" && document.contentType ? <img src={`data:${document.contentType};base64,${document.content}`} alt={selected} className="mx-auto max-w-full rounded-md border border-[var(--line)]" />
              : <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[#303733]">{document?.content}</pre>}
          </div>
        </div>
      </section>
    </div>
  );
}
