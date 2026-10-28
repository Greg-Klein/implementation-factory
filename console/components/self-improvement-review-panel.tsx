"use client";

import { ArrowCounterClockwiseIcon, CheckIcon, CircleNotchIcon, CodeIcon, FileTextIcon, TrashIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { AutomaticMerge, PendingSelfImprovementReview } from "@/lib/types";
import { useTexts } from "./language";

type ShownDocument = { worktreeName: string; kind: "diff" | "report" };

function DocumentModal({ worktreeName, kind, onClose }: ShownDocument & { onClose: () => void }) {
  const t = useTexts().shell;
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/self-improvement/${kind}?worktree=${encodeURIComponent(worktreeName)}`)
      .then((r) => r.json() as Promise<{ diff?: string; report?: string; error?: string }>)
      .then((data) => { if (data.error) setError(data.error); else setText(data.diff ?? data.report ?? ""); })
      .catch(() => setError(kind === "diff" ? t.fetchDiffError : t.fetchReportError));
  }, [worktreeName, kind]);

  return (
    <div role="dialog" aria-modal="true" aria-label={kind === "diff" ? t.diffDialog : t.reportDialog} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-4.5 border border-[var(--line)] bg-[var(--surface)] shadow-[0_30px_80px_-30px_rgba(20,30,25,.55)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold">{kind === "diff" ? <CodeIcon size={15} /> : <FileTextIcon size={15} />} {kind === "diff" ? t.improvements : t.report} · {worktreeName}</div>
          <button type="button" onClick={onClose} className="grid size-7 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--paper)] hover:text-[var(--ink)]"><XIcon size={15} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!text && !error && <p className="p-5 text-xs text-[var(--muted)]">{kind === "diff" ? t.loadingDiff : t.loadingReport}</p>}
          {error && <p className="p-5 text-xs text-red-700">{error}</p>}
          {text && (
            <pre className={`whitespace-pre-wrap ${kind === "diff" ? "break-all" : "break-words"} p-5 font-mono text-[11px] leading-5`}>
              {text.split("\n").map((line, i) => (
                <span key={i} className={kind === "report" ? "text-[var(--ink)]" : line.startsWith("+") && !line.startsWith("+++") ? "text-emerald-700" : line.startsWith("-") && !line.startsWith("---") ? "text-red-700" : line.startsWith("@@") ? "text-blue-600" : "text-[var(--ink)]"}>
                  {line}{"\n"}
                </span>
              ))}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One strip per pending improvement, above the runs. Each used to be a stacked
 * card with buttons spanning the whole console: a review prompt that took a
 * quarter of the window and pushed the run it belonged next to off the bottom.
 * The card now owns the viewport height, so anything above the runs has to earn
 * its pixels, and this earns one line.
 */
function Strip({ tone, children }: { tone: "accent" | "muted"; children: React.ReactNode }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-5 py-2.5 md:px-7 ${tone === "accent" ? "border-[var(--line)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--paper)]"}`}>
      {children}
    </div>
  );
}

function Name({ children }: { children: React.ReactNode }) {
  return <span className="truncate font-mono text-[9px] text-[var(--muted)]">{children}</span>;
}

const ACTION = "flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--raised)] px-2.5 py-1.5 text-[11px] font-medium transition hover:bg-[var(--paper)] active:translate-y-px";

function AnalyzingRow({ review }: { review: PendingSelfImprovementReview }) {
  const t = useTexts().shell;
  return (
    <Strip tone="muted">
      <p className="flex min-w-0 items-center gap-2 text-[11px]">
        <CircleNotchIcon size={12} className="shrink-0 animate-spin text-[var(--muted)]" />
        <span className="font-semibold text-[var(--muted)]">{t.analyzing}</span>
        <Name>{review.worktreeName}</Name>
      </p>
    </Strip>
  );
}

function FinishedRow({ review, onClean, onViewReport }: { review: PendingSelfImprovementReview; onClean: () => void; onViewReport: () => void }) {
  const t = useTexts().shell;
  return (
    <Strip tone="muted">
      <p className="flex min-w-0 items-center gap-2 text-[11px]">
        <span className="font-semibold text-[var(--muted)]">{t.finishedNoCommit}</span>
        <Name>{review.worktreeName} · {t.nothingToMerge}</Name>
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={onViewReport} className={ACTION}><FileTextIcon size={12} /> {t.viewReport}</button>
        <button type="button" onClick={onClean} className={`${ACTION} text-[var(--muted)] hover:text-red-700`}><TrashIcon size={12} /> {t.cleanUp}</button>
      </div>
    </Strip>
  );
}

function CheckingRow({ review }: { review: PendingSelfImprovementReview }) {
  const t = useTexts().shell;
  return (
    <Strip tone="muted">
      <p className="flex min-w-0 items-center gap-2 text-[11px]">
        <CircleNotchIcon size={12} className="shrink-0 animate-spin text-[var(--muted)]" />
        <span className="font-semibold text-[var(--muted)]">{review.autoMerge?.state === "checking" ? t.checkingBeforeMerge : t.committedWaiting}</span>
        <Name>{review.worktreeName} · {t.commits(review.commits)}</Name>
      </p>
    </Strip>
  );
}

