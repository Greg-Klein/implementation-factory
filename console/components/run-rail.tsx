"use client";

import { ArchiveIcon, ClockCounterClockwiseIcon, GitBranchIcon, HourglassMediumIcon, PlusIcon, StackIcon, TrashIcon, WarningCircleIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { acceptanceChip, healthBadge, holdsIdleSession, isClosable, runInProgress, runLabel, statusLabel } from "@/lib/run-state";
import { statusColor } from "@/lib/notifications";
import type { QueuedRunView, RunSummary } from "@/lib/types";

const PHASES = 10;

/** Status colours of brand/README.md, as text only: the chip sits in a line of muted text. */
const CHIP_TONE = { error: "text-red-700", attention: "text-amber-800", verified: "text-[var(--accent)]", neutral: "text-[var(--muted)]" } as const;

function Dot({ status, pulsing }: { status: RunSummary["status"]; pulsing: boolean }) {
  return <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full ${pulsing ? "status-breathe" : ""}`} style={{ background: statusColor(status) }} />;
}

/**
 * How far the run got, as a hairline under its row. A phase number means nothing
 * on its own in a list of five runs; the filled fraction is readable without
 * being read.
 */
function PhaseBar({ phase, status }: { phase: number; status: RunSummary["status"] }) {
  const ratio = Math.min(Math.max(phase, 0), PHASES) / PHASES;
  return (
    <span aria-hidden className="mt-2 block h-px w-full bg-[var(--line)]">
      <span className="block h-px transition-[width] duration-500 ease-[cubic-bezier(.16,1,.3,1)]" style={{ width: `${ratio * 100}%`, background: statusColor(status) }} />
    </span>
  );
}

/** The native tooltip is only set once the title is actually cut off. */
function TicketTitle({ title }: { title: string }) {
  return (
    <span
      className="block truncate text-[11px] font-semibold text-[var(--ink)]"
      onMouseEnter={(event) => {
        const element = event.currentTarget;
        if (element.scrollWidth > element.clientWidth) element.title = title;
        else element.removeAttribute("title");
      }}
    >
      {title}
    </span>
  );
}

/**
 * A finished run stays in the list until it is removed, because its documents,
 * its dialogue and its merge request are still worth reading. Removing it is
 * offered on the row itself, and only once its session is gone: a run whose
 * agent is still up would otherwise vanish from the only place it is reachable
 * from. What is removed is the row, never the archive on disk.
 */
function RunRow({ run, selected, index, onOpen, onClose }: { run: RunSummary; selected: boolean; index: number; onOpen: () => void; onClose: () => void }) {
  const waiting = run.pendingQuestionCount > 0;
  const idle = holdsIdleSession(run);
  const badge = healthBadge(run);
  const closable = isClosable(run);
  const coverage = acceptanceChip(run.acceptance);
  return (
    <div style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }} className={`reveal group relative flex transition-colors duration-200 ${selected ? "bg-[var(--raised)]" : "hover:bg-[var(--raised)]/60"}`}>
      {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-[var(--ink)]" />}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Ouvrir le run ${runLabel(run)}`}
        aria-current={selected ? "true" : undefined}
        className="flex min-w-0 flex-1 gap-2.5 py-2.5 pl-3.5 pr-1 text-left"
      >
        <Dot status={run.status} pulsing={runInProgress(run.status)} />
        <span className="min-w-0 flex-1">
          {run.ticketTitle && <TicketTitle title={run.ticketTitle} />}
          <span className={`flex items-baseline justify-between gap-2 ${run.ticketTitle ? "mt-0.5" : ""}`}>
            <span className={`truncate ${run.ticketTitle ? "text-[10px] font-medium text-[var(--ink)]" : "text-[11px] font-semibold text-[var(--ink)]"}`}>{runLabel(run)}</span>
            {waiting
              ? <span title={`${run.pendingQuestionCount} décision${run.pendingQuestionCount > 1 ? "s" : ""} en attente`} className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-amber-800"><WarningIcon size={9} weight="fill" />{run.pendingQuestionCount}</span>
              : <span className="shrink-0 font-mono text-[9px] text-[var(--muted)]">{run.phase}/{PHASES}</span>}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-[var(--muted)]">
            {badge
              ? <HealthMark badge={badge} />
              : <>{run.branch && <GitBranchIcon size={10} className="shrink-0" />}<span className="truncate">{idle ? "Session ouverte" : run.action ?? statusLabel(run.status)}</span></>}
            {run.endedAt && <span className="shrink-0 font-mono text-[9px]">{new Date(run.endedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>}
            {coverage && <span title={coverage.title} aria-label={coverage.title} className={`ml-auto shrink-0 font-mono text-[9px] font-semibold ${CHIP_TONE[coverage.tone]}`}>{coverage.label}</span>}
          </span>
          <PhaseBar phase={run.phase} status={run.status} />
        </span>
      </button>
      {closable && (
        <button
          type="button"
          onClick={onClose}
          aria-label={`Supprimer le run ${runLabel(run)}`}
          title="Retirer ce run de la liste. Ses documents restent archivés sur disque."
          className="mr-1.5 mt-2 grid size-6 shrink-0 place-items-center self-start rounded-md text-[var(--muted)] opacity-0 transition hover:bg-[var(--paper)] hover:text-[var(--ink)] focus-visible:opacity-100 active:translate-y-px group-hover:opacity-100"
        >
          <TrashIcon size={12} />
        </button>
      )}
    </div>
  );
}

/** What the health monitor says of a row, in the row's own third line: an incident or a doubt, never both. */
function HealthMark({ badge }: { badge: NonNullable<ReturnType<typeof healthBadge>> }) {
  const Icon = badge.tone === "error" ? WarningCircleIcon : badge.tone === "doubt" ? HourglassMediumIcon : WarningIcon;
  const color = badge.tone === "error" ? "text-red-700" : "text-amber-800";
  return <span className={`flex min-w-0 items-center gap-1 font-medium ${color}`}><Icon size={10} weight="fill" className="shrink-0" aria-hidden /><span className="truncate">{badge.label}</span></span>;
}

/**
 * A run of an earlier session, read back from its archive because it ended
 * with an open incident. It has no session and takes no slot: the row opens
 * its diagnosis, nothing else.
 */
function ArchivedRow({ run, selected, index, onOpen }: { run: RunSummary; selected: boolean; index: number; onOpen: () => void }) {
  return (
    <div style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }} className={`reveal relative ${selected ? "bg-[var(--raised)]" : "hover:bg-[var(--raised)]/60"}`}>
      {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-[var(--ink)]" />}
      <button type="button" onClick={onOpen} aria-label={`Consulter l’archive du run ${runLabel(run)}`} aria-current={selected ? "true" : undefined} className="flex w-full items-start gap-2.5 px-3.5 py-2 text-left">
        <ArchiveIcon size={11} className="mt-0.5 shrink-0 text-[var(--muted)]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium text-[var(--ink)]">{run.ticketTitle ?? runLabel(run)}</span>
          <span className="mt-0.5 flex items-center gap-1 truncate text-[10px] font-medium text-red-700"><WarningCircleIcon size={10} weight="fill" className="shrink-0" aria-hidden /><span className="truncate">{run.incident?.title ?? "Session interrompue"}</span></span>
        </span>
      </button>
    </div>
  );
}

