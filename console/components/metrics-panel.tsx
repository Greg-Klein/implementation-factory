"use client";

import { CaretRightIcon, ChartBarIcon } from "@phosphor-icons/react";
import { Fragment, useEffect, useState } from "react";
import { formatCost, formatDuration, formatShare, formatTokens, judgeRows, judgeSummary, planSizes, reworkCount, sessionLabel, summarize, waitLabel } from "@/lib/metrics";
import { confidenceChip, phaseNames, runLabel, statusLabel } from "@/lib/run-state";
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

function outcomeLabel(run: RunMetrics) {
  if (run.outcome.status !== "completed") return statusLabel(run.outcome.status);
  const { short } = forgeWords(forgeOf(run.ticket.issueUrl));
  return run.outcome.delivery === "draft_merge_request" ? `Draft ${short}` : run.outcome.delivery === "none" ? `No ${short}` : `${short} opened`;
}

function Detail({ run }: { run: RunMetrics }) {
  const tokens = run.tokens;
  const sessions = tokens ? [{ key: "pilot", name: "Pilot", ...tokens.pilot, activeMs: undefined as number | undefined }, ...tokens.agents.map((agent) => ({ key: agent.agentId, ...agent, name: sessionLabel(agent.name) }))] : [];
  return (
    <div className="grid gap-6 bg-[var(--sunken)] px-5 py-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:px-7">
      <div>
        <p className="text-[10px] font-semibold text-[var(--muted)]">Tokens per session</p>
        {tokens ? (
          <table className="mt-2 w-full text-left text-[11px]">
            <thead className="text-[10px] text-[var(--muted)]">
              <tr><th className="pb-1 font-medium">Session</th><th className="pb-1 font-medium">Model</th><th className="pb-1 text-right font-medium">Calls</th><th className="pb-1 text-right font-medium" title="Tokens read back from the cache on each call">Cache read</th><th className="pb-1 text-right font-medium">Output</th><th className="pb-1 text-right font-medium">Total</th></tr>
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
        ) : <p className="mt-2 text-[11px] text-[var(--muted)]">The transcript of this run is no longer on disk: its tokens can no longer be read.</p>}
        {tokens && <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">The pilot starts with <span className="font-mono text-[10px] text-[var(--ink)]">{formatTokens(tokens.pilot.firstContext)}</span> of context and climbs to <span className="font-mono text-[10px] text-[var(--ink)]">{formatTokens(tokens.pilot.peakContext)}</span>. This context is read again on each of its {tokens.pilot.calls} calls.</p>}
      </div>
      <div className="space-y-4">
        <div>
          <p className="text-[10px] font-semibold text-[var(--muted)]">Time</p>
          <dl className="mt-2 space-y-1 text-[11px]">
            <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">From start to end</dt><dd className="font-mono text-[10px]">{formatDuration(run.time.elapsedMs)}</dd></div>
            {run.time.waits.map((wait) => <div key={wait.reason} className="flex justify-between gap-3"><dt className="text-[var(--muted)]">{waitLabel(wait.reason)} · {wait.count}</dt><dd className="font-mono text-[10px]">{formatDuration(wait.ms)}</dd></div>)}
            {run.time.reopened && <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Changes after the report · {run.time.reopened.count}</dt><dd className="font-mono text-[10px]">{formatDuration(run.time.reopened.ms)}</dd></div>}
            {run.time.incidentMs > 0 && <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Under incident</dt><dd className="font-mono text-[10px]">{formatDuration(run.time.incidentMs)}</dd></div>}
            {run.time.phases.filter((phase) => phase.ms >= 1_000 && phase.phase <= phaseNames(run.ticket.issueUrl).length).map((phase) => <div key={phase.phase} className="flex justify-between gap-3"><dt className="text-[var(--muted)]">{phase.phase}. {phaseNames(run.ticket.issueUrl)[phase.phase - 1]}</dt><dd className="font-mono text-[10px]">{formatDuration(phase.ms)}</dd></div>)}
          </dl>
        </div>
        {run.time.gate && (
          <div>
            <p className="text-[10px] font-semibold text-[var(--muted)]" title="Checks run when a developer or the senior reviewer stops">Checks at agent stop</p>
            <dl className="mt-2 space-y-1 text-[11px]">
              {run.time.gate.steps.map((step) => <div key={step.step} className="flex justify-between gap-3"><dt className="text-[var(--muted)]">{step.step} · {step.runs}</dt><dd className="font-mono text-[10px]">{formatDuration(step.ms)}</dd></div>)}
            </dl>
          </div>
        )}
        <div>
          <p className="text-[10px] font-semibold text-[var(--muted)]">Review</p>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
            {Object.entries(run.rework.launches).map(([name, count]) => `${sessionLabel(name)} × ${count}`).join(" · ") || "No agent started"}
            {run.rework.reworkDevelopers > 0 && ` · ${run.rework.reworkDevelopers} fix${run.rework.reworkDevelopers > 1 ? "es" : ""} after review`}
            {run.outcome.acceptance && ` · ${run.outcome.acceptance.verified}/${run.outcome.acceptance.total} criteria verified`}
            {run.outcome.incidents.length > 0 && ` · ${run.outcome.incidents.length} incident${run.outcome.incidents.length > 1 ? "s" : ""}`}
          </p>
        </div>
      </div>
    </div>
  );
}

const CONFIDENCE_TONE = { error: "text-red-700", attention: "text-amber-800", verified: "text-[var(--accent)]", neutral: "text-[var(--ink)]" } as const;

/** Whether the review confidence means anything: what followed delivery for the runs of each note. */
function Calibration({ calibration }: { calibration: ConfidenceCalibration }) {
  return (
    <div className="border-t border-[var(--line)]" data-testid="confidence-calibration">
      <div className="px-5 py-5 md:px-7">
        <h3 className="text-xs font-medium">Review confidence</h3>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">What followed delivery for the runs of each note. A high note whose runs are reopened as often as a low one says the rules need adjusting.</p>
        {calibration.length === 0 && <p className="mt-3 text-[11px] text-[var(--muted)]">A note shows here from three delivered runs.</p>}
      </div>
      {calibration.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-[11px]">
            <thead className="border-y border-[var(--line)] text-[10px] text-[var(--muted)]">
              <tr>
                <th className="py-2 pl-5 pr-2 font-medium md:pl-7" title="The note the run had when its workflow first ended">Confidence</th>
                <th className="px-2 py-2 text-right font-medium">Delivered runs</th>
                <th className="px-2 py-2 text-right font-medium" title="Runs with a change asked after the final report">Reopened</th>
                <th className="py-2 pl-2 pr-5 text-right font-medium md:pr-7" title="Runs the user wrote feedback on">With feedback</th>
              </tr>
            </thead>
            <tbody>
              {calibration.map((row) => (
                <tr key={row.score} className="border-b border-[var(--line)]">
                  <td className={`py-2 pl-5 pr-2 font-mono text-[10px] font-semibold md:pl-7 ${CONFIDENCE_TONE[confidenceChip(row.score)!.tone]}`}>{confidenceChip(row.score)!.label}</td>
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
  const rows = judgeRows(improvements);
  const summary = judgeSummary(rows);
  return (
    <div className="border-t border-[var(--line)]">
      <div className="px-5 py-5 md:px-7">
        <h3 className="text-xs font-medium">Self-improvement</h3>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">Branches decided by the automatic merge, and the time and tokens the judge took on each one.</p>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Figure label="Merged" value={String(improvements.merged)} help={improvements.reverted > 0 ? `${improvements.reverted} reverted since` : "Branches merged without the user"} />
          <Figure label="Rejected" value={String(improvements.rejected)} help={`${improvements.rejectedByJudge} by the judge, the others by a rule or a failed check`} />
          <Figure label="Judge time" value={summary.durationMs !== undefined ? formatDuration(summary.durationMs) : "n/a"} help="Median time of the judge per decision" />
          <Figure label="Judge tokens" value={summary.tokens !== undefined ? formatTokens(summary.tokens) : "n/a"} help="Median tokens of the judge per decision, cache included" />
          <Figure label="Judge cost" value={rows.length > 0 ? formatCost(summary.costUsd) : "n/a"} help="Total cost at list price, as Claude Code reports it" />
        </dl>
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[11px]">
            <thead className="border-y border-[var(--line)] text-[10px] text-[var(--muted)]">
              <tr>
                <th className="py-2 pl-5 pr-2 font-medium md:pl-7">Branch</th>
                <th className="px-2 py-2 font-medium">Decision</th>
                <th className="px-2 py-2 text-right font-medium" title="Judge sessions on this branch: one more each time the factory or the branch moved under it">Passes</th>
                <th className="px-2 py-2 text-right font-medium">Time</th>
                <th className="px-2 py-2 text-right font-medium" title="All tokens read and written, cache included">Tokens</th>
                <th className="py-2 pl-2 pr-5 text-right font-medium md:pr-7">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.worktreeName}-${row.at}`} className="border-b border-[var(--line)]">
                  <td className="py-2 pl-5 pr-2 md:pl-7">
                    <span className="block font-mono text-[10px] text-[var(--ink)]">{row.worktreeName}</span>
                    <span className="block font-mono text-[9px] text-[var(--muted)]">{new Date(row.at).toLocaleString("en-US", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</span>
                  </td>
                  <td className="px-2 py-2"><span title={row.reasons.join("\n")} className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ${VERDICT_TONE[row.decision] ?? "bg-[var(--line)] text-[var(--muted)]"}`}>{row.decision === "merged" ? "Merged" : row.decision === "rejected" ? "Rejected" : "Reverted"}</span></td>
                  <td className="px-2 py-2 text-right font-mono text-[10px]">{row.passes}</td>
                  <td className="px-2 py-2 text-right font-mono text-[10px]">{formatDuration(row.durationMs)}</td>
                  <td className="px-2 py-2 text-right font-mono text-[10px] text-[var(--ink)]" title={row.complete ? undefined : "A pass ended at its timeout and left no figure"}>{row.tokens !== undefined ? `${formatTokens(row.tokens)}${row.complete ? "" : "+"}` : ""}</td>
                  <td className="py-2 pl-2 pr-5 text-right font-mono text-[10px] md:pr-7">{row.costUsd !== undefined ? formatCost(row.costUsd) : ""}</td>
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
      .catch(() => { if (!disposed) setError("The metrics could not be read. Check that the local server is running."); });
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  const summary = runs ? summarize(runs) : undefined;

  return (
    <section aria-label="Run metrics" className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b border-[var(--line)] px-5 py-5 md:px-7">
        <h2 className="flex items-center gap-2 text-sm font-medium"><ChartBarIcon size={15} />Metrics</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">What each run used and delivered. The plan sizes and the review tier are estimates by the factory; the diff is what the ticket really took.</p>
        {summary && (
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label="Tokens" value={summary.tokens !== undefined ? formatTokens(summary.tokens) : "n/a"} help={`Median of the ${summary.runs} delivered runs, cache included`} />
            <Figure label="Active time" value={summary.activeMs !== undefined ? formatDuration(summary.activeMs) : "n/a"} help="Median time outside waits on the user" />
            <Figure label="Wait" value={summary.userWaitMs !== undefined ? formatDuration(summary.userWaitMs) : "n/a"} help="Median time spent waiting for an answer from the user" />
            <Figure label="Pilot share" value={summary.pilotShare !== undefined ? formatShare(summary.pilotShare) : "n/a"} help="Median share of the tokens read by the pilot session" />
          </dl>
        )}
        {runs && runs.length > 0 && !summary && <p className="mt-3 text-[11px] text-[var(--muted)]">Medians show from three delivered runs.</p>}
      </div>
      {error && <p role="alert" className="border-b border-red-200 bg-red-50 px-5 py-3 text-[11px] text-red-800 md:px-7">{error}</p>}
      {runs && runs.length === 0 && !error && <p className="px-5 py-8 text-xs text-[var(--muted)] md:px-7">No run measured yet. The metrics of a run are written when it ends.</p>}
      {runs && runs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-[11px]">
            <thead className="border-b border-[var(--line)] text-[10px] text-[var(--muted)]">
              <tr>
                <th className="py-2 pl-5 pr-2 font-medium md:pl-7">Run</th>
                <th className="px-2 py-2 font-medium" title="Commit of the factory when the run started">Factory</th>
                <th className="px-2 py-2 font-medium" title="Review tier chosen by the pilot, and sizes of the plan tasks">Planned</th>
                <th className="px-2 py-2 font-medium" title="Actual size of the change: files, lines added and removed">Diff</th>
                <th className="px-2 py-2 text-right font-medium" title="All tokens read and written, cache included">Tokens</th>
                <th className="px-2 py-2 text-right font-medium" title="Share of the tokens read by the pilot session, and number of its calls">Pilot</th>
                <th className="px-2 py-2 text-right font-medium" title="Duration of the run outside waits on the user">Active</th>
                <th className="px-2 py-2 text-right font-medium" title="Time spent waiting for an answer from the user">Wait</th>
                <th className="px-2 py-2 text-right font-medium" title="Review passes beyond the first, and fixes after review">Rework</th>
                <th className="px-2 py-2 text-right font-medium" title="Review confidence when the workflow ended, from 0 (a person reviews everything) to 5">Confidence</th>
                <th className="py-2 pl-2 pr-5 font-medium md:pr-7">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const expanded = open === run.runId;
                const diff = run.complexity.diff;
                const rework = reworkCount(run);
                const confidence = confidenceChip(run.outcome.confidenceAtDelivery ?? run.outcome.confidence);
                const label = runLabel({ cwd: run.ticket.repository, repository: run.ticket.repository, issueUrl: run.ticket.issueUrl });
                return (
                  <Fragment key={run.runId}>
                    <tr className={`border-b border-[var(--line)] ${expanded ? "bg-[var(--raised)]" : "hover:bg-[var(--raised)]/60"}`}>
                      <td className="max-w-64 py-2 pl-5 pr-2 md:pl-7">
                        <button type="button" aria-expanded={expanded} aria-label={`Metrics detail of run ${label}`} onClick={() => setOpen(expanded ? undefined : run.runId)} className="flex w-full items-start gap-1.5 text-left">
                          <CaretRightIcon size={10} className={`mt-1 shrink-0 text-[var(--muted)] transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-[var(--ink)]">{run.ticket.title ?? label}</span>
                            <span className="block truncate font-mono text-[9px] text-[var(--muted)]">{label}{run.time.startedAt ? ` · ${new Date(run.time.startedAt).toLocaleString("en-US", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}` : ""}</span>
                          </span>
                        </button>
                      </td>
                      <td className="px-2 py-2 font-mono text-[10px] text-[var(--muted)]">{run.factory?.commit ?? ""}</td>
                      <td className="px-2 py-2 font-mono text-[10px]">{[run.complexity.reviewTier !== undefined ? `tier ${run.complexity.reviewTier}` : "", planSizes(run)].filter(Boolean).join(" · ")}</td>
                      <td className="whitespace-nowrap px-2 py-2 font-mono text-[10px]">{diff ? `${diff.files} f · +${diff.insertions} −${diff.deletions}` : ""}</td>
                      <td className="px-2 py-2 text-right font-mono text-[10px] text-[var(--ink)]">{run.tokens ? formatTokens(run.tokens.total.total) : ""}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-[10px]">{run.tokens ? `${formatShare(run.tokens.pilotShare)} · ${run.tokens.pilot.calls}` : ""}</td>
                      <td className="px-2 py-2 text-right font-mono text-[10px]">{formatDuration(run.time.activeMs)}</td>
                      <td className="px-2 py-2 text-right font-mono text-[10px]">{run.time.userWaitMs > 0 ? formatDuration(run.time.userWaitMs) : ""}</td>
                      <td className={`px-2 py-2 text-right font-mono text-[10px] ${rework > 0 ? "font-semibold text-amber-800" : ""}`}>{rework > 0 ? rework : ""}</td>
                      <td title={confidence?.title} className={`px-2 py-2 text-right font-mono text-[10px] font-semibold ${confidence ? CONFIDENCE_TONE[confidence.tone] : ""}`}>{confidence?.label ?? ""}</td>
                      <td className="py-2 pl-2 pr-5 md:pr-7">
                        <span className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ${run.final ? STATUS_TONE[run.outcome.status] ?? "bg-[var(--line)] text-[var(--muted)]" : "bg-[var(--accent-soft)] text-[var(--accent)]"}`}>{run.final || run.outcome.status === "completed" ? outcomeLabel(run) : "Running"}</span>
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
