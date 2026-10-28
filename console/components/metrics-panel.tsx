"use client";

import type { Language } from "@/lib/i18n";
import { useLanguage, useTexts } from "./language";
import { CaretRightIcon, ChartBarIcon } from "@phosphor-icons/react";
import { Fragment, useEffect, useState } from "react";
import { formatCost, formatDuration, formatShare, formatTokens, judgeRows, judgeSummary, planSizes, reworkCount, sessionLabel, summarize, waitLabel } from "@/lib/metrics";
import { confidenceChip, phaseNames, runLabel, statusLabel } from "@/lib/run-state";
import { shortDateTime } from "@/lib/i18n";
import { texts } from "@/lib/i18n/texts";
import { forgeOf, forgeWords } from "@/lib/ticket-urls";
import type { ConfidenceCalibration, ImprovementMetrics, MetricsResponse, RunMetrics } from "@/lib/types";

/** A run still going moves its figures: the table follows at this pace while it is on screen. */
const POLL_MS = 10_000;


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

function outcomeLabel(run: RunMetrics, language: Language) {
  if (run.outcome.status !== "completed") return statusLabel(run.outcome.status, language);
  const { short } = forgeWords(forgeOf(run.ticket.issueUrl));
  const t = texts(language).metrics;
  return run.outcome.delivery === "draft_merge_request" ? t.draftDelivery(short) : run.outcome.delivery === "none" ? t.noDelivery(short) : t.openedDelivery(short);
}

