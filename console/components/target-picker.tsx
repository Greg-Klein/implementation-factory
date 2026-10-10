"use client";

import { GitBranchIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useId, useMemo, useState } from "react";
import type { RepositoryOption } from "@/lib/types";

/**
 * The checkouts a ticket's merge requests go to, when the ticket lives in a
 * project the console has no checkout of. Each one chosen is one run and one
 * merge request. A path typed by hand is taken as it is: the server checks it.
 */
export function TargetPicker({ label, hint, selected, onChange, repositories, compact = false }: {
  label: string;
  hint?: string | undefined;
  selected: string[];
  onChange: (paths: string[]) => void;
  repositories: RepositoryOption[];
  compact?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const typed = query.trim();
  const suggestions = useMemo(() => {
    const needle = typed.toLocaleLowerCase("en");
    return repositories
      .filter((repository) => !selected.includes(repository.path))
      .filter((repository) => !needle || `${repository.project} ${repository.path}`.toLocaleLowerCase("en").includes(needle))
      .slice(0, 7);
  }, [typed, repositories, selected]);
  const listOpen = open && suggestions.length > 0;
  const projectOf = (target: string) => repositories.find((repository) => repository.path === target)?.project;

  useEffect(() => setActiveIndex(0), [typed]);

  const add = (target: string) => {
    if (!selected.includes(target)) onChange([...selected, target]);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className={`relative ${compact ? "" : "mb-5"}`}>
      <label htmlFor={id} className="mb-2 block text-xs font-medium">{label}</label>
      {hint && <p className="-mt-1 mb-2 text-[11px] leading-4 text-[var(--muted)]">{hint}</p>}
      {selected.length > 0 && (
        <ul aria-label="Chosen repositories" className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((target) => (
            <li key={target} className="flex max-w-full items-center gap-1.5 rounded-md border border-[var(--line)] bg-[var(--raised)] py-1 pl-2 pr-1 text-[11px]">
              <GitBranchIcon aria-hidden="true" size={11} className="shrink-0 text-[var(--accent)]" />
              <span className="truncate" title={target}>{projectOf(target) ?? target}</span>
              <button type="button" onClick={() => onChange(selected.filter((other) => other !== target))} aria-label={`Remove ${projectOf(target) ?? target}`} className="grid size-4 shrink-0 place-items-center rounded text-[var(--muted)] transition hover:bg-[var(--tint)] hover:text-[var(--ink)]"><XIcon size={9} /></button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={`${id}-list`}
        aria-activedescendant={listOpen ? `${id}-${activeIndex}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && listOpen) { event.preventDefault(); setActiveIndex((index) => (index + 1) % suggestions.length); }
          if (event.key === "ArrowUp" && listOpen) { event.preventDefault(); setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length); }
          if (event.key === "Enter" && (listOpen || typed)) {
            event.preventDefault();
            const active = suggestions[activeIndex];
            if (!listOpen) add(typed);
            else if (active) add(active.path);
          }
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder={selected.length > 0 ? "Add another repository…" : "Search a repository or type its path…"}
        className="field font-mono text-xs"
      />
      {listOpen && (
        <div id={`${id}-list`} role="listbox" className="absolute left-0 right-0 z-30 mt-1.5 overflow-hidden rounded-[11px] border border-[var(--line)] bg-[var(--raised)] p-1.5 shadow-[0_18px_45px_-22px_rgba(28,33,31,.38)]">
          {suggestions.map((repository, index) => (
            <button
              key={`${repository.project}-${repository.path}`}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              type="button"
              onMouseDown={(event) => { event.preventDefault(); add(repository.path); }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${index === activeIndex ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--tint)]"}`}
            >
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{repository.project}{repository.identity && <span className="ml-2 text-[var(--muted)]">{repository.identity.hostname}</span>}</span><span className="mt-0.5 block truncate font-mono text-[9px] text-[var(--muted)]">{repository.path}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