function QueuedRow({ entry, index, onCancel }: { entry: QueuedRunView; index: number; onCancel: () => void }) {
  const reason = entry.blockedBy ? "dépôt occupé" : "toutes les places sont prises";
  return (
    <div style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }} className="reveal flex items-start gap-2.5 px-3.5 py-2">
      <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full border border-[var(--muted)]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-[var(--ink)]">{runLabel(entry)}</p>
        <p className="mt-0.5 truncate text-[10px] text-[var(--muted)]" title={entry.blockedBy ? `Bloqué par le run ${entry.blockedBy}` : undefined}>En attente, {reason}</p>
      </div>
      <button type="button" onClick={onCancel} aria-label={`Retirer ${runLabel(entry)} de la file`} className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md text-[var(--muted)] transition hover:bg-[var(--raised)] hover:text-[var(--ink)] active:translate-y-px"><XIcon size={11} /></button>
    </div>
  );
}

/**
 * Every run the console holds, and everything waiting for room. Deliberately not
 * a stack of cards: at five runs the boxes cost more room than the rows they
 * hold, so the list is hairlines and negative space, and the only surface that
 * lifts is the row being read.
 *
 * A panel of its own, beside the card holding the open run: folded into the same
 * column as that run's progression, the two headings competed and the list read
 * as the top half of the progression rather than as the navigation it is.
 */