function Detail({ run }: { run: RunMetrics }) {
  const language = useLanguage();
  const t = useTexts().metrics;
  const tokens = run.tokens;
  const sessions = tokens ? [{ key: "pilot", name: t.pilot, ...tokens.pilot, activeMs: undefined as number | undefined }, ...tokens.agents.map((agent) => ({ key: agent.agentId, ...agent, name: sessionLabel(agent.name, language) }))] : [];
  return (
    <div className="grid gap-6 bg-[var(--sunken)] px-5 py-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:px-7">
      <div>
        <p className="text-[10px] font-semibold text-[var(--muted)]">{t.tokensPerSession}</p>
        {tokens ? (
          <table className="mt-2 w-full text-left text-[11px]">
            <thead className="text-[10px] text-[var(--muted)]">
              <tr><th className="pb-1 font-medium">{t.session}</th><th className="pb-1 font-medium">{t.model}</th><th className="pb-1 text-right font-medium">{t.calls}</th><th className="pb-1 text-right font-medium" title={t.cacheReadHelp}>{t.cacheRead}</th><th className="pb-1 text-right font-medium">{t.output}</th><th className="pb-1 text-right font-medium">{t.total}</th></tr>
            </thead>
            <tbody className="font-mono text-[10px]">
              {sessions.map((session) => (
                <tr key={session.key} className="border-t border-[var(--line)]">
                  <td className="py-1 font-sans text-[11px] text-[var(--ink)]">{session.name}</td>
                  <td className="py-1 text-[var(--muted)]">{session.model?.replace(/^claude-/, "") ?? ""}</td>
                  <td className="py-1 text-right">{session.calls}</td>
                  <td className="py-1 text-right">{formatTokens(session.cacheRead, language)}</td>
                  <td className="py-1 text-right">{formatTokens(session.output, language)}</td>
                  <td className="py-1 text-right text-[var(--ink)]">{formatTokens(session.total, language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="mt-2 text-[11px] text-[var(--muted)]">{t.transcriptGone}</p>}
        {tokens && <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">{t.pilotStartsWith} <span className="font-mono text-[10px] text-[var(--ink)]">{formatTokens(tokens.pilot.firstContext, language)}</span> {t.ofContextAndClimbsTo} <span className="font-mono text-[10px] text-[var(--ink)]">{formatTokens(tokens.pilot.peakContext, language)}</span>. {t.contextReadAgain(tokens.pilot.calls)}</p>}
      </div>
      <div className="space-y-4">
        <div>
          <p className="text-[10px] font-semibold text-[var(--muted)]">{t.time}</p>
          <dl className="mt-2 space-y-1 text-[11px]">
            <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">{t.fromStartToEnd}</dt><dd className="font-mono text-[10px]">{formatDuration(run.time.elapsedMs)}</dd></div>
            {run.time.waits.map((wait) => <div key={wait.reason} className="flex justify-between gap-3"><dt className="text-[var(--muted)]">{waitLabel(wait.reason, language)} · {wait.count}</dt><dd className="font-mono text-[10px]">{formatDuration(wait.ms)}</dd></div>)}
            {run.time.reopened && <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">{t.changesAfterReport} · {run.time.reopened.count}</dt><dd className="font-mono text-[10px]">{formatDuration(run.time.reopened.ms)}</dd></div>}
            {run.time.incidentMs > 0 && <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">{t.underIncident}</dt><dd className="font-mono text-[10px]">{formatDuration(run.time.incidentMs)}</dd></div>}
            {run.time.phases.filter((phase) => phase.ms >= 1_000 && phase.phase <= phaseNames(run.ticket.issueUrl, language).length).map((phase) => <div key={phase.phase} className="flex justify-between gap-3"><dt className="text-[var(--muted)]">{phase.phase}. {phaseNames(run.ticket.issueUrl, language)[phase.phase - 1]}</dt><dd className="font-mono text-[10px]">{formatDuration(phase.ms)}</dd></div>)}
          </dl>
        </div>
        {run.time.gate && (
          <div>
            <p className="text-[10px] font-semibold text-[var(--muted)]" title={t.checksAtStopHelp}>{t.checksAtStop}</p>
            <dl className="mt-2 space-y-1 text-[11px]">
              {run.time.gate.steps.map((step) => <div key={step.step} className="flex justify-between gap-3"><dt className="text-[var(--muted)]">{step.step} · {step.runs}</dt><dd className="font-mono text-[10px]">{formatDuration(step.ms)}</dd></div>)}
            </dl>
          </div>
        )}
        <div>
          <p className="text-[10px] font-semibold text-[var(--muted)]">{t.review}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
            {Object.entries(run.rework.launches).map(([name, count]) => `${sessionLabel(name, language)} × ${count}`).join(" · ") || t.noAgentStarted}
            {run.rework.reworkDevelopers > 0 && ` · ${t.fixesAfterReview(run.rework.reworkDevelopers)}`}
            {run.outcome.acceptance && ` · ${t.criteriaVerified(run.outcome.acceptance.verified, run.outcome.acceptance.total)}`}
            {run.outcome.incidents.length > 0 && ` · ${t.incidents(run.outcome.incidents.length)}`}
          </p>
        </div>
      </div>
    </div>
  );
}

const CONFIDENCE_TONE = { error: "text-red-700", attention: "text-amber-800", verified: "text-[var(--accent)]", neutral: "text-[var(--ink)]" } as const;

/** Whether the review confidence means anything: what followed delivery for the runs of each note. */
function Calibration({ calibration }: { calibration: ConfidenceCalibration }) {
  const language = useLanguage();
  const t = useTexts().metrics;
  return (
    <div className="border-t border-[var(--line)]" data-testid="confidence-calibration">
      <div className="px-5 py-5 md:px-7">
        <h3 className="text-xs font-medium">{t.reviewConfidence}</h3>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">{t.calibrationHelp}</p>
        {calibration.length === 0 && <p className="mt-3 text-[11px] text-[var(--muted)]">{t.calibrationEmpty}</p>}
      </div>
      {calibration.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-[11px]">
            <thead className="border-y border-[var(--line)] text-[10px] text-[var(--muted)]">
              <tr>
                <th className="py-2 pl-5 pr-2 font-medium md:pl-7" title={t.confidenceHelp}>{t.confidence}</th>
                <th className="px-2 py-2 text-right font-medium">{t.deliveredRuns}</th>
                <th className="px-2 py-2 text-right font-medium" title={t.reopenedHelp}>{t.reopened}</th>
                <th className="py-2 pl-2 pr-5 text-right font-medium md:pr-7" title={t.withFeedbackHelp}>{t.withFeedback}</th>
              </tr>
            </thead>
            <tbody>
              {calibration.map((row) => (
                <tr key={row.score} className="border-b border-[var(--line)]">
                  <td className={`py-2 pl-5 pr-2 font-mono text-[10px] font-semibold md:pl-7 ${CONFIDENCE_TONE[confidenceChip(row.score, language)!.tone]}`}>{confidenceChip(row.score, language)!.label}</td>
                  <td className="px-2 py-2 text-right font-mono text-[10px]">{row.runs}</td>
                  <td className="px-2 py-2 text-right font-mono text-[10px]">{row.reopened}</td>
                  <td className="py-2 pl-2 pr-5 text-right font-mono text-[10px] md:pr-7">{row.feedback}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const VERDICT_TONE: Record<string, string> = { merged: "bg-emerald-50 text-emerald-700", rejected: "bg-red-50 text-red-700" };

/** The improvement loop: what the judge decided and what each decision cost it. */
function Improvements({ improvements }: { improvements: ImprovementMetrics }) {
  const language = useLanguage();
  const t = useTexts().metrics;
  const rows = judgeRows(improvements);
  const summary = judgeSummary(rows);
  return (
    <div className="border-t border-[var(--line)]">
      <div className="px-5 py-5 md:px-7">
        <h3 className="text-xs font-medium">{t.selfImprovement}</h3>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">{t.selfImprovementHelp}</p>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Figure label={t.merged} value={String(improvements.merged)} help={improvements.reverted > 0 ? t.revertedSince(improvements.reverted) : t.mergedHelp} />
          <Figure label={t.rejected} value={String(improvements.rejected)} help={t.rejectedHelp(improvements.rejectedByJudge)} />
          <Figure label={t.judgeTime} value={summary.durationMs !== undefined ? formatDuration(summary.durationMs) : t.notAvailable} help={t.judgeTimeHelp} />
          <Figure label={t.judgeTokens} value={summary.tokens !== undefined ? formatTokens(summary.tokens, language) : t.notAvailable} help={t.judgeTokensHelp} />
          <Figure label={t.judgeCost} value={rows.length > 0 ? formatCost(summary.costUsd, language) : t.notAvailable} help={t.judgeCostHelp} />
        </dl>
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[11px]">
            <thead className="border-y border-[var(--line)] text-[10px] text-[var(--muted)]">
              <tr>
                <th className="py-2 pl-5 pr-2 font-medium md:pl-7">{t.branch}</th>
                <th className="px-2 py-2 font-medium">{t.decision}</th>
                <th className="px-2 py-2 text-right font-medium" title={t.passesHelp}>{t.passes}</th>
                <th className="px-2 py-2 text-right font-medium">{t.timeColumn}</th>
                <th className="px-2 py-2 text-right font-medium" title={t.tokensHelp}>{t.tokens}</th>
                <th className="py-2 pl-2 pr-5 text-right font-medium md:pr-7">{t.cost}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.worktreeName}-${row.at}`} className="border-b border-[var(--line)]">
                  <td className="py-2 pl-5 pr-2 md:pl-7">
                    <span className="block font-mono text-[10px] text-[var(--ink)]">{row.worktreeName}</span>
                    <span className="block font-mono text-[9px] text-[var(--muted)]">{shortDateTime(language, row.at)}</span>
                  </td>
                  <td className="px-2 py-2"><span title={row.reasons.join("\n")} className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ${VERDICT_TONE[row.decision] ?? "bg-[var(--line)] text-[var(--muted)]"}`}>{row.decision === "merged" ? t.decisionMerged : row.decision === "rejected" ? t.decisionRejected : t.decisionReverted}</span></td>
                  <td className="px-2 py-2 text-right font-mono text-[10px]">{row.passes}</td>
                  <td className="px-2 py-2 text-right font-mono text-[10px]">{formatDuration(row.durationMs)}</td>
                  <td className="px-2 py-2 text-right font-mono text-[10px] text-[var(--ink)]" title={row.complete ? undefined : t.timeoutNoFigure}>{row.tokens !== undefined ? `${formatTokens(row.tokens, language)}${row.complete ? "" : "+"}` : ""}</td>
                  <td className="py-2 pl-2 pr-5 text-right font-mono text-[10px] md:pr-7">{row.costUsd !== undefined ? formatCost(row.costUsd, language) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * What every measured run cost and delivered, one row per run. A table and not
 * charts on purpose: with a few dozen runs at most, a curve would smooth away
 * the one thing worth seeing, which run stands out and why.
 */
export function MetricsPanel() {
  const language = useLanguage();
  const t = useTexts().metrics;
  const [runs, setRuns] = useState<RunMetrics[]>();
  const [improvements, setImprovements] = useState<ImprovementMetrics>();
  const [calibration, setCalibration] = useState<ConfidenceCalibration>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<string>();

  useEffect(() => {
    let disposed = false;
    const load = () => fetch("/api/metrics")
      .then((response) => response.json() as Promise<MetricsResponse>)
      .then((result) => { if (!disposed) { setRuns(result.runs ?? []); setImprovements(result.improvements); setCalibration(result.calibration); setError(result.error); } })
      .catch(() => { if (!disposed) setError(t.metricsUnreadable); });
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [t.metricsUnreadable]);

  const summary = runs ? summarize(runs) : undefined;

  return (
    <section aria-label={t.runMetrics} className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b border-[var(--line)] px-5 py-5 md:px-7">
        <h2 className="flex items-center gap-2 text-sm font-medium"><ChartBarIcon size={15} />{t.metrics}</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">{t.intro}</p>
        {summary && (
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label={t.tokensFigure} value={summary.tokens !== undefined ? formatTokens(summary.tokens, language) : t.notAvailable} help={t.medianDelivered(summary.runs)} />
            <Figure label={t.activeTime} value={summary.activeMs !== undefined ? formatDuration(summary.activeMs) : t.notAvailable} help={t.activeTimeHelp} />
            <Figure label={t.wait} value={summary.userWaitMs !== undefined ? formatDuration(summary.userWaitMs) : t.notAvailable} help={t.waitHelp} />
            <Figure label={t.pilotShare} value={summary.pilotShare !== undefined ? formatShare(summary.pilotShare) : t.notAvailable} help={t.pilotShareHelp} />
          </dl>
        )}
        {runs && runs.length > 0 && !summary && <p className="mt-3 text-[11px] text-[var(--muted)]">{t.mediansFromThree}</p>}
      </div>
      {error && <p role="alert" className="border-b border-red-200 bg-red-50 px-5 py-3 text-[11px] text-red-800 md:px-7">{error}</p>}
      {runs && runs.length === 0 && !error && <p className="px-5 py-8 text-xs text-[var(--muted)] md:px-7">{t.noRunMeasured}</p>}
      {runs && runs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-[11px]">
            <thead className="border-b border-[var(--line)] text-[10px] text-[var(--muted)]">
              <tr>
                <th className="py-2 pl-5 pr-2 font-medium md:pl-7">{t.run}</th>
                <th className="px-2 py-2 font-medium" title={t.factoryHelp}>{t.factory}</th>
                <th className="px-2 py-2 font-medium" title={t.plannedHelp}>{t.planned}</th>
                <th className="px-2 py-2 font-medium" title={t.diffHelp}>{t.diff}</th>
                <th className="px-2 py-2 text-right font-medium" title={t.tokensHelp}>{t.tokens}</th>
                <th className="px-2 py-2 text-right font-medium" title={t.pilotColumnHelp}>{t.pilot}</th>
                <th className="px-2 py-2 text-right font-medium" title={t.activeHelp}>{t.active}</th>
                <th className="px-2 py-2 text-right font-medium" title={t.waitColumnHelp}>{t.wait}</th>
                <th className="px-2 py-2 text-right font-medium" title={t.reworkHelp}>{t.rework}</th>
                <th className="px-2 py-2 text-right font-medium" title={t.confidenceColumnHelp}>{t.confidence}</th>
                <th className="py-2 pl-2 pr-5 font-medium md:pr-7">{t.outcome}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const expanded = open === run.runId;
                const diff = run.complexity.diff;
                const rework = reworkCount(run);
                const confidence = confidenceChip(run.outcome.confidenceAtDelivery ?? run.outcome.confidence, language);
                const label = runLabel({ cwd: run.ticket.repository, repository: run.ticket.repository, issueUrl: run.ticket.issueUrl });
                return (
                  <Fragment key={run.runId}>
                    <tr className={`border-b border-[var(--line)] ${expanded ? "bg-[var(--raised)]" : "hover:bg-[var(--raised)]/60"}`}>
                      <td className="max-w-64 py-2 pl-5 pr-2 md:pl-7">
                        <button type="button" aria-expanded={expanded} aria-label={t.detailOfRun(label)} onClick={() => setOpen(expanded ? undefined : run.runId)} className="flex w-full items-start gap-1.5 text-left">
                          <CaretRightIcon size={10} className={`mt-1 shrink-0 text-[var(--muted)] transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-[var(--ink)]">{run.ticket.title ?? label}</span>
                            <span className="block truncate font-mono text-[9px] text-[var(--muted)]">{label}{run.time.startedAt ? ` · ${shortDateTime(language, run.time.startedAt)}` : ""}</span>
                          </span>
                        </button>
                      </td>
                      <td className="px-2 py-2 font-mono text-[10px] text-[var(--muted)]">{run.factory?.commit ?? ""}</td>
                      <td className="px-2 py-2 font-mono text-[10px]">{[run.complexity.reviewTier !== undefined ? t.tier(run.complexity.reviewTier) : "", planSizes(run, language)].filter(Boolean).join(" · ")}</td>
                      <td className="whitespace-nowrap px-2 py-2 font-mono text-[10px]">{diff ? `${diff.files} f · +${diff.insertions} −${diff.deletions}` : ""}</td>
                      <td className="px-2 py-2 text-right font-mono text-[10px] text-[var(--ink)]">{run.tokens ? formatTokens(run.tokens.total.total, language) : ""}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-[10px]">{run.tokens ? `${formatShare(run.tokens.pilotShare)} · ${run.tokens.pilot.calls}` : ""}</td>
                      <td className="px-2 py-2 text-right font-mono text-[10px]">{formatDuration(run.time.activeMs)}</td>
                      <td className="px-2 py-2 text-right font-mono text-[10px]">{run.time.userWaitMs > 0 ? formatDuration(run.time.userWaitMs) : ""}</td>
                      <td className={`px-2 py-2 text-right font-mono text-[10px] ${rework > 0 ? "font-semibold text-amber-800" : ""}`}>{rework > 0 ? rework : ""}</td>
                      <td title={confidence?.title} className={`px-2 py-2 text-right font-mono text-[10px] font-semibold ${confidence ? CONFIDENCE_TONE[confidence.tone] : ""}`}>{confidence?.label ?? ""}</td>
                      <td className="py-2 pl-2 pr-5 md:pr-7">
                        <span className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ${run.final ? STATUS_TONE[run.outcome.status] ?? "bg-[var(--line)] text-[var(--muted)]" : "bg-[var(--accent-soft)] text-[var(--accent)]"}`}>{run.final || run.outcome.status === "completed" ? outcomeLabel(run, language) : t.running}</span>
                      </td>
                    </tr>
                    {expanded && <tr className="border-b border-[var(--line)]"><td colSpan={11} className="p-0"><Detail run={run} /></td></tr>}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {calibration && runs && runs.length > 0 && <Calibration calibration={calibration} />}
      {improvements && <Improvements improvements={improvements} />}
    </section>
  );
}
