"use client";

import { ArrowCounterClockwiseIcon, CheckIcon, CircleNotchIcon, CodeIcon, FileTextIcon, TrashIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { AutomaticMerge, PendingSelfImprovementReview } from "@/lib/types";

type ShownDocument = { worktreeName: string; kind: "diff" | "report" };

function DocumentModal({ worktreeName, kind, onClose }: ShownDocument & { onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/self-improvement/${kind}?worktree=${encodeURIComponent(worktreeName)}`)
      .then((r) => r.json() as Promise<{ diff?: string; report?: string; error?: string }>)
      .then((data) => { if (data.error) setError(data.error); else setText(data.diff ?? data.report ?? ""); })
      .catch(() => setError(kind === "diff" ? "Could not fetch the diff." : "Could not fetch the report."));
  }, [worktreeName, kind]);

  return (
    <div role="dialog" aria-modal="true" aria-label={kind === "diff" ? "Diff of the proposed improvements" : "Self-improvement report"} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-4.5 border border-[var(--line)] bg-[var(--surface)] shadow-[0_30px_80px_-30px_rgba(20,30,25,.55)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold">{kind === "diff" ? <CodeIcon size={15} /> : <FileTextIcon size={15} />} {kind === "diff" ? "Improvements" : "Report"} · {worktreeName}</div>
          <button type="button" onClick={onClose} className="grid size-7 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--paper)] hover:text-[var(--ink)]"><XIcon size={15} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!text && !error && <p className="p-5 text-xs text-[var(--muted)]">{kind === "diff" ? "Loading the diff…" : "Loading the report…"}</p>}
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
  return (
    <Strip tone="muted">
      <p className="flex min-w-0 items-center gap-2 text-[11px]">
        <CircleNotchIcon size={12} className="shrink-0 animate-spin text-[var(--muted)]" />
        <span className="font-semibold text-[var(--muted)]">Self-improvement being analyzed</span>
        <Name>{review.worktreeName}</Name>
      </p>
    </Strip>
  );
}

function FinishedRow({ review, onClean, onViewReport }: { review: PendingSelfImprovementReview; onClean: () => void; onViewReport: () => void }) {
  return (
    <Strip tone="muted">
      <p className="flex min-w-0 items-center gap-2 text-[11px]">
        <span className="font-semibold text-[var(--muted)]">Self-improvement finished without a commit</span>
        <Name>{review.worktreeName} · nothing to merge</Name>
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={onViewReport} className={ACTION}><FileTextIcon size={12} /> View the report</button>
        <button type="button" onClick={onClean} className={`${ACTION} text-[var(--muted)] hover:text-red-700`}><TrashIcon size={12} /> Clean up</button>
      </div>
    </Strip>
  );
}

function CheckingRow({ review }: { review: PendingSelfImprovementReview }) {
  return (
    <Strip tone="muted">
      <p className="flex min-w-0 items-center gap-2 text-[11px]">
        <CircleNotchIcon size={12} className="shrink-0 animate-spin text-[var(--muted)]" />
        <span className="font-semibold text-[var(--muted)]">Improvements being checked before an automatic merge</span>
        <Name>{review.worktreeName} · {review.commits} commit{review.commits > 1 ? "s" : ""}</Name>
      </p>
    </Strip>
  );
}

function MergedRow({ merge, onRevert, onViewReport }: { merge: AutomaticMerge; onRevert: () => void; onViewReport: () => void }) {
  return (
    <Strip tone="muted">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex min-w-0 items-center gap-2 text-[11px]">
          <CheckIcon size={12} weight="bold" className="shrink-0 text-[var(--accent)]" />
          <span className="font-semibold text-[var(--ink)]">Improvements merged automatically</span>
          <Name>{merge.worktreeName}</Name>
        </p>
        {merge.reasons[0] && <p className="text-[10px] leading-4 text-[var(--muted)]">{merge.reasons[0]}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={onViewReport} className={ACTION}><FileTextIcon size={12} /> View the report</button>
        <button type="button" onClick={onRevert} className={`${ACTION} text-[var(--muted)] hover:text-red-700`}><ArrowCounterClockwiseIcon size={12} /> Revert</button>
      </div>
    </Strip>
  );
}

function ReviewRow({ review, onApprove, onReject, onViewDiff }: { review: PendingSelfImprovementReview; onApprove: () => void; onReject: () => void; onViewDiff: () => void }) {
  const held = review.autoMerge?.state === "held" ? review.autoMerge.reasons : undefined;
  return (
    <Strip tone="accent">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex min-w-0 items-center gap-2 text-[11px]">
          <span className="font-semibold text-[var(--accent)]">{held ? "Improvements held for your review" : "Improvements ready"}</span>
          <Name>{review.worktreeName} · {review.commits} commit{review.commits > 1 ? "s" : ""}</Name>
        </p>
        {held?.map((reason, index) => (
          <p key={index} className="flex items-start gap-1.5 text-[10px] leading-4 text-[var(--muted)]">
            {index === 0 && <WarningIcon size={12} className="mt-px shrink-0" />}
            <span className={index === 0 ? "" : "pl-[18px]"}>{reason}</span>
          </p>
        ))}
        {review.mergesCleanly === false && (
          <p className="flex items-start gap-1.5 text-[10px] leading-4 text-red-700">
            <WarningIcon size={12} className="mt-px shrink-0" />
            The automatic rebase on the harness was not enough: this branch has a real conflict. To be reworked by hand.
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={onViewDiff} className={ACTION}><CodeIcon size={12} /> View changes</button>
        <button type="button" onClick={onApprove} className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--on-accent)] transition hover:opacity-90 active:translate-y-px"><CheckIcon size={12} weight="bold" /> Merge</button>
        <button type="button" onClick={onReject} className={`${ACTION} text-[var(--muted)] hover:text-red-700`}><TrashIcon size={12} /> Dismiss</button>
      </div>
    </Strip>
  );
}

export function SelfImprovementReviewPanel({ reviews, merged = [], onApprove, onReject, onRevert }: { reviews: PendingSelfImprovementReview[]; merged?: AutomaticMerge[]; onApprove: (worktreeName: string) => void; onReject: (worktreeName: string) => void; onRevert: (worktreeName: string) => void }) {
  const [shown, setShown] = useState<ShownDocument | null>(null);

  if (reviews.length === 0 && merged.length === 0) return null;

  return (
    <>
      {merged.map((merge) => <MergedRow key={`merged-${merge.worktreeName}`} merge={merge} onRevert={() => onRevert(merge.worktreeName)} onViewReport={() => setShown({ worktreeName: merge.worktreeName, kind: "report" })} />)}
      {reviews.map((review) => review.status === "analyzing"
        ? <AnalyzingRow key={review.worktreeName} review={review} />
        : review.status === "ready" && review.autoMerge?.state === "checking"
        ? <CheckingRow key={review.worktreeName} review={review} />
        : review.status === "finished"
        ? <FinishedRow key={review.worktreeName} review={review} onClean={() => onReject(review.worktreeName)} onViewReport={() => setShown({ worktreeName: review.worktreeName, kind: "report" })} />
        : <ReviewRow key={review.worktreeName} review={review} onApprove={() => onApprove(review.worktreeName)} onReject={() => onReject(review.worktreeName)} onViewDiff={() => setShown({ worktreeName: review.worktreeName, kind: "diff" })} />)}
      {shown && <DocumentModal {...shown} onClose={() => setShown(null)} />}
    </>
  );
}