export function RunRail({ runs, queued, archived = [], maxConcurrentRuns, selectedRunId, onOpen, onNew, onClose, onCancelQueued }: {
  runs: RunSummary[];
  queued: QueuedRunView[];
  archived?: RunSummary[];
  maxConcurrentRuns: number;
  selectedRunId: string | null;
  onOpen: (runId: string) => void;
  onNew: () => void;
  onClose: (runId: string) => void;
  onCancelQueued: (queuedId: string) => void;
}) {
  const holding = runs.filter((run) => run.holdsRepository).length;
  const full = holding >= maxConcurrentRuns;

  return (
    <aside aria-label="Runs du harnais" className="flex min-h-0 flex-col overflow-hidden rounded-6.5 border border-[var(--line)] bg-[var(--surface)] shadow-[0_26px_70px_-42px_rgba(38,50,43,.42)] lg:h-[calc(100dvh-40px)]">
      <div className="flex min-h-16 shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] px-3.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-[11px] font-semibold"><StackIcon size={13} weight="bold" />Runs</h2>
          <p className="mt-0.5 font-mono text-[9px] text-[var(--muted)]" title={`${holding} session${holding > 1 ? "s" : ""} active${holding > 1 ? "s" : ""} sur ${maxConcurrentRuns} places`}>
            <span className={full ? "text-amber-700" : "text-[var(--accent)]"}>{holding}</span>/{maxConcurrentRuns} places
          </p>
        </div>
        <button
          type="button"
          onClick={onNew}
          aria-label="Nouveau run"
          aria-pressed={selectedRunId === null}
          title="Lancer un nouveau run"
          className={`grid size-7 shrink-0 place-items-center rounded-lg border transition active:translate-y-px ${selectedRunId === null
            ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--on-ink)] hover:opacity-90"
            : "border-[var(--line)] text-[var(--ink)] hover:bg-[var(--raised)]"}`}
        >
          <PlusIcon size={13} weight="bold" />
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {runs.length === 0 && queued.length === 0 && archived.length === 0 ? (
          <div className="px-3.5 py-6 text-center">
            <div className="mx-auto grid size-8 place-items-center rounded-full border border-dashed border-[var(--line)] text-[var(--muted)]"><ClockCounterClockwiseIcon size={14} /></div>
            <p className="mt-2.5 text-[11px] font-medium">Aucun run</p>
            <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">Colle une URL de ticket. Le harnais en tient {maxConcurrentRuns} à la fois.</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {runs.map((run, index) => <RunRow key={run.id} run={run} index={index} selected={run.id === selectedRunId} onOpen={() => onOpen(run.id)} onClose={() => onClose(run.id)} />)}
          </div>
        )}

        {archived.length > 0 && (
          <div role="group" aria-label="Runs interrompus" className="border-t border-[var(--line)]">
            <p className="px-3.5 pb-1 pt-2.5 font-mono text-[9px] uppercase tracking-[.08em] text-[var(--muted)]" title="Runs d’une session précédente, restés avec un incident ouvert. Lecture seule.">Interrompus · {archived.length}</p>
            <div className="divide-y divide-[var(--line)]">
              {archived.map((run, index) => <ArchivedRow key={run.id} run={run} index={index} selected={run.id === selectedRunId} onOpen={() => onOpen(run.id)} />)}
            </div>
          </div>
        )}

        {queued.length > 0 && (
          <div role="group" aria-label="Runs en file d'attente" className="border-t border-[var(--line)] bg-[var(--sunken)]">
            <p className="px-3.5 pb-1 pt-2.5 font-mono text-[9px] uppercase tracking-[.08em] text-[var(--muted)]">En file · {queued.length}</p>
            <div className="divide-y divide-[var(--line)]">
              {queued.map((entry, index) => <QueuedRow key={entry.id} entry={entry} index={index} onCancel={() => onCancelQueued(entry.id)} />)}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