function MergedRow({ merge, onRevert, onViewReport, onDismiss }: { merge: AutomaticMerge; onRevert: () => void; onViewReport: () => void; onDismiss: () => void }) {
  const t = useTexts().shell;
  return (
    <Strip tone="muted">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex min-w-0 items-center gap-2 text-[11px]">
          <CheckIcon size={12} weight="bold" className="shrink-0 text-[var(--accent)]" />
          <span className="font-semibold text-[var(--ink)]">{t.mergedAutomatically}</span>
          <Name>{merge.worktreeName}</Name>
        </p>
        {merge.reasons[0] && <p className="text-[10px] leading-4 text-[var(--muted)]">{merge.reasons[0]}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={onViewReport} className={ACTION}><FileTextIcon size={12} /> {t.viewReport}</button>
        <button type="button" onClick={onRevert} className={`${ACTION} text-[var(--muted)] hover:text-red-700`}><ArrowCounterClockwiseIcon size={12} /> {t.revert}</button>
        <button type="button" onClick={onDismiss} aria-label={t.close} title={t.close} className="grid size-7 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--raised)] hover:text-[var(--ink)]"><XIcon size={13} /></button>
      </div>
    </Strip>
  );
}

function ReviewRow({ review, onApprove, onReject, onViewDiff }: { review: PendingSelfImprovementReview; onApprove: () => void; onReject: () => void; onViewDiff: () => void }) {
  const t = useTexts().shell;
  return (
    <Strip tone="accent">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex min-w-0 items-center gap-2 text-[11px]">
          <span className="font-semibold text-[var(--accent)]">{t.improvementsReady}</span>
          <Name>{review.worktreeName} · {t.commits(review.commits)}</Name>
        </p>

        {review.mergesCleanly === false && (
          <p className="flex items-start gap-1.5 text-[10px] leading-4 text-red-700">
            <WarningIcon size={12} className="mt-px shrink-0" />
            {t.realConflict}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={onViewDiff} className={ACTION}><CodeIcon size={12} /> {t.viewChanges}</button>
        <button type="button" onClick={onApprove} className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--on-accent)] transition hover:opacity-90 active:translate-y-px"><CheckIcon size={12} weight="bold" /> {t.merge}</button>
        <button type="button" onClick={onReject} className={`${ACTION} text-[var(--muted)] hover:text-red-700`}><TrashIcon size={12} /> {t.dismiss}</button>
      </div>
    </Strip>
  );
}

const DISMISSED_MERGES_KEY = "impl.dismissedMerges";

function readDismissedMerges(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_MERGES_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeDismissedMerges(names: string[]) {
  try { localStorage.setItem(DISMISSED_MERGES_KEY, JSON.stringify(names)); } catch { /* storage unavailable: the banner comes back on reload */ }
}

export function SelfImprovementReviewPanel({ reviews, merged = [], onApprove, onReject, onRevert }: { reviews: PendingSelfImprovementReview[]; merged?: AutomaticMerge[]; onApprove: (worktreeName: string) => void; onReject: (worktreeName: string) => void; onRevert: (worktreeName: string) => void }) {
  const [shown, setShown] = useState<ShownDocument | null>(null);
  // Read after mount: the server renders this page and has no localStorage.
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => setDismissed(readDismissedMerges()), []);
  const dismiss = (worktreeName: string) => {
    // Only the merges still listed are kept, so the stored list does not grow forever.
    const next = [...dismissed.filter((name) => merged.some((merge) => merge.worktreeName === name)), worktreeName];
    setDismissed(next);
    writeDismissedMerges(next);
  };
  const shownMerges = merged.filter((merge) => !dismissed.includes(merge.worktreeName));

  if (reviews.length === 0 && shownMerges.length === 0) return null;

  return (
    <>
      {shownMerges.map((merge) => <MergedRow key={`merged-${merge.worktreeName}`} merge={merge} onRevert={() => onRevert(merge.worktreeName)} onDismiss={() => dismiss(merge.worktreeName)} onViewReport={() => setShown({ worktreeName: merge.worktreeName, kind: "report" })} />)}
      {reviews.map((review) => review.status === "analyzing"
        ? <AnalyzingRow key={review.worktreeName} review={review} />
        : review.status === "ready" && review.autoMerge
        ? <CheckingRow key={review.worktreeName} review={review} />
        : review.status === "finished"
        ? <FinishedRow key={review.worktreeName} review={review} onClean={() => onReject(review.worktreeName)} onViewReport={() => setShown({ worktreeName: review.worktreeName, kind: "report" })} />
        : <ReviewRow key={review.worktreeName} review={review} onApprove={() => onApprove(review.worktreeName)} onReject={() => onReject(review.worktreeName)} onViewDiff={() => setShown({ worktreeName: review.worktreeName, kind: "diff" })} />)}
      {shown && <DocumentModal {...shown} onClose={() => setShown(null)} />}
    </>
  );
}
