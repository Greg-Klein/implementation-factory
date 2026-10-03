"use client";

import { CaretRightIcon, ChartBarIcon } from "@phosphor-icons/react";
import { Fragment, useEffect, useState } from "react";
import { formatDuration, formatShare, formatTokens, planSizes, reworkCount, sessionLabel, summarize, waitLabel } from "@/lib/metrics";
import { runLabel, statusLabel } from "@/lib/run-state";
import type { MetricsResponse, RunMetrics } from "@/lib/types";

/** A run still going moves its figures: the table follows at this pace while it is on screen. */
const POLL_MS = 10_000;

const PHASES = ["Lire le ticket", "Clarifier", "Créer la branche", "Planifier", "Implémenter", "Vérifier", "Revoir", "Ouvrir la MR", "Publier la revue", "Terminer"];

const STATUS_TONE: Record<string, string> = {
  completed: "bg-emerald-50 text-emerald-700", failed: "bg-red-50 text-red-700", stopped: "bg-[var(--line)] text-[var(--muted)]",
};

function Figure({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div title={help}>
      <dt className="text-[10px] uppercase tracking-[.16em] text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-[var(--ink)]">{value}</dd>
    </div>
  );
}

function outcomeLabel(run: RunMetrics) {
  if (run.outcome.status !== "completed") return statusLabel(run.outcome.status);
  return run.outcome.delivery === "draft_merge_request" ? "MR en brouillon" : run.outcome.delivery === "none" ? "Sans MR" : "MR ouverte";
}

