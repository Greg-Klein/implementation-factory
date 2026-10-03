"use client";

import { ArrowDownIcon, ArrowUpIcon, CaretRightIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { heldBySchedule, queueGroups, queueMoveTarget, queueStatus, runLabel, scheduleMark } from "@/lib/run-state";
import { ticketReference } from "@/lib/ticket-urls";
import type { QueuedRunView } from "@/lib/types";

export type QueueActions = {
  cancel: (queuedId: string) => void;
  /** Starts a held ticket anyway: from the base branch, or stacked on the branch of the ticket it waits for. */
  force: (queuedId: string, mode: "base" | "stacked", onto?: string) => void;
  move: (queuedId: string, before: string | null) => void;
};

const iconButton = "grid size-5 shrink-0 place-items-center rounded-md text-[var(--muted)] transition hover:bg-[var(--raised)] hover:text-[var(--ink)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";
const override = "w-full rounded-lg border border-[var(--line)] bg-[var(--raised)] px-2.5 py-1.5 text-left text-[11px] font-medium text-[var(--ink)] transition hover:bg-[var(--paper)] active:translate-y-px";

function batchTime(queuedAt: string) {
  const date = new Date(queuedAt);
  return Number.isNaN(date.getTime()) ? "" : ` de ${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Why the ticket waits, in the scheduling agent's own words, and the two ways
 * to start it anyway. Folded by default: the row already says what it waits
 * for, and an override is a decision, not a habit.
 */
function Justification({ entry, label, actions }: { entry: QueuedRunView; label: string; actions: QueueActions }) {
  const other = entry.blocking ? ticketReference(entry.blocking.issueUrl) : undefined;
  const branch = entry.blocking?.branch;
  return (
    <details className="group/why mt-1">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] font-medium text-[var(--muted)] transition hover:text-[var(--ink)] [&::-webkit-details-marker]:hidden">
        <CaretRightIcon size={9} weight="bold" aria-hidden className="transition-transform group-open/why:rotate-90" />
        Pourquoi il attend
      </summary>
      <div className="mt-1.5 space-y-2">
        {entry.detail && <p className="text-[10px] leading-4 text-[var(--ink)]">{entry.detail}</p>}
        {entry.summary && <p className="text-[10px] leading-4 text-[var(--muted)]">Ce ticket : {entry.summary}</p>}
        {entry.reason === "analysis" && <p className="text-[10px] leading-4 text-[var(--muted)]">Les tickets du lot sont comparés pour savoir lesquels peuvent tourner en même temps.</p>}
        {entry.reason === "merge_unknown" && <p className="text-[10px] leading-4 text-amber-800">GitLab ne répond pas : le ticket reste en attente tant que l’état de la merge request n’est pas connu.</p>}
        <div>
          <button type="button" className={override} onClick={() => actions.force(entry.id, "base")} aria-label={`Lancer ${label} depuis la base`}>Lancer depuis la base</button>
          <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">
            {other
              ? <>Part sans attendre {other}. Les deux tickets touchent le même code : la seconde merge request devra sans doute être reprise à la main.</>
              : <>Part sans attendre la fin de l’analyse. Rien ne dit encore s’il touche le même code qu’un autre ticket.</>}
          </p>
        </div>
        {other && branch && (
          <div>
            <button type="button" className={override} onClick={() => actions.force(entry.id, "stacked", entry.blocking?.issueUrl)} aria-label={`Empiler ${label} sur ${branch}`}>
              Empiler sur <span className="font-mono text-[10px]">{branch}</span>
            </button>
            <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">Part de la branche de {other} et ouvre sa merge request vers cette branche. Elle ne pourra être mergée qu’après celle de {other}.</p>
          </div>
        )}
      </div>
    </details>
  );
}

/** `label` names the ticket to a screen reader; `title` is what the row shows, shorter under a repository heading. */
function QueuedRow({ entry, label, title, index, queued, siblings, actions }: { entry: QueuedRunView; label: string; title: string; index: number; queued: QueuedRunView[]; siblings: QueuedRunView[]; actions: QueueActions }) {
  const mark = scheduleMark(entry);
  const up = queueMoveTarget(queued, siblings, entry.id, "up");
  const down = queueMoveTarget(queued, siblings, entry.id, "down");
  const held = heldBySchedule(entry);
  const tone = entry.reason === "merge_unknown" ? "text-amber-800" : "text-[var(--muted)]";
  return (
    <div style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }} className="reveal flex items-start gap-2.5 px-3.5 py-2">
      <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full border border-[var(--muted)] ${entry.reason === "analysis" ? "status-breathe bg-[var(--muted)]" : ""}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1">
          <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--ink)]" title={label}>{title}</p>
          {siblings.length > 1 && <>
            <button type="button" disabled={up === undefined} onClick={() => up !== undefined && actions.move(entry.id, up)} aria-label={`Monter ${label} dans la file`} className={iconButton}><ArrowUpIcon size={10} /></button>
            <button type="button" disabled={down === undefined} onClick={() => down !== undefined && actions.move(entry.id, down)} aria-label={`Descendre ${label} dans la file`} className={iconButton}><ArrowDownIcon size={10} /></button>
          </>}
          <button type="button" onClick={() => actions.cancel(entry.id)} aria-label={`Retirer ${label} de la file`} className={iconButton}><XIcon size={11} /></button>
        </div>
        <p className={`mt-0.5 flex items-start gap-1 text-[10px] leading-4 ${tone}`} title={entry.blockedBy ? `Bloqué par le run ${entry.blockedBy}` : undefined}>
          {entry.reason === "merge_unknown" && <WarningIcon size={10} weight="fill" aria-hidden className="mt-0.5 shrink-0" />}
          <span>{queueStatus(entry)}</span>
        </p>
        {mark && <p className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-amber-800" title={mark.title}><WarningIcon size={10} weight="fill" aria-hidden className="shrink-0" />{mark.label}</p>}
        {held && !entry.forced && <Justification entry={entry} label={label} actions={actions} />}
      </div>
    </div>
  );
}

/**
 * Everything waiting to start, by batch then by repository: tickets of two
 * repositories never hold each other, so the repository is what a wait is read
 * against. A launch made alone keeps the single row it always had.
 */
export function QueueList({ queued, actions }: { queued: QueuedRunView[]; actions: QueueActions }) {
  if (queued.length === 0) return null;
  let index = 0;
  return (
    <div role="group" aria-label="Runs en file d'attente" className="border-t border-[var(--line)] bg-[var(--sunken)]">
      <p className="px-3.5 pb-1 pt-2.5 font-mono text-[9px] uppercase tracking-[.08em] text-[var(--muted)]">En file · {queued.length}</p>
      <div className="divide-y divide-[var(--line)]">
        {queueGroups(queued).map((group) => (
          <div key={group.key} role={group.batchId ? "group" : undefined} aria-label={group.batchId ? `Lot${batchTime(group.queuedAt)}` : undefined}>
            {group.batchId && <p className="px-3.5 pt-2 text-[10px] font-semibold text-[var(--ink)]">Lot{batchTime(group.queuedAt)} <span className="font-normal text-[var(--muted)]">· {group.count} ticket{group.count > 1 ? "s" : ""} en file</span></p>}
            {group.repositories.map((bucket) => (
              <div key={bucket.repository}>
                {group.batchId && <p className="truncate px-3.5 pt-1.5 font-mono text-[9px] text-[var(--muted)]" title={bucket.repository}>{bucket.name}</p>}
                {bucket.entries.map((entry) => <QueuedRow key={entry.id} entry={entry} label={runLabel(entry)} title={group.batchId ? ticketReference(entry.issueUrl) : runLabel(entry)} index={index++} queued={queued} siblings={bucket.entries} actions={actions} />)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
