"use client";

import { CheckIcon, CircleNotchIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { longDateTime } from "@/lib/i18n";
import type { FindingFixView, FindingsResponse, RecipeResponse } from "@/lib/types";
import { useLanguage, useTexts } from "./language";

const secondary = "flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3.5 py-2 text-xs font-medium text-[var(--ink)] transition hover:bg-[var(--paper)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40";
const acceptButton = "flex items-center gap-1.5 rounded-lg bg-[var(--ink)] px-3.5 py-2 text-xs font-medium text-[var(--on-ink)] transition hover:bg-[var(--ink-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40";

/**
 * What the console keeps about one repository and hands to every run of it:
 * how its app is started and reached, and the kinds of defect its reviews keep
 * finding. Read-only, with one gesture each: forgetting it, so the next runs
 * start again from nothing. `revision` moves when the server answered one of
 * those gestures, which is when the content is read again.
 */
export function RecipeDialog({ repository, revision, connected, onForget, onForgetFindings, onAcceptFix, onDismissFix, onClose }: {
  repository: string;
  revision: number;
  connected: boolean;
  onForget: () => void;
  onForgetFindings: () => void;
  onAcceptFix: (category: string) => void;
  onDismissFix: (category: string) => void;
  onClose: () => void;
}) {
  const language = useLanguage();
  const t = useTexts().launch;
  const [response, setResponse] = useState<RecipeResponse>();
  const [loading, setLoading] = useState(true);
  const [findings, setFindings] = useState<FindingsResponse>();

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/repositories/findings?repository=${encodeURIComponent(repository)}`, { signal: controller.signal })
      .then(async (result) => {
        const body = await result.json() as FindingsResponse;
        if (!result.ok) throw new Error(body.error ?? t.findingsReadError);
        setFindings(body);
      })
      .catch((error) => { if (!controller.signal.aborted) setFindings({ repository, error: error instanceof Error ? error.message : t.findingsReadError }); });
    return () => controller.abort();
  }, [repository, revision]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/repositories/recipe?repository=${encodeURIComponent(repository)}`, { signal: controller.signal })
      .then(async (result) => {
        const body = await result.json() as RecipeResponse;
        if (!result.ok) throw new Error(body.error ?? t.recipeReadError);
        setResponse(body);
      })
      .catch((error) => { if (!controller.signal.aborted) setResponse({ repository, recipe: null, error: error instanceof Error ? error.message : t.recipeReadError }); })
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
    <div role="dialog" aria-modal="true" aria-label={t.recipeDialog} className="fixed inset-0 z-50 grid place-items-center bg-[#17201bb8] p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="flex max-h-[88vh] w-[min(760px,94vw)] flex-col overflow-hidden rounded-5 border border-white/15 bg-[var(--surface)] shadow-[0_32px_90px_-28px_rgba(0,0,0,.6)]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold">{t.recipeDialog}</p>
            <p className="mt-1 truncate font-mono text-[10px] text-[var(--muted)]" title={repository}>{repository}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t.close} className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--line)] transition hover:bg-[var(--raised)] active:scale-95"><XIcon size={14} /></button>
        </header>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto bg-[var(--raised)] p-6">
          {loading ? <div className="flex items-center gap-2 text-xs text-[var(--muted)]"><CircleNotchIcon className="animate-spin" size={14} />{t.readingRecipe}</div>
            : response?.error ? <p role="alert" className="text-xs leading-relaxed text-red-700">{response.error}</p>
            : recipe ? <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[var(--ink)]">{recipe.content}</pre>
            : <p className="text-xs leading-relaxed text-[var(--muted)]">{t.noRecipe}</p>}
          <section aria-label={t.reviewFindings} className="mt-6 border-t border-[var(--line)] pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-[10px] font-semibold uppercase tracking-[.16em] text-[var(--muted)]">{t.reviewFindings}</h3>
                <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
                  {findings?.error ? <span role="alert" className="text-red-700">{findings.error}</span>
                    : !kept ? t.readingFindings
                    : !kept.kept ? t.noneKept
                    : t.findingsKept(kept.kept, kept.tickets)}
                </p>
              </div>
              {Boolean(kept?.kept) && <button type="button" disabled={!connected} onClick={onForgetFindings} title={t.forgetFindingsTitle} className={secondary}><TrashIcon size={12} /> {t.forgetFindings}</button>}
            </div>
            {kept && kept.kept > 0 && !kept.recurring.length && <p className="mt-3 text-xs leading-relaxed text-[var(--ink)]">{t.nothingRecurs}</p>}
            {kept?.recurring.map((group) => (
              <div key={group.category} className="mt-4">
                <p className="text-xs font-semibold text-[var(--ink)]">{group.label}</p>
                <p className="mt-0.5 font-mono text-[10px] text-[var(--muted)]">{t.groupCounts(group.category, group.findings, group.tickets)}</p>
                <ul className="mt-1.5 space-y-1">
                  {group.examples.map((example, index) => (
                    <li key={index} className="text-[11px] leading-5 text-[var(--ink)]"><span className="font-mono text-[10px] text-[var(--muted)]">{example.severity}{example.file ? ` ${example.file}` : ""}</span> {example.summary}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
          <SourceFixes fixes={kept?.fixes} error={findings?.error} connected={connected} onAccept={onAcceptFix} onDismiss={onDismissFix} />
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-3">
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--muted)]">
            {recipe ? t.writtenBy(longDateTime(language, recipe.updatedAt)) : t.recipeSays}
          </p>
          {recipe && <button type="button" disabled={!connected} onClick={onForget} title={t.forgetRecipeTitle} className={secondary}><TrashIcon size={12} /> {t.forgetRecipe}</button>}
        </footer>
      </section>
    </div>
  );
}

/**
 * A durable fix for a kind of defect that came back across runs. Accept writes
 * the block into the repository; dismiss leaves the repository untouched.
 * Neither one runs by itself.
 */
function SourceFixes({ fixes, error, connected, onAccept, onDismiss }: {
  fixes: FindingFixView[] | undefined;
  error: string | undefined;
  connected: boolean;
  onAccept: (category: string) => void;
  onDismiss: (category: string) => void;
}) {
  const t = useTexts().launch;
  return (
    <section aria-label={t.sourceFixes} className="mt-6 border-t border-[var(--line)] pt-5">
      <h3 className="text-[10px] font-semibold uppercase tracking-[.16em] text-[var(--muted)]">{t.sourceFixes}</h3>
      <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
        {error ? <span role="alert" className="text-red-700">{error}</span>
          : !fixes ? t.readingFixes
          : fixes.length === 0 ? t.noFixes
          : t.fixesIntro}
      </p>
      {fixes?.map((fix) => (
        <div key={fix.category} className="mt-4">
          <p className="text-xs font-semibold text-[var(--ink)]">{fix.title}</p>
          <p className="mt-0.5 font-mono text-[10px] text-[var(--muted)]">{t.fixCounts(fix.category, fix.runs, fix.targetFile, fix.kind === "lint" ? fix.tool : undefined)}</p>
          {fix.status === "pending" && <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-[var(--line)] bg-[var(--paper)] p-3 font-mono text-[11px] leading-5 text-[var(--ink)]">{fix.body}</pre>}
          {fix.status === "pending" && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={!connected} onClick={() => onAccept(fix.category)} className={acceptButton}><CheckIcon size={12} /> {t.acceptFix}</button>
              <button type="button" disabled={!connected} onClick={() => onDismiss(fix.category)} className={secondary}>{t.dismissFix}</button>
            </div>
          )}
          {fix.status === "accepted" && <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--ink)]">{fix.settled ? t.fixSettled : t.fixAdded(fix.targetFile)}</p>}
          {fix.status === "dismissed" && <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">{t.fixDismissed}</p>}
        </div>
      ))}
    </section>
  );
}
