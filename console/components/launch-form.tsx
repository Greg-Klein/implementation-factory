"use client";

import { ArrowRightIcon, CheckIcon, FileTextIcon, FolderOpenIcon, GitBranchIcon, PlayIcon, RobotIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { RepositoryOption } from "@/lib/types";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="mb-5 block"><span className="mb-2 block text-xs font-medium">{label}</span>{children}</label>;
}

function RepositoryPicker({ value, onChange, repositories, detectedProject, detecting }: {
  value: string;
  onChange: (value: string, project?: string) => void;
  repositories: RepositoryOption[];
  detectedProject?: string;
  detecting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const query = value.trim().toLocaleLowerCase("fr");
  const suggestions = useMemo(() => {
    if (!query) return [];
    return repositories.filter((repository) =>
      `${repository.project} ${repository.path} ${repository.resolvedPath}`.toLocaleLowerCase("fr").includes(query),
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
        <label htmlFor="project-directory" className="text-xs font-medium">Répertoire du projet <span className="font-normal text-[var(--muted)]">· facultatif</span></label>
        <span className="truncate text-right font-mono text-[9px] text-[var(--accent)]">
          {detecting ? "Détection…" : detectedProject ? `Projet · ${detectedProject}` : ""}
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
            if (event.key === "Enter") { event.preventDefault(); select(suggestions[activeIndex]); }
            if (event.key === "Escape") setOpen(false);
          }}
          placeholder="Détecté depuis le ticket, ou commence à taper…"
          className="field !pl-10 !pr-9 font-mono text-xs"
        />
        {detectedProject && <CheckIcon aria-hidden="true" size={14} weight="bold" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--accent)]" />}
      </div>
      {listOpen && (
        <div id="repository-suggestions" role="listbox" className="absolute left-0 right-0 top-[calc(100%+7px)] z-30 overflow-hidden rounded-[11px] border border-[var(--line)] bg-white p-1.5 shadow-[0_18px_45px_-22px_rgba(28,33,31,.38)]">
          {suggestions.length > 0 ? suggestions.map((repository, index) => (
            <button
              key={`${repository.project}-${repository.path}`}
              id={`repository-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              type="button"
              onMouseDown={(event) => { event.preventDefault(); select(repository); }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${index === activeIndex ? "bg-[var(--accent-soft)]" : "hover:bg-[#f4f5f1]"}`}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md border border-[var(--line)] bg-white text-[var(--accent)]"><GitBranchIcon size={13} /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{repository.project}</span><span className="mt-0.5 block truncate font-mono text-[9px] text-[var(--muted)]">{repository.path}</span></span>
              {!repository.exists && <span className="shrink-0 text-[9px] text-amber-700">Introuvable</span>}
            </button>
          )) : <p className="px-3 py-3 text-[11px] text-[var(--muted)]">Aucun dépôt déclaré ne correspond.</p>}
        </div>
      )}
    </div>
  );
}

export function LaunchForm({ cwd, setCwd, issueUrl, setIssueUrl, instruction, setInstruction, repositories, detectedProject, detectingProject, canStart, onStart }: {
  cwd: string; setCwd: (value: string, project?: string) => void; issueUrl: string; setIssueUrl: (value: string) => void;
  instruction: string; setInstruction: (value: string) => void; repositories: RepositoryOption[]; detectedProject?: string;
  detectingProject: boolean; canStart: boolean; onStart: () => void;
}) {
  return (
    <section className="scrollbar-thin grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(340px,.8fr)]">
      <div className="flex flex-col justify-between px-6 py-10 md:px-10 md:py-14 lg:px-[4vw]">
        <div className="reveal">
          <p className="mb-8 font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--accent)]">Nouvelle exécution</p>
          <h2 className="max-w-190 text-4xl font-medium leading-[.98] tracking-[-.055em] md:text-5xl">Du ticket à la MR,<span className="block text-[var(--muted)]">sans perdre le fil.</span></h2>
          <p className="mt-7 max-w-[52ch] text-sm leading-6 text-[var(--muted)] md:text-base">Lance ton workflow Claude Code habituel. Les agents, les documents générés et les revues remontent ici pendant que le terminal reste pleinement interactif.</p>
        </div>
        <div className="mt-12 flex items-center gap-8 border-t border-[var(--line)] pt-5 text-xs text-[var(--muted)]">
          <span className="flex items-center gap-2"><RobotIcon size={15} /> 6 agents spécialisés</span>
          <span className="flex items-center gap-2"><FileTextIcon size={15} /> Historique local</span>
        </div>
      </div>

      <div className="flex items-center border-t border-[var(--line)] bg-[#eceee8] p-5 md:p-8 lg:border-l lg:border-t-0">
        <form className="w-full rounded-5.5 border border-white/70 bg-[var(--surface)] p-5 shadow-[0_18px_45px_-28px_rgba(30,42,35,.35),inset_0_1px_0_rgba(255,255,255,.8)] md:p-7" onSubmit={(event) => { event.preventDefault(); if (canStart) onStart(); }}>
          <div className="mb-7 flex items-start justify-between">
            <div><h3 className="text-lg font-semibold tracking-[-.025em]">Configurer le run</h3><p className="mt-1 text-xs text-[var(--muted)]">La commande sera exécutée dans le projet choisi.</p></div>
            <div className="grid size-9 place-items-center rounded-full border border-[var(--line)] text-[var(--muted)]"><GitBranchIcon size={16} /></div>
          </div>
          <Field label="Ticket GitLab"><input type="url" value={issueUrl} onChange={(event) => setIssueUrl(event.target.value)} placeholder="https://gitlab.com/…/-/issues/217" className="field text-sm" /></Field>
          <RepositoryPicker value={cwd} onChange={setCwd} repositories={repositories} detectedProject={detectedProject} detecting={detectingProject} />
          <label className="block"><span className="mb-2 block text-xs font-medium">Instruction particulière <span className="font-normal text-[var(--muted)]">· facultatif</span></span><textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Desktop uniquement, ne pas toucher au tracking…" rows={3} className="field resize-none text-sm leading-5" /></label>
          <button type="submit" disabled={!canStart} className="mt-7 flex w-full items-center justify-between rounded-[11px] bg-[var(--ink)] px-4 py-3.5 text-sm font-medium text-white transition hover:bg-[#2a322e] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35">
            <span className="flex items-center gap-2"><PlayIcon size={15} weight="fill" /> Lancer l’implémentation</span><ArrowRightIcon size={16} />
          </button>
        </form>
      </div>
    </section>
  );
}
