"use client";

import { TrashIcon, WarningIcon } from "@phosphor-icons/react";
import type { WorktreeResult } from "@/lib/types";

const secondary = "flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--raised)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--ink)] transition hover:bg-[var(--paper)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40";

/**
 * What the server answered to a worktree removal that did not simply go
 * through: work that would be lost, which the user confirms or gives up, or a
 * refusal. The removal itself is asked from the header of the run; a removal
 * that succeeded shows in the run state and needs no band.
 */
export function WorktreePanel({ result, connected, onConfirm, onDismiss }: {
  result?: WorktreeResult | undefined;
  connected: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  if (!result || result.outcome === "removed") return null;
  const confirm = result.outcome === "confirm";
  return (
    <section aria-label={confirm ? "Confirm the worktree removal" : "Worktree removal refused"} role={confirm ? undefined : "alert"} className="reveal shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
      <div className="flex items-start gap-2.5">
        <WarningIcon className="mt-0.5 shrink-0" size={15} weight="fill" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold leading-5">{confirm ? "This worktree holds unsaved work" : "Worktree not removed"}</p>
          <p className="text-[11px] leading-5 opacity-90">{result.message}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {confirm && <button type="button" disabled={!connected} onClick={onConfirm} className={secondary}><TrashIcon size={12} /> Remove anyway</button>}
            <button type="button" onClick={onDismiss} className={`${secondary} text-[var(--muted)]`}>{confirm ? "Cancel" : "Close"}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
