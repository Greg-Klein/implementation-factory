"use client";

import { InfoIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import type { Notice } from "@/lib/types";

/**
 * What the harness itself did, as opposed to what a run did: a launch put in the
 * queue, an improvement branch replayed, a queued launch that could not start.
 * These used to land in the activity feed of whichever run happened to be
 * current, which with several runs means a feed picked at random, so they get
 * their own line above the runs instead.
 */
export function NoticeStrip({ notice, onDismiss }: { notice?: Notice; onDismiss: () => void }) {
  if (!notice) return null;
  const attention = notice.level === "attention";
  return (
    <div
      key={notice.at}
      role="status"
      className={`reveal flex items-start justify-between gap-3 border-b px-5 py-2.5 md:px-7 ${attention ? "border-amber-200 bg-amber-50 text-amber-900" : "border-[var(--line)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"}`}
    >
      <p className="flex min-w-0 items-start gap-2.5 text-[11px] leading-5">
        {attention ? <WarningIcon className="mt-0.5 shrink-0" size={13} weight="fill" /> : <InfoIcon className="mt-0.5 shrink-0" size={13} weight="fill" />}
        <span className="min-w-0"><span className="font-semibold">{notice.title}</span>{notice.detail && <span className="ml-1.5 break-words opacity-80">{notice.detail}</span>}</span>
      </p>
      <button type="button" onClick={onDismiss} aria-label="Masquer ce message" className="grid size-6 shrink-0 place-items-center rounded-md transition hover:bg-[var(--raised)]/70 active:translate-y-px"><XIcon size={12} /></button>
    </div>
  );
}