function Detail({ run }: { run: RunMetrics }) {
  const tokens = run.tokens;
  const sessions = tokens ? [{ key: "pilot", name: "Pilote", ...tokens.pilot, activeMs: undefined as number | undefined }, ...tokens.agents.map((agent) => ({ key: agent.agentId, ...agent, name: sessionLabel(agent.name) }))] : [];
  return (
    <div className="grid gap-6 bg-[var(--sunken)] px-5 py-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:px-7">
      <div>
        <p className="text-[10px] font-semibold text-[var(--muted)]">Tokens par session</p>
        {tokens ? (
          <table className="mt-2 w-full text-left text-[11px]">
            <thead className="text-[10px] text-[var(--muted)]">
              <tr><th className="pb-1 font-medium">Session</th><th className="pb-1 font-medium">Modèle</th><th className="pb-1 text-right font-medium">Appels</th><th className="pb-1 text-right font-medium" title="Tokens relus depuis le cache à chaque appel">Cache lu</th><th className="pb-1 text-right font-medium">Sortie</th><th className="pb-1 text-right font-medium">Total</th></tr>
            </thead>
            <tbody className="font-mono text-[10px]">
              {sessions.map((session) => (
                <tr key={session.key} className="border-t border-[var(--line)]">
                  <td className="py-1 font-sans text-[11px] text-[var(--ink)]">{session.name}</td>
                  <td className="py-1 text-[var(--muted)]">{session.model?.replace(/^claude-/, "") ?? ""}</td>
                  <td className="py-1 text-right">{session.calls}</td>
                  <td className="py-1 text-right">{formatTokens(session.cacheRead)}</td>
                  <td className="py-1 text-right">{formatTokens(session.output)}</td>
                  <td className="py-1 text-right text-[var(--ink)]">{formatTokens(session.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="mt-2 text-[11px] text-[var(--muted)]">Le transcript de ce run n’est plus sur le disque : ses tokens ne peuvent plus être lus.</p>}
        {tokens && <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">Le pilote démarre avec <span className="font-mono text-[10px] text-[var(--ink)]">{formatTokens(tokens.pilot.firstContext)}</span> de contexte et monte jusqu’à <span className="font-mono text-[10px] text-[var(--ink)]">{formatTokens(tokens.pilot.peakContext)}</span>. Ce contexte est relu à chacun de ses {tokens.pilot.calls} appels.</p>}
      </div>
      <div className="space-y-4">
        <div>
          <p className="text-[10px] font-semibold text-[var(--muted)]">Temps</p>
          <dl className="mt-2 space-y-1 text-[11px]">
            <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Du début à la fin</dt><dd className="font-mono text-[10px]">{formatDuration(run.time.elapsedMs)}</dd></div>
            {run.time.waits.map((wait) => <div key={wait.reason} className="flex justify-between gap-3"><dt className="text-[var(--muted)]">{waitLabel(wait.reason)} · {wait.count}</dt><dd className="font-mono text-[10px]">{formatDuration(wait.ms)}</dd></div>)}
            {run.time.incidentMs > 0 && <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Sous incident</dt><dd className="font-mono text-[10px]">{formatDuration(run.time.incidentMs)}</dd></div>}
            {run.time.phases.filter((phase) => phase.ms >= 1_000 && phase.phase <= PHASES.length).map((phase) => <div key={phase.phase} className="flex justify-between gap-3"><dt className="text-[var(--muted)]">{phase.phase}. {PHASES[phase.phase - 1]}</dt><dd className="font-mono text-[10px]">{formatDuration(phase.ms)}</dd></div>)}
          </dl>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-[var(--muted)]">Revue</p>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
            {Object.entries(run.rework.launches).map(([name, count]) => `${sessionLabel(name)} × ${count}`).join(" · ") || "Aucun agent lancé"}
            {run.rework.reworkDevelopers > 0 && ` · ${run.rework.reworkDevelopers} correction${run.rework.reworkDevelopers > 1 ? "s" : ""} après revue`}
            {run.outcome.acceptance && ` · ${run.outcome.acceptance.verified}/${run.outcome.acceptance.total} critères vérifiés`}
            {run.outcome.incidents.length > 0 && ` · ${run.outcome.incidents.length} incident${run.outcome.incidents.length > 1 ? "s" : ""}`}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * What every measured run cost and delivered, one row per run. A table and not
 * charts on purpose: with a few dozen runs at most, a curve would smooth away
 * the one thing worth seeing, which run stands out and why.
 */
export function MetricsPanel() {
  const [runs, setRuns] = useState<RunMetrics[]>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<string>();

  useEffect(() => {
    let disposed = false;
    const load = () => fetch("/api/metrics")
      .then((response) => response.json() as Promise<MetricsResponse>)
      .then((result) => { if (!disposed) { setRuns(result.runs ?? []); setError(result.error); } })
      .catch(() => { if (!disposed) setError("Les mesures n’ont pas pu être lues. Vérifie que le serveur local tourne."); });
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  const summary = runs ? summarize(runs) : undefined;

  return (
    <section aria-label="Mesures des runs" className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b border-[var(--line)] px-5 py-5 md:px-7">
        <h2 className="flex items-center gap-2 text-sm font-medium"><ChartBarIcon size={15} />Mesures</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">Ce que chaque run a consommé et livré. Les tailles du plan et le palier de revue sont des estimations du harnais ; le diff est ce que le ticket a réellement demandé.</p>
        {summary && (
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label="Tokens" value={summary.tokens !== undefined ? formatTokens(summary.tokens) : "n/d"} help={`Médiane des ${summary.runs} runs livrés, cache compris`} />
            <Figure label="Temps actif" value={summary.activeMs !== undefined ? formatDuration(summary.activeMs) : "n/d"} help="Médiane du temps hors attente de l’utilisateur" />
            <Figure label="Attente" value={summary.userWaitMs !== undefined ? formatDuration(summary.userWaitMs) : "n/d"} help="Médiane du temps passé à attendre une réponse de l’utilisateur" />
            <Figure label="Part du pilote" value={summary.pilotShare !== undefined ? formatShare(summary.pilotShare) : "n/d"} help="Médiane de la part des tokens lus par la session pilote" />
          </dl>
        )}
        {runs && runs.length > 0 && !summary && <p className="mt-3 text-[11px] text-[var(--muted)]">Les médianes s’affichent à partir de trois runs livrés.</p>}
      </div>
      {error && <p role="alert" className="border-b border-red-200 bg-red-50 px-5 py-3 text-[11px] text-red-800 md:px-7">{error}</p>}
      {runs && runs.length === 0 && !error && <p className="px-5 py-8 text-xs text-[var(--muted)] md:px-7">Aucun run mesuré pour l’instant. Les mesures d’un run s’écrivent à sa fin.</p>}
      {runs && runs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-[11px]">
            <thead className="border-b border-[var(--line)] text-[10px] text-[var(--muted)]">
              <tr>
                <th className="py-2 pl-5 pr-2 font-medium md:pl-7">Run</th>
                <th className="px-2 py-2 font-medium" title="Commit du harnais au lancement du run">Harnais</th>
                <th className="px-2 py-2 font-medium" title="Palier de revue choisi par le pilote, et tailles des tâches du plan">Prévu</th>
                <th className="px-2 py-2 font-medium" title="Taille réelle du changement : fichiers, lignes ajoutées et retirées">Diff</th>
                <th className="px-2 py-2 text-right font-medium" title="Tous les tokens lus et écrits, cache compris">Tokens</th>
                <th className="px-2 py-2 text-right font-medium" title="Part des tokens lus par la session pilote, et nombre de ses appels">Pilote</th>
                <th className="px-2 py-2 text-right font-medium" title="Durée du run hors attente de l’utilisateur">Actif</th>
                <th className="px-2 py-2 text-right font-medium" title="Temps passé à attendre une réponse de l’utilisateur">Attente</th>
                <th className="px-2 py-2 text-right font-medium" title="Passes de revue au-delà de la première, et corrections après revue">Reprises</th>
                <th className="py-2 pl-2 pr-5 font-medium md:pr-7">Issue</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const expanded = open === run.runId;
                const diff = run.complexity.diff;
                const rework = reworkCount(run);
                const label = runLabel({ cwd: run.ticket.repository, repository: run.ticket.repository, issueUrl: run.ticket.issueUrl });
                return (
                  <Fragment key={run.runId}>
                    <tr className={`border-b border-[var(--line)] ${expanded ? "bg-[var(--raised)]" : "hover:bg-[var(--raised)]/60"}`}>
                      <td className="max-w-64 py-2 pl-5 pr-2 md:pl-7">
                        <button type="button" aria-expanded={expanded} aria-label={`Détail des mesures du run ${label}`} onClick={() => setOpen(expanded ? undefined : run.runId)} className="flex w-full items-start gap-1.5 text-left">
                          <CaretRightIcon size={10} className={`mt-1 shrink-0 text-[var(--muted)] transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-[var(--ink)]">{run.ticket.title ?? label}</span>
                            <span className="block truncate font-mono text-[9px] text-[var(--muted)]">{label}{run.time.startedAt ? ` · ${new Date(run.time.startedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}</span>
                          </span>
                        </button>
                      </td>
                      <td className="px-2 py-2 font-mono text-[10px] text-[var(--muted)]">{run.harness?.commit ?? ""}</td>
                      <td className="px-2 py-2 font-mono text-[10px]">{[run.complexity.reviewTier !== undefined ? `palier ${run.complexity.reviewTier}` : "", planSizes(run)].filter(Boolean).join(" · ")}</td>
                      <td className="whitespace-nowrap px-2 py-2 font-mono text-[10px]">{diff ? `${diff.files} f · +${diff.insertions} −${diff.deletions}` : ""}</td>
                      <td className="px-2 py-2 text-right font-mono text-[10px] text-[var(--ink)]">{run.tokens ? formatTokens(run.tokens.total.total) : ""}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-[10px]">{run.tokens ? `${formatShare(run.tokens.pilotShare)} · ${run.tokens.pilot.calls}` : ""}</td>
                      <td className="px-2 py-2 text-right font-mono text-[10px]">{formatDuration(run.time.activeMs)}</td>
                      <td className="px-2 py-2 text-right font-mono text-[10px]">{run.time.userWaitMs > 0 ? formatDuration(run.time.userWaitMs) : ""}</td>
                      <td className={`px-2 py-2 text-right font-mono text-[10px] ${rework > 0 ? "font-semibold text-amber-800" : ""}`}>{rework > 0 ? rework : ""}</td>
                      <td className="py-2 pl-2 pr-5 md:pr-7">
                        <span className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ${run.final ? STATUS_TONE[run.outcome.status] ?? "bg-[var(--line)] text-[var(--muted)]" : "bg-[var(--accent-soft)] text-[var(--accent)]"}`}>{run.final || run.outcome.status === "completed" ? outcomeLabel(run) : "En cours"}</span>
                      </td>
                    </tr>
                    {expanded && <tr className="border-b border-[var(--line)]"><td colSpan={10} className="p-0"><Detail run={run} /></td></tr>}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
