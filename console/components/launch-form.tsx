"use client";

import { ArrowRightIcon, CheckIcon, FileTextIcon, FolderOpenIcon, GitBranchIcon, PlayIcon, RobotIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { proposalLabel } from "@/lib/run-state";
import type { ParsedTickets } from "@/lib/ticket-urls";
import type { RepositoryOption, UnresolvedTicket } from "@/lib/types";
import { TargetPicker } from "./target-picker";

function RepositoryPicker({ value, onChange, repositories, detectedProject, detecting, onOpenRecipe }: {
  value: string;
  onChange: (value: string, project?: string) => void;
  repositories: RepositoryOption[];
  detectedProject?: string;
  onOpenRecipe: (repository: string) => void;
  detecting: boolean;
}) {
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
        <label htmlFor="project-directory" className="text-xs font-medium">Project directory <span className="font-normal text-[var(--muted)]">· optional</span></label>
        <span className="truncate text-right font-mono text-[9px] text-[var(--accent)]">
          {detecting ? "Detecting…" : detectedProject ? `Project · ${detectedProject}` : ""}
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
            if (!listOpen || suggestions.length === 0) return;
            if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => (index + 1) % suggestions.length); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length); }
            const active = suggestions[activeIndex];
            if (event.key === "Enter" && active) { event.preventDefault(); select(active); }
            if (event.key === "Escape") setOpen(false);
          }}
          placeholder="Detected from the ticket, or start typing…"
          className="field !pl-10 !pr-9 font-mono text-xs"
        />
        {detectedProject && <CheckIcon aria-hidden="true" size={14} weight="bold" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--accent)]" />}
      </div>
      {!listOpen && value.trim().startsWith("/") && <button type="button" onClick={() => onOpenRecipe(value.trim())} title="What the harness keeps to start the application of this repository" className="mt-1.5 text-[11px] text-[var(--muted)] underline decoration-[var(--line)] underline-offset-2 transition hover:text-[var(--ink)]">Runtime recipe</button>}
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
              {!repository.exists && <span className="shrink-0 text-[9px] text-amber-700">Not found</span>}
            </button>
          )) : <p className="px-3 py-3 text-[11px] text-[var(--muted)]">No declared repository matches.</p>}
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
  const { tickets, invalid, duplicates } = parsed;
  if (tickets.length + invalid.length < 2 && invalid.length === 0 && duplicates.length === 0) return null;
  return (
    <div id="ticket-count" aria-live="polite" className="-mt-3 mb-5 space-y-1 text-[11px] leading-4">
      <p className="text-[var(--accent)]">
        {tickets.length === 0 ? "No ticket recognized" : `${tickets.length} ticket${tickets.length > 1 ? "s" : ""} recognized`}
        {duplicates.length > 0 && <span className="text-[var(--muted)]"> · {duplicates.length} duplicate{duplicates.length > 1 ? "s" : ""} skipped</span>}
      </p>
      {invalid.length > 0 && (
        <ul className="text-red-700">
          {invalid.map((entry, index) => <li key={`${entry.line}-${index}`}>Line {entry.line}: <span className="break-all font-mono text-[10px]">{entry.text}</span> is not a GitLab or GitHub ticket URL.</li>)}
        </ul>
      )}
    </div>
  );
}

