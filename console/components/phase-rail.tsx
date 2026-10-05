"use client";

import { ArrowSquareOutIcon, CheckIcon, GitBranchIcon, GitPullRequestIcon, TicketIcon, WarningCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { formatTokens } from "@/lib/metrics";
import { elapsedLabel, phaseNames, runStatusBadge, sourceRepository, worktreeLabel, type StatusBadge } from "@/lib/run-state";
import { forgeOf, forgeWords } from "@/lib/ticket-urls";
import { useNow } from "@/lib/use-now";
import type { RunState } from "@/lib/types";

/** Status pairs of brand/README.md: amber for a decision or a blocked run, red for an interruption or an error. */
const BADGE_TONE: Record<StatusBadge["tone"], string> = {
  decision: "bg-amber-100 text-amber-800",
  blocked: "bg-amber-100 text-amber-800",
  error: "bg-red-50 text-red-700",
  stopped: "bg-[var(--line)] text-[var(--muted)]",
  neutral: "bg-[var(--accent-soft)] text-[var(--accent)]",
};


/** The demonstration ticket has no address to open, and neither has a malformed one. */
function externalHref(value: string) {
  return /^https?:\/\//.test(value) ? value : undefined;
}

/** The rail is 236px wide and the project already shows below, so only the number is worth the room. The full address stays in the tooltip. */
function reference(url: string, prefix: string) {
  const last = url.split(/[?#]/)[0].split("/").filter(Boolean).pop();
  return last ? `${prefix}${last}` : url;
}

function Deliverable({ icon, label, title, href }: { icon: React.ReactNode; label: string; title: string; href?: string }) {
  const body = <><span className="shrink-0 text-[var(--muted)]">{icon}</span><span className="truncate font-mono text-[10px]">{label}</span>{href && <ArrowSquareOutIcon size={10} className="shrink-0 text-[var(--muted)]" />}</>;
  return href
    ? <a href={href} target="_blank" rel="noreferrer" title={title} className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[var(--ink)] transition hover:bg-[var(--paper)]">{body}</a>
    : <p title={title} className="flex items-center gap-1.5 px-1.5 py-1 text-[var(--ink)]">{body}</p>;
}

export function PhaseRail({ run, onOpenRecipe }: { run: RunState; onOpenRecipe?: () => void }) {
  const now = useNow(Boolean(run.startedAt) && !run.endedAt);
  const finished = run.status === "completed";
  const badge = runStatusBadge(run);
  const repository = sourceRepository(run);
  const worktree = worktreeLabel(run);
  const phases = phaseNames(run.issueUrl);

  return (
    <aside aria-label="Run progress" className="scrollbar-thin block min-h-0 border-b border-[var(--line)] p-4 lg:hidden xl:block xl:overflow-y-auto xl:border-b-0">
      <div className="mb-5 flex items-center justify-between"><span className="text-xs font-semibold">Progress</span><span className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${BADGE_TONE[badge.tone]}`}>{(badge.tone === "decision" || badge.tone === "blocked") && <WarningIcon size={10} weight="fill" />}{badge.tone === "error" && <WarningCircleIcon size={10} weight="fill" />}{badge.label}</span></div>
      <ol>{phases.map((phase, index) => {
        // The last step is only ticked when the run itself is over, never just
        // because the workflow reached it.
        const number = index + 1; const done = number < run.phase || finished; const current = number === run.phase && !finished;
        return <li key={phase} className="relative flex min-h-9 gap-3 text-xs">
          {index < phases.length - 1 && <span className={`absolute left-[9px] top-5 h-4 w-px ${done ? "bg-[var(--accent)]" : "bg-[var(--line)]"}`} />}
          <span className={`relative grid size-5 shrink-0 place-items-center rounded-full border font-mono text-[9px] ${done ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]" : current ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]"}`}>{done ? <CheckIcon size={10} weight="bold" /> : number}</span>
          <span className={`pt-0.5 ${current ? "font-semibold text-[var(--ink)]" : done ? "text-[var(--ink)]" : "text-[var(--muted)]"}`}>{phase}</span>
        </li>;
      })}</ol>
      {(run.issueUrl || run.branch || run.mergeRequestUrl) && (
        <div className="mt-6 border-t border-[var(--line)] pt-4">
          <p className="mb-1.5 px-1.5 text-[10px] font-semibold text-[var(--muted)]">Deliverable</p>
          {run.issueUrl && <Deliverable icon={<TicketIcon size={12} />} label={reference(run.issueUrl, "#")} title={run.issueUrl} href={externalHref(run.issueUrl)} />}
          {run.branch && <Deliverable icon={<GitBranchIcon size={12} />} label={run.branch} title={run.branch} />}
          {run.mergeRequestUrl && <Deliverable icon={<GitPullRequestIcon size={12} />} label={reference(run.mergeRequestUrl, forgeWords(forgeOf(run.mergeRequestUrl)).sigil)} title={run.mergeRequestUrl} href={externalHref(run.mergeRequestUrl)} />}
        </div>
      )}
      <div className="mt-6 border-t border-[var(--line)] pt-4">
        <dl className="space-y-2">
          <div>
            <dt className="text-[10px] font-semibold text-[var(--muted)]">Repository</dt>
            <dd className="truncate font-mono text-[10px] text-[var(--ink)]" title={repository}>{repository}</dd>
            {/* A recipe belongs to a real checkout: the demonstration has none. */}
            {onOpenRecipe && repository.startsWith("/") && <dd className="mt-0.5"><button type="button" onClick={onOpenRecipe} title="What the harness keeps to start the application of this repository" className="text-[10px] text-[var(--muted)] underline decoration-[var(--line)] underline-offset-2 transition hover:text-[var(--ink)]">Runtime recipe</button></dd>}
          </div>
          {run.baseBranch && (
            <div>
              <dt className="text-[10px] font-semibold text-[var(--muted)]">Stacked on</dt>
              <dd className="truncate font-mono text-[10px] text-[var(--ink)]" title={run.baseBranch}>{run.baseBranch}</dd>
            </div>
          )}
          {!run.baseBranch && run.ticketBaseBranch && (
            <div>
              <dt className="text-[10px] font-semibold text-[var(--muted)]">Base branch</dt>
              <dd className="truncate font-mono text-[10px] text-[var(--ink)]" title={run.ticketBaseBranch}>{run.ticketBaseBranch}</dd>
            </div>
          )}
          {worktree && run.worktree && (
            <div>
              <dt className="text-[10px] font-semibold text-[var(--muted)]">Worktree</dt>
              <dd className={`font-mono text-[10px] ${run.worktree.state === "active" ? "truncate text-[var(--ink)]" : "leading-4 text-[var(--muted)]"}`} title={run.worktree.path}>{worktree}</dd>
              {run.worktree.state === "active" && run.worktree.dependencies === "symlink" && <dd className="mt-0.5 text-[10px] leading-4 text-[var(--muted)]">Dependencies linked to the main checkout</dd>}
            </div>
          )}
        </dl>
        {run.startedAt && <p className="mt-2 font-mono text-[10px] text-[var(--muted)]">{elapsedLabel(run.startedAt, run.endedAt ?? undefined, now)}</p>}
        {run.usage && (
          <div className="mt-3">
            <p className="text-[10px] font-semibold text-[var(--muted)]">Tokens</p>
            <p className="font-mono text-[10px] text-[var(--ink)]" title={`${run.usage.total.toLocaleString("en-US")} tokens read and written, cache included`}>{formatTokens(run.usage.total)}</p>
            <p className="mt-0.5 text-[10px] leading-4 text-[var(--muted)]">Pilot {formatTokens(run.usage.pilot)} in {run.usage.pilotCalls} calls{run.usage.agents > 0 ? `, ${run.usage.agents} agent${run.usage.agents > 1 ? "s" : ""}` : ""}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
