"use client";

import { CircleNotchIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { FindingsResponse, RecipeResponse } from "@/lib/types";

const secondary = "flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3.5 py-2 text-xs font-medium text-[var(--ink)] transition hover:bg-[var(--paper)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40";

function writtenLabel(updatedAt: string) {
  return new Date(updatedAt).toLocaleString("en-US", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/**
 * What the console keeps about one repository and hands to every run of it:
 * how its app is started and reached, and the kinds of defect its reviews keep
 * finding. Read-only, with one gesture each: forgetting it, so the next runs
 * start again from nothing. `revision` moves when the server answered one of
 * those gestures, which is when the content is read again.
 */
export function RecipeDialog({ repository, revision, connected, onForget, onForgetFindings, onClose }: {
  repository: string;
  revision: number;
  connected: boolean;
  onForget: () => void;
  onForgetFindings: () => void;
  onClose: () => void;
}) {
  const [response, setResponse] = useState<RecipeResponse>();
  const [loading, setLoading] = useState(true);
  const [findings, setFindings] = useState<FindingsResponse>();

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/repositories/findings?repository=${encodeURIComponent(repository)}`, { signal: controller.signal })
      .then(async (result) => {
        const body = await result.json() as FindingsResponse;
        if (!result.ok) throw new Error(body.error ?? "Could not read the review findings.");
        setFindings(body);
      })
      .catch((error) => { if (!controller.signal.aborted) setFindings({ repository, error: error instanceof Error ? error.message : "Could not read the review findings." }); });
    return () => controller.abort();
  }, [repository, revision]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/repositories/recipe?repository=${encodeURIComponent(repository)}`, { signal: controller.signal })
      .then(async (result) => {
        const body = await result.json() as RecipeResponse;
        if (!result.ok) throw new Error(body.error ?? "Could not read the recipe.");
        setResponse(body);
      })
      .catch((error) => { if (!controller.signal.aborted) setResponse({ repository, recipe: null, error: error instanceof Error ? error.message : "Could not read the recipe." }); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [repository, revision]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const recipe = response?.recipe;
  const kept = findings?.findings;
  return (
    <div role="dialog" aria-modal="true" aria-label="Runtime recipe" className="fixed inset-0 z-50 grid place-items-center bg-[#17201bb8] p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="flex max-h-[88vh] w-[min(760px,94vw)] flex-col overflow-hidden rounded-5 border border-white/15 bg-[var(--surface)] shadow-[0_32px_90px_-28px_rgba(0,0,0,.6)]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold">Runtime recipe</p>
            <p className="mt-1 truncate font-mono text-[10px] text-[var(--muted)]" title={repository}>{repository}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--line)] transition hover:bg-[var(--raised)] active:scale-95"><XIcon size={14} /></button>
        </header>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto bg-[var(--raised)] p-6">
          {loading ? <div className="flex items-center gap-2 text-xs text-[var(--muted)]"><CircleNotchIcon className="animate-spin" size={14} />Reading the recipe…</div>
            : response?.error ? <p role="alert" className="text-xs leading-relaxed text-red-700">{response.error}</p>
            : recipe ? <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[var(--ink)]">{recipe.content}</pre>
            : <p className="text-xs leading-relaxed text-[var(--muted)]">No recipe for this repository. The next run that starts its application will write one.</p>}
          <section aria-label="Review findings" className="mt-6 border-t border-[var(--line)] pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-[10px] font-semibold uppercase tracking-[.16em] text-[var(--muted)]">Review findings</h3>
                <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
                  {findings?.error ? <span role="alert" className="text-red-700">{findings.error}</span>
                    : !kept ? "Reading the findings…"
                    : !kept.kept ? "None kept for this repository. The senior review of its next run will leave its findings here."
                    : `${kept.kept} ${kept.kept > 1 ? "findings" : "finding"} kept from ${kept.tickets} ${kept.tickets > 1 ? "tickets" : "ticket"}. A kind of defect found on two tickets or more in the last 90 days is handed to the developers of the next run.`}
                </p>
              </div>
              {Boolean(kept?.kept) && <button type="button" disabled={!connected} onClick={onForgetFindings} title="The next run of this repository will be told of no recurring defect. A run already going keeps the list it was handed." className={secondary}><TrashIcon size={12} /> Forget the findings</button>}
            </div>
            {kept && kept.kept > 0 && !kept.recurring.length && <p className="mt-3 text-xs leading-relaxed text-[var(--ink)]">Nothing recurs yet: no kind of defect was found on two tickets.</p>}
            {kept?.recurring.map((group) => (
              <div key={group.category} className="mt-4">
                <p className="text-xs font-semibold text-[var(--ink)]">{group.label}</p>
                <p className="mt-0.5 font-mono text-[10px] text-[var(--muted)]">{group.category} · {group.findings} findings on {group.tickets} tickets</p>
                <ul className="mt-1.5 space-y-1">
                  {group.examples.map((example, index) => (
                    <li key={index} className="text-[11px] leading-5 text-[var(--ink)]"><span className="font-mono text-[10px] text-[var(--muted)]">{example.severity}{example.file ? ` ${example.file}` : ""}</span> {example.summary}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-3">
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--muted)]">
            {recipe ? `Written by a run on ${writtenLabel(recipe.updatedAt)}. It is handed to every run of this repository, which checks and corrects it.` : "It says how to start the application, log in and reach a screen."}
          </p>
          {recipe && <button type="button" disabled={!connected} onClick={onForget} title="The next run of this repository will start without a recipe and write a new one. A run already going keeps its own." className={secondary}><TrashIcon size={12} /> Forget the recipe</button>}
        </footer>
      </section>
    </div>
  );
}
