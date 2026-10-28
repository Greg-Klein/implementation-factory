"use client";

import { ArrowRightIcon, CheckIcon, FileTextIcon, FolderOpenIcon, GitBranchIcon, PlayIcon, RobotIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { proposalLabel } from "@/lib/run-state";
import type { ParsedTickets } from "@/lib/ticket-urls";
import type { RepositoryOption, UnresolvedTicket } from "@/lib/types";
import { useTexts } from "./language";
import { TargetPicker } from "./target-picker";

function RepositoryPicker({ value, onChange, repositories, detectedProject, detecting, onOpenRecipe }: {
  value: string;
  onChange: (value: string, project?: string) => void;
  repositories: RepositoryOption[];
  detectedProject?: string | undefined;
  onOpenRecipe: (repository: string) => void;
  detecting: boolean;
}) {
  const t = useTexts().launch;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const query = value.trim().toLocaleLowerCase("en");
  const suggestions = useMemo(() => {
    if (!query) return [];
    return repositories.filter((repository) =>
      `${repository.project} ${repository.path} ${repository.resolvedPath}`.toLocaleLowerCase("en").includes(query),
    ).slice(0, 7);
  }, [query, repositories]);
  const listOpen = open && query.length > 0;

  useEffect(() => setActiveIndex(0), [query]);

  const select = (repository: RepositoryOption) => {
    onChange(repository.path, repository.project);
    setOpen(false);
  };

  return (
    <div className="relative mb-5">
      <div className="mb-2 flex min-h-4 items-center justify-between gap-3">
        <label htmlFor="project-directory" className="text-xs font-medium">{t.projectDirectory} <span className="font-normal text-[var(--muted)]">· {t.optional}</span></label>
        <span className="truncate text-right font-mono text-[9px] text-[var(--accent)]">
          {detecting ? t.detecting : detectedProject ? t.project(detectedProject) : ""}
        </span>
      </div>
      <div className="relative">
        <FolderOpenIcon aria-hidden="true" size={15} className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-[var(--muted)]" />
        <input
          id="project-directory"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls="repository-suggestions"
          aria-activedescendant={listOpen && suggestions[activeIndex] ? `repository-${activeIndex}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(event) => { onChange(event.target.value); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setOpen(false); return; }
            if (!listOpen || suggestions.length === 0) return;
            if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => (index + 1) % suggestions.length); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length); }
            const active = suggestions[activeIndex];
            if (event.key === "Enter") { event.preventDefault(); if (active) select(active); }
          }}
          placeholder={t.directoryPlaceholder}
          className="field !pl-10 !pr-9 font-mono text-xs"
        />
        {detectedProject && <CheckIcon aria-hidden="true" size={14} weight="bold" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--accent)]" />}
      </div>
      {!listOpen && value.trim().startsWith("/") && <button type="button" onClick={() => onOpenRecipe(value.trim())} title={t.runtimeRecipeTitle} className="mt-1.5 text-[11px] text-[var(--muted)] underline decoration-[var(--line)] underline-offset-2 transition hover:text-[var(--ink)]">{t.runtimeRecipe}</button>}
      {listOpen && (
        <div id="repository-suggestions" role="listbox" className="absolute left-0 right-0 top-[calc(100%+7px)] z-30 overflow-hidden rounded-[11px] border border-[var(--line)] bg-[var(--raised)] p-1.5 shadow-[0_18px_45px_-22px_rgba(28,33,31,.38)]">
          {suggestions.length > 0 ? suggestions.map((repository, index) => (
            <button
              key={`${repository.project}-${repository.path}`}
              id={`repository-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              type="button"
              onMouseDown={(event) => { event.preventDefault(); select(repository); }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${index === activeIndex ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--tint)]"}`}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md border border-[var(--line)] bg-[var(--raised)] text-[var(--accent)]"><GitBranchIcon size={13} /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{repository.project}</span><span className="mt-0.5 block truncate font-mono text-[9px] text-[var(--muted)]">{repository.path}</span></span>
              {!repository.exists && <span className="shrink-0 text-[9px] text-amber-700">{t.notFound}</span>}
            </button>
          )) : <p className="px-3 py-3 text-[11px] text-[var(--muted)]">{t.noRepositoryMatches}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * What the ticket field holds, said back while the user types: how many URLs
 * were recognised, and which lines are not one. Silent for a single ticket,
 * which the field alone already shows.
 */
function TicketCount({ parsed }: { parsed: ParsedTickets }) {
  const t = useTexts().launch;
  const { tickets, invalid, duplicates } = parsed;
  if (tickets.length + invalid.length < 2 && invalid.length === 0 && duplicates.length === 0) return null;
  return (
    <div id="ticket-count" aria-live="polite" className="-mt-3 mb-5 space-y-1 text-[11px] leading-4">
      <p className="text-[var(--accent)]">
        {tickets.length === 0 ? t.noTicketRecognized : t.ticketsRecognized(tickets.length)}
        {duplicates.length > 0 && <span className="text-[var(--muted)]"> · {t.duplicatesSkipped(duplicates.length)}</span>}
      </p>
      {invalid.length > 0 && (
        <ul className="text-red-700">
          {invalid.map((entry, index) => <li key={`${entry.line}-${index}`}>{t.line(entry.line)} <span className="break-all font-mono text-[10px]">{entry.text}</span> {t.notATicketUrl}</li>)}
        </ul>
      )}
    </div>
  );
}

export function LaunchForm({ cwd, setCwd, issueUrl, setIssueUrl, parsed, instruction, setInstruction, repositories, detectedProject, detectingProject, missedProject, unresolved, targets, chooseTargets, canStart, onStart, onOpenRecipe }: {
  cwd: string; setCwd: (value: string, project?: string) => void; issueUrl: string; setIssueUrl: (value: string) => void;
  /** The ticket field as read by parseTicketUrls: two tickets or more make a batch. */
  parsed: ParsedTickets;
  instruction: string; setInstruction: (value: string) => void; repositories: RepositoryOption[]; detectedProject?: string | undefined;
  detectingProject: boolean; canStart: boolean; onStart: () => void;
  /** The single ticket's project when no checkout of it was found. */
  missedProject?: string | undefined;
  /** The tickets of the batch the server found no checkout for. */
  unresolved: UnresolvedTicket[];
  targets: Record<string, string[]>;
  chooseTargets: (issueUrl: string, paths: string[]) => void;
  /** Opens what the console keeps about starting the app of a repository. */
  onOpenRecipe: (repository: string) => void;
}) {
  const t = useTexts().launch;
  const batch = parsed.tickets.length > 1;
  const singleTicket = parsed.tickets[0];
  const singleTargets = !batch && missedProject && singleTicket ? targets[singleTicket] ?? [] : [];
  const lines = issueUrl.split("\n").length;
  return (
    <section className="scrollbar-thin grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(340px,.8fr)]">
      <div className="flex flex-col justify-between px-6 py-10 md:px-10 md:py-14 lg:px-[4vw]">
        <div className="reveal">
          <p className="mb-8 font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--accent)]">{t.eyebrow}</p>
          <h2 className="max-w-190 text-4xl font-medium leading-[.98] tracking-[-.055em] md:text-5xl">{t.headline}<span className="block text-[var(--muted)]">{t.headlineTail}</span></h2>
          <p className="mt-7 max-w-[52ch] text-sm leading-6 text-[var(--muted)] md:text-base">{t.intro}</p>
        </div>
        <div className="mt-12 flex items-center gap-8 border-t border-[var(--line)] pt-5 text-xs text-[var(--muted)]">
          <span className="flex items-center gap-2"><RobotIcon size={15} /> {t.agents}</span>
          <span className="flex items-center gap-2"><FileTextIcon size={15} /> {t.localHistory}</span>
        </div>
      </div>

      <div className="flex items-center border-t border-[var(--line)] bg-[var(--backdrop)] p-5 md:p-8 lg:border-l lg:border-t-0">
        <form className="w-full rounded-5.5 border border-[var(--raised)]/70 bg-[var(--surface)] p-5 shadow-[0_18px_45px_-28px_rgba(30,42,35,.35),inset_0_1px_0_var(--highlight)] md:p-7" onSubmit={(event) => { event.preventDefault(); if (canStart) onStart(); }}>
          <div className="mb-7 flex items-start justify-between">
            <div><h3 className="text-lg font-semibold tracking-[-.025em]">{t.configureTitle}</h3><p className="mt-1 text-xs text-[var(--muted)]">{t.configureHint}</p></div>
            <div className="grid size-9 place-items-center rounded-full border border-[var(--line)] text-[var(--muted)]"><GitBranchIcon size={16} /></div>
          </div>
          <label className="mb-5 block">
            <span className="mb-2 block text-xs font-medium">{t.ticket} <span className="font-normal text-[var(--muted)]">{t.ticketHint}</span></span>
            <textarea
              value={issueUrl}
              onChange={(event) => setIssueUrl(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canStart) { event.preventDefault(); onStart(); } }}
              placeholder={t.ticketPlaceholder}
              rows={Math.min(Math.max(lines, 1), 8)}
              spellCheck={false}
              autoComplete="off"
              aria-describedby="ticket-count"
              className="field resize-none text-sm leading-5"
            />
          </label>
          <TicketCount parsed={parsed} />
          {batch
            ? <p className="mb-5 text-[11px] leading-4 text-[var(--muted)]">{t.batchRepositories}</p>
            : missedProject && !cwd.trim()
              ? <TargetPicker label={t.mergeRequestRepositories} hint={t.noCheckoutOf(missedProject)} selected={singleTargets} onChange={(paths) => { if (singleTicket) chooseTargets(singleTicket, paths); }} repositories={repositories} />
              : <RepositoryPicker value={cwd} onChange={setCwd} repositories={repositories} detectedProject={detectedProject} detecting={detectingProject} onOpenRecipe={onOpenRecipe} />}
          {batch && unresolved.length > 0 && (
            <div role="group" aria-label={t.withoutCheckoutGroup} className="mb-5 space-y-4 rounded-[11px] border border-amber-300/70 bg-[var(--raised)] p-3.5">
              <p className="text-[11px] leading-4 text-amber-800">{t.noCheckoutFound(unresolved.length)}</p>
              {unresolved.map((ticket) => (
                <TargetPicker key={ticket.issueUrl} compact label={proposalLabel(ticket.issueUrl)} hint={ticket.project ? t.ticketOf(ticket.project) : undefined} selected={targets[ticket.issueUrl] ?? []} onChange={(paths) => chooseTargets(ticket.issueUrl, paths)} repositories={repositories} />
              ))}
            </div>
          )}
          <label className="block"><span className="mb-2 block text-xs font-medium">{t.specialInstruction} <span className="font-normal text-[var(--muted)]">· {batch ? t.instructionBatch : t.optional}</span></span><textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={t.instructionPlaceholder} rows={3} className="field resize-none text-sm leading-5" /></label>
          <button type="submit" disabled={!canStart} className="mt-7 flex w-full items-center justify-between rounded-[11px] bg-[var(--ink)] px-4 py-3.5 text-sm font-medium text-[var(--on-ink)] transition hover:bg-[var(--ink-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35">
            <span className="flex items-center gap-2"><PlayIcon size={15} weight="fill" /> {batch ? t.startTickets(parsed.tickets.length) : singleTargets.length > 1 ? t.startInRepositories(singleTargets.length) : t.startImplementation}</span><ArrowRightIcon size={16} />
          </button>
        </form>
      </div>
    </section>
  );
}