export function LaunchForm({ cwd, setCwd, issueUrl, setIssueUrl, parsed, instruction, setInstruction, repositories, detectedProject, detectingProject, missedProject, unresolved, targets, chooseTargets, canStart, onStart, onOpenRecipe }: {
  cwd: string; setCwd: (value: string, project?: string) => void; issueUrl: string; setIssueUrl: (value: string) => void;
  /** The ticket field as read by parseTicketUrls: two tickets or more make a batch. */
  parsed: ParsedTickets;
  instruction: string; setInstruction: (value: string) => void; repositories: RepositoryOption[]; detectedProject?: string;
  detectingProject: boolean; canStart: boolean; onStart: () => void;
  /** The single ticket's project when no checkout of it was found. */
  missedProject?: string;
  /** The tickets of the batch the server found no checkout for. */
  unresolved: UnresolvedTicket[];
  targets: Record<string, string[]>;
  chooseTargets: (issueUrl: string, paths: string[]) => void;
  /** Opens what the console keeps about starting the app of a repository. */
  onOpenRecipe: (repository: string) => void;
}) {
  const batch = parsed.tickets.length > 1;
  const singleTicket = parsed.tickets[0];
  const singleTargets = !batch && missedProject && singleTicket ? targets[singleTicket] ?? [] : [];
  const lines = issueUrl.split("\n").length;
  return (
    <section className="scrollbar-thin grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(340px,.8fr)]">
      <div className="flex flex-col justify-between px-6 py-10 md:px-10 md:py-14 lg:px-[4vw]">
        <div className="reveal">
          <p className="mb-8 font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--accent)]">New run</p>
          <h2 className="max-w-190 text-4xl font-medium leading-[.98] tracking-[-.055em] md:text-5xl">From ticket to merge request,<span className="block text-[var(--muted)]">without losing the thread.</span></h2>
          <p className="mt-7 max-w-[52ch] text-sm leading-6 text-[var(--muted)] md:text-base">Start your usual Claude Code workflow. Agents, generated documents and reviews show up here while the terminal stays fully interactive.</p>
        </div>
        <div className="mt-12 flex items-center gap-8 border-t border-[var(--line)] pt-5 text-xs text-[var(--muted)]">
          <span className="flex items-center gap-2"><RobotIcon size={15} /> 6 specialized agents</span>
          <span className="flex items-center gap-2"><FileTextIcon size={15} /> Local history</span>
        </div>
      </div>

      <div className="flex items-center border-t border-[var(--line)] bg-[var(--backdrop)] p-5 md:p-8 lg:border-l lg:border-t-0">
        <form className="w-full rounded-5.5 border border-[var(--raised)]/70 bg-[var(--surface)] p-5 shadow-[0_18px_45px_-28px_rgba(30,42,35,.35),inset_0_1px_0_var(--highlight)] md:p-7" onSubmit={(event) => { event.preventDefault(); if (canStart) onStart(); }}>
          <div className="mb-7 flex items-start justify-between">
            <div><h3 className="text-lg font-semibold tracking-[-.025em]">Configure the run</h3><p className="mt-1 text-xs text-[var(--muted)]">The command will run in the chosen project.</p></div>
            <div className="grid size-9 place-items-center rounded-full border border-[var(--line)] text-[var(--muted)]"><GitBranchIcon size={16} /></div>
          </div>
          <label className="mb-5 block">
            <span className="mb-2 block text-xs font-medium">Ticket <span className="font-normal text-[var(--muted)]">GitLab or GitHub · one per line to start several</span></span>
            <textarea
              value={issueUrl}
              onChange={(event) => setIssueUrl(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canStart) { event.preventDefault(); onStart(); } }}
              placeholder="https://gitlab.com/…/-/issues/217 or https://github.com/…/issues/217"
              rows={Math.min(Math.max(lines, 1), 8)}
              spellCheck={false}
              autoComplete="off"
              aria-describedby="ticket-count"
              className="field resize-none text-sm leading-5"
            />
          </label>
          <TicketCount parsed={parsed} />
          {batch
            ? <p className="mb-5 text-[11px] leading-4 text-[var(--muted)]">The repository of each ticket is detected from its URL. Tickets of the same repository are compared before they start: those that touch the same code run one after the other.</p>
            : missedProject && !cwd.trim()
              ? <TargetPicker label="Merge request repositories" hint={`No checkout of ${missedProject}. Choose where the change goes: each repository gets its own run and merge request.`} selected={singleTargets} onChange={(paths) => { if (singleTicket) chooseTargets(singleTicket, paths); }} repositories={repositories} />
              : <RepositoryPicker value={cwd} onChange={setCwd} repositories={repositories} detectedProject={detectedProject} detecting={detectingProject} onOpenRecipe={onOpenRecipe} />}
          {batch && unresolved.length > 0 && (
            <div role="group" aria-label="Tickets without a checkout" className="mb-5 space-y-4 rounded-[11px] border border-amber-300/70 bg-[var(--raised)] p-3.5">
              <p className="text-[11px] leading-4 text-amber-800">No checkout was found for {unresolved.length > 1 ? "these tickets" : "this ticket"}. Choose where the merge requests go, then start again.</p>
              {unresolved.map((ticket) => (
                <TargetPicker key={ticket.issueUrl} compact label={proposalLabel(ticket.issueUrl)} hint={ticket.project ? `Ticket of ${ticket.project}` : undefined} selected={targets[ticket.issueUrl] ?? []} onChange={(paths) => chooseTargets(ticket.issueUrl, paths)} repositories={repositories} />
              ))}
            </div>
          )}
          <label className="block"><span className="mb-2 block text-xs font-medium">Special instruction <span className="font-normal text-[var(--muted)]">· {batch ? "optional, applied to every ticket of the batch" : "optional"}</span></span><textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Desktop only, do not touch tracking…" rows={3} className="field resize-none text-sm leading-5" /></label>
          <button type="submit" disabled={!canStart} className="mt-7 flex w-full items-center justify-between rounded-[11px] bg-[var(--ink)] px-4 py-3.5 text-sm font-medium text-[var(--on-ink)] transition hover:bg-[var(--ink-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35">
            <span className="flex items-center gap-2"><PlayIcon size={15} weight="fill" /> {batch ? `Start ${parsed.tickets.length} tickets` : singleTargets.length > 1 ? `Start in ${singleTargets.length} repositories` : "Start implementation"}</span><ArrowRightIcon size={16} />
          </button>
        </form>
      </div>
    </section>
  );
}
