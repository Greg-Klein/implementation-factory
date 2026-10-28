"use client";

import { useLanguage, useTexts } from "./language";
import { CaretRightIcon, CheckCircleIcon, MinusCircleIcon, WarningCircleIcon, XCircleIcon, XIcon } from "@phosphor-icons/react";
import { createContext, useContext, useEffect, useState } from "react";
import { clockTime, type Language } from "@/lib/i18n";
import type { Texts } from "@/lib/i18n/texts";
import { normalizeEvidenceReport, readAcceptanceView } from "@/lib/evidence";
import { acceptanceUrl, artifactUrl, CONFIDENCE_MAXIMUM, confidenceChip, confidenceReasonLine, evidenceCaptures } from "@/lib/run-state";
import type {
  AcceptanceCheckView, AcceptanceCriterionView, AcceptanceQaView, AcceptanceStatus, AcceptanceView, ArtifactResponse,
  EvidenceItem, EvidenceReport, EvidenceVerdict, EvidenceView, ReviewConfidence, RunState,
} from "@/lib/types";

const SOURCES = [
  { file: "dev-evidence.json", title: "sectionBrowser" },
  { file: "qa-evidence.json", title: "sectionTests" },
  { file: "design-evidence.json", title: "sectionDesign" },
] as const;

type EvidenceTexts = Texts["evidence"];
type StringKeys = { [K in keyof EvidenceTexts]: EvidenceTexts[K] extends string ? K : never }[keyof EvidenceTexts];
type Style = { label: StringKeys; className: string; icon: typeof CheckCircleIcon };

const VERDICT_STYLE: Record<EvidenceVerdict, Style> = {
  pass: { label: "verdictPass", className: "bg-emerald-50 text-emerald-700", icon: CheckCircleIcon },
  measured: { label: "verdictMeasured", className: "bg-emerald-50 text-emerald-700", icon: CheckCircleIcon },
  confirmed: { label: "verdictConfirmed", className: "bg-emerald-50 text-emerald-700", icon: CheckCircleIcon },
  fail: { label: "verdictFail", className: "bg-red-50 text-red-700", icon: XCircleIcon },
  not_run: { label: "verdictNotRun", className: "bg-[var(--paper)] text-[var(--muted)]", icon: MinusCircleIcon },
  unverified: { label: "verdictUnverified", className: "bg-amber-50 text-amber-700", icon: WarningCircleIcon },
};

/** Green moves forward, amber waits on someone, red broke; an unverified criterion is neutral, never green. */
const STATUS_STYLE: Record<AcceptanceStatus, Style> = {
  verified: { label: "statusVerified", className: "bg-emerald-50 text-emerald-700", icon: CheckCircleIcon },
  failed: { label: "statusFailed", className: "bg-red-50 text-red-700", icon: XCircleIcon },
  blocked: { label: "statusBlocked", className: "bg-amber-50 text-amber-800", icon: WarningCircleIcon },
  unverified: { label: "statusUnverified", className: "bg-[var(--line)] text-[var(--ink)]", icon: MinusCircleIcon },
};

/**
 * A break attempt is read the other way round: passing means it found nothing,
 * which proves nothing, so it is never drawn in green.
 */
const ATTEMPT_STYLE: Record<string, Style> = {
  pass: { label: "attemptNoDefect", className: "bg-[var(--paper)] text-[var(--muted)]", icon: MinusCircleIcon },
  fail: { label: "attemptDefect", className: "bg-red-50 text-red-700", icon: XCircleIcon },
  unverified: { label: "attemptReadNotRun", className: "bg-[var(--paper)] text-[var(--muted)]", icon: MinusCircleIcon },
  not_run: { label: "verdictNotRun", className: "bg-[var(--paper)] text-[var(--muted)]", icon: MinusCircleIcon },
};

/** The verdict a QA report declares. An inconclusive review is neutral: nothing broke, nothing was approved. */
const QA_STATUS_STYLE: Record<string, Style> = {
  PASS: { label: "qaPassed", className: "bg-emerald-50 text-emerald-700", icon: CheckCircleIcon },
  PASS_WITH_WARNINGS: { label: "qaPassedWithWarnings", className: "bg-amber-50 text-amber-800", icon: WarningCircleIcon },
  INCONCLUSIVE: { label: "qaInconclusive", className: "bg-[var(--line)] text-[var(--ink)]", icon: MinusCircleIcon },
  FAIL: { label: "qaFailed", className: "bg-red-50 text-red-700", icon: XCircleIcon },
};

const SOURCE_LABEL: Record<EvidenceView["source"], StringKeys> = { qa: "sourceQa", design: "sourceDesign", developer: "sourceDeveloper" };
const METHOD_LABEL: Record<string, StringKeys> = { test: "methodTest", browser: "methodBrowser", static_analysis: "methodStaticAnalysis", manual: "methodManual" };
const IMAGE = /\.(?:png|jpe?g)$/i;
const VIDEO = /\.(?:webm|mp4)$/i;

/** Whether the run on screen is read back from its archive, whose documents have routes of their own. */
const ArchivedRun = createContext(false);

async function fetchArtifact(runId: string, path: string, archived: boolean, failure: string): Promise<ArtifactResponse> {
  const response = await fetch(artifactUrl({ id: runId, archived }, path));
  const result = await response.json() as ArtifactResponse;
  if (!response.ok) throw new Error(result.error ?? failure);
  return result;
}

function clock(language: Language, value: string | undefined) {
  return (value && clockTime(language, value)) || undefined;
}

function Lightbox({ image, label, onClose }: { image: string; label: string; onClose: () => void }) {
  const t = useTexts().evidence;
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-50 grid place-items-center bg-[#17201bb8] p-6 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <img src={image} alt={label} className="max-h-[92vh] max-w-[94vw] rounded-5 border border-white/15 shadow-[0_32px_90px_-28px_rgba(0,0,0,.6)]" />
      <button type="button" onClick={onClose} aria-label={t.close} className="absolute right-6 top-6 grid size-8 place-items-center rounded-full border border-white/20 bg-[var(--raised)]/90 transition hover:bg-[var(--raised)] active:scale-95"><XIcon size={14} /></button>
    </div>
  );
}

/**
 * The image is read through the artifacts API and only exists here as a data
 * URL, which browsers refuse to open as a top-level document: opening it in a
 * tab shows the base64 payload instead of the capture, so it is enlarged in
 * place. `path` is what is fetched (an archived version for criterion
 * evidence), `label` what the producer called it.
 */
function Screenshot({ runId, path, label = path }: { runId: string; path: string; label?: string }) {
  const [image, setImage] = useState<string>();
  const [enlarged, setEnlarged] = useState(false);
  const archived = useContext(ArchivedRun);
  const t = useTexts().evidence;
  useEffect(() => {
    let cancelled = false;
    fetchArtifact(runId, path, archived, t.loadFailed)
      .then((result) => { if (!cancelled && result.encoding === "base64" && result.contentType) setImage(`data:${result.contentType};base64,${result.content}`); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [runId, path, archived, t.loadFailed]);
  if (!image) return null;
  return (
    <>
      <button type="button" onClick={() => setEnlarged(true)} aria-label={t.enlargeScreenshot(label)} className="mt-1.5 block rounded-md transition hover:opacity-90 active:scale-[.99]">
        <img src={image} alt="" className="max-h-32 rounded-md border border-[var(--line)]" />
      </button>
      {enlarged && <Lightbox image={image} label={label} onClose={() => setEnlarged(false)} />}
    </>
  );
}

/** Played from the artifacts address itself, which answers a video with its bytes rather than a JSON preview. */
function Video({ runId, path, label = path }: { runId: string; path: string; label?: string }) {
  const archived = useContext(ArchivedRun);
  const t = useTexts().evidence;
  return <video controls preload="metadata" aria-label={t.video(label)} src={artifactUrl({ id: runId, archived }, path)} className="mt-1.5 block max-h-56 max-w-full rounded-md border border-[var(--line)]" />;
}

function Pill({ label, className, icon: Icon }: { label: StringKeys; className: string; icon: typeof CheckCircleIcon }) {
  const t = useTexts().evidence;
  return <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${className}`}><Icon size={11} weight="fill" />{t[label]}</span>;
}

function StatusPill({ status }: { status: AcceptanceStatus }) {
  return <Pill {...STATUS_STYLE[status]} />;
}

/** A status the contract does not know is shown as written, never dressed as one it knows. */
function QaStatus({ status }: { status: string }) {
  const style = QA_STATUS_STYLE[status.trim().toUpperCase()];
  return style ? <Pill {...style} /> : <span className="font-mono text-[10px] font-normal text-[var(--muted)]">{status}</span>;
}

function QaWarning({ qa }: { qa: AcceptanceQaView | undefined }) {
  if (!qa?.warning) return null;
  return <p role="note" data-testid="qa-verdict-warning" className="mt-2 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900"><WarningCircleIcon className="mt-0.5 shrink-0" size={13} weight="fill" />{qa.warning}</p>;
}

function Tag({ children, tone = "neutral" }: { children: string; tone?: "neutral" | "attention" }) {
  return <span className={`rounded-full px-1.5 py-px text-[9px] font-semibold ${tone === "attention" ? "bg-amber-50 text-amber-800" : "bg-[var(--paper)] text-[var(--muted)]"}`}>{children}</span>;
}

/** The labels that say how far a piece of evidence can be trusted, only when they apply. */
function qualifiers(view: EvidenceView, t: Texts["evidence"]) {
  return [
    view.kind === "attempt" ? { text: t.breakAttempt, tone: "neutral" as const } : undefined,
    view.freshness === "stale" ? { text: t.staleEvidence, tone: "attention" as const } : undefined,
    view.freshness === "unknown" ? { text: t.unknownVersion, tone: "attention" as const } : undefined,
    view.freshness === "inconclusive" ? { text: t.inconclusiveMeasurement, tone: "attention" as const } : undefined,
    view.basis === "reported" ? { text: t.reportedResult, tone: "neutral" as const } : undefined,
    view.basis === "confirmation" ? { text: t.confirmation, tone: "neutral" as const } : undefined,
  ].filter((entry) => entry !== undefined);
}

function EvidenceCard({ runId, view }: { runId: string; view: EvidenceView }) {
  const language = useLanguage();
  const t = useTexts().evidence;
  const verdict = (view.kind === "attempt" ? ATTEMPT_STYLE[view.verdict] : undefined) ?? VERDICT_STYLE[view.verdict as EvidenceVerdict] ?? VERDICT_STYLE.unverified;
  const meta = [
    t[SOURCE_LABEL[view.source]], view.producer?.role, view.id, view.method ? METHOD_LABEL[view.method] ? t[METHOD_LABEL[view.method]!] : view.method : undefined,
    view.round ? t.round(view.round) : undefined, `${view.file} v${view.version}`, clock(language, view.observedAt ?? view.receivedAt),
  ].filter(Boolean).join(" · ");
  return (
    <li className="rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-2.5" data-testid="evidence-item">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-[var(--ink)]">{view.label}</p>
        <Pill {...verdict} />
      </div>
      {qualifiers(view, t).length > 0 && <p className="mt-1 flex flex-wrap gap-1">{qualifiers(view, t).map((entry) => <Tag key={entry.text} tone={entry.tone}>{entry.text}</Tag>)}</p>}
      <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{meta}</p>
      {(view.expected || view.actual) && (
        <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
          {view.expected && <>{t.expected} <span className="text-[var(--ink)]">{view.expected}</span>{view.actual ? " · " : ""}</>}
          {view.actual && <>{t.observed} <span className="text-[var(--ink)]">{view.actual}</span></>}
        </p>
      )}
      {view.command && <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{view.command}</p>}
      {view.note && <p className="mt-1 text-[10px] text-[var(--muted)]">{view.note}</p>}
      {view.blocker && <p className="mt-1 text-[10px] text-amber-800">{t.blocked(view.blocker.reason, view.blocker.action)}</p>}
      {view.confirms && <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{t.confirms(view.confirms)}</p>}
      {view.supersedes.length > 0 && <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{t.replaces(view.supersedes.join(", "))}</p>}
      {view.supersededBy && <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{t.replacedBy(view.supersededBy)}</p>}
      {view.attachments.map((attachment) => attachment.path && IMAGE.test(attachment.source)
        ? <Screenshot key={attachment.source} runId={runId} path={attachment.path} label={attachment.source} />
        : attachment.path && VIDEO.test(attachment.source)
        ? <Video key={attachment.source} runId={runId} path={attachment.path} label={attachment.source} />
        : <p key={attachment.source} className="mt-1 font-mono text-[10px] text-[var(--muted)]">{attachment.source}{attachment.archived ? "" : ` · ${t.notArchivedYet}`}</p>)}
    </li>
  );
}

function Reasons({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return <ul className="mt-1 space-y-0.5">{reasons.map((reason) => <li key={reason} className="text-[11px] leading-relaxed text-[var(--muted)]">{reason}</li>)}</ul>;
}

function CheckBlock({ runId, check, titled }: { runId: string; check: AcceptanceCheckView; titled: boolean }) {
  const t = useTexts().evidence;
  return (
    <div className="mt-3">
      {titled && (
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-medium text-[var(--ink)]"><span className="font-mono text-[var(--muted)]">{check.id}</span> · {check.description}</p>
          <StatusPill status={check.status} />
        </div>
      )}
      {check.status !== "verified" && <Reasons reasons={check.reasons} />}
      {check.evidence.length > 0 && <ul className="mt-2 space-y-2">{check.evidence.map((view) => <EvidenceCard key={view.key} runId={runId} view={view} />)}</ul>}
      {check.history.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-[var(--muted)]">{t.history(check.history.length)}</summary>
          <ul className="mt-2 space-y-2">{check.history.map((view) => <EvidenceCard key={view.key} runId={runId} view={view} />)}</ul>
        </details>
      )}
    </div>
  );
}

function CriterionRow({ runId, criterion }: { runId: string; criterion: AcceptanceCriterionView }) {
  const [open, setOpen] = useState(false);
  const t = useTexts().evidence;
  const single = criterion.checks.length === 1 && criterion.checks[0]?.id === criterion.id;
  return (
    <li className="border-b border-[var(--line)] last:border-b-0" data-testid={`criterion-${criterion.id}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex w-full items-start gap-2.5 py-3 text-left">
        <CaretRightIcon size={12} className={`mt-0.5 shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="w-9 shrink-0 font-mono text-[11px] text-[var(--muted)]">{criterion.id}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-[var(--ink)]">{criterion.text}</span>
          {criterion.tasks.length > 0 && <span className="mt-0.5 block font-mono text-[10px] text-[var(--muted)]">{criterion.tasks.map((task) => task.id).join(" · ")}</span>}
        </span>
        <StatusPill status={criterion.status} />
      </button>
      {open && (
        <div className="pb-4 pl-[3.1rem]">
          {criterion.source && <p className="text-[11px] text-[var(--muted)]">{t.sourceLine} {criterion.source.kind}{criterion.source.excerpt ? ` · "${criterion.source.excerpt}"` : ""}</p>}
          {criterion.expected && <p className="mt-1 text-[11px] text-[var(--muted)]">{t.expectedLine} <span className="text-[var(--ink)]">{criterion.expected}</span></p>}
          {criterion.tasks.length > 0 && <p className="mt-1 text-[11px] text-[var(--muted)]">{t.tasksLine} {criterion.tasks.map((task) => `${task.id} ${task.title}`).join(", ")}</p>}
          <Reasons reasons={criterion.reasons} />
          {criterion.checks.map((check) => <CheckBlock key={check.id} runId={runId} check={check} titled={!single} />)}
          {criterion.unassigned.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] text-[var(--muted)]">{t.unassignedNote}</p>
              <ul className="mt-2 space-y-2">{criterion.unassigned.map((view) => <EvidenceCard key={view.key} runId={runId} view={view} />)}</ul>
            </div>
          )}
          {(criterion.attempts ?? []).length > 0 && (
            <div className="mt-3" data-testid={`attempts-${criterion.id}`}>
              <p className="text-[11px] text-[var(--muted)]">{t.attemptsNote}</p>
              <ul className="mt-2 space-y-2">{criterion.attempts.map((view) => <EvidenceCard key={view.key} runId={runId} view={view} />)}</ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Row({ runId, item }: { runId: string; item: EvidenceItem }) {
  const t = useTexts().evidence;
  const attempt = item.kind === "attempt";
  const style = (attempt ? ATTEMPT_STYLE[item.verdict] : undefined) ?? VERDICT_STYLE[item.verdict] ?? VERDICT_STYLE.unverified;
  return (
    <li className="border-b border-[var(--line)] py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-[var(--ink)]">{item.label}</p>
        <Pill {...style} />
      </div>
      {attempt && <p className="mt-1"><Tag>{t.breakAttempt}</Tag></p>}
      {(item.expected || item.actual) && (
        <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
          {item.expected && <>{t.expected} <span className="text-[var(--ink)]">{item.expected}</span>{item.actual ? " · " : ""}</>}
          {item.actual && <>{t.measured} <span className="text-[var(--ink)]">{item.actual}</span></>}
        </p>
      )}
      {item.command && <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{item.command}</p>}
      {item.note && <p className="mt-1 text-[10px] text-[var(--muted)]">{item.note}</p>}
      {evidenceCaptures(item).filter((capture) => IMAGE.test(capture)).map((capture) => <Screenshot key={capture} runId={runId} path={capture} />)}
      {evidenceCaptures(item).filter((capture) => VIDEO.test(capture)).map((capture) => <Video key={capture} runId={runId} path={capture} />)}
    </li>
  );
}

/** One report as the workflow last wrote it, the view this tab had before criteria existed. */
function Section({ title, file, run, qa }: { title: string; file: string; run: RunState; qa?: AcceptanceQaView | undefined }) {
  const [report, setReport] = useState<EvidenceReport>();
  const [error, setError] = useState<string>();
  const present = run.artifacts.includes(file);
  const archived = Boolean(run.archived);
  const t = useTexts().evidence;

  useEffect(() => {
    if (!present) { setReport(undefined); setError(undefined); return; }
    let cancelled = false;
    fetchArtifact(run.id ?? "", file, archived, t.loadFailed)
      .then((result) => { if (cancelled) return; try { setReport(normalizeEvidenceReport(JSON.parse(result.content) as unknown)); } catch { setError(t.unreadableDocument); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : t.genericError); });
    return () => { cancelled = true; };
    // evidenceUpdatedAt is what tells a rewrite: a later review round overwrites
    // the same file, so nothing else in the state moves and the tab would keep
    // showing the findings of the first round.
  }, [file, present, run.id, run.evidenceUpdatedAt, archived, t]);

  return (
    <section className="mb-6 last:mb-0">
      <h3 className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--ink)]">
        {title}
        {report?.status && <QaStatus status={report.status} />}
      </h3>
      {report?.status && qa?.file === file && <div className="mb-2"><QaWarning qa={qa} /></div>}
      {!present ? <p className="text-[11px] text-[var(--muted)]">{t.noEvidence}</p>
        : error ? <p className="text-[11px] text-red-700">{error}</p>
        : !report ? <p className="text-[11px] text-[var(--muted)]">{t.loading}</p>
        : report.items.length === 0 ? <p className="text-[11px] text-[var(--muted)]">{t.noItem}</p>
        : <ul>{report.items.map((item, index) => <Row key={index} runId={run.id ?? ""} item={item} />)}</ul>}
    </section>
  );
}

/** The reason the server gives with a refusal, when it gives one. */
function refusal(body: unknown) {
  const reason = body !== null && typeof body === "object" && "error" in body ? body.error : undefined;
  return typeof reason === "string" ? reason : undefined;
}

function useAcceptance(run: RunState) {
  const [view, setView] = useState<AcceptanceView>();
  const [error, setError] = useState<string>();
  const unavailable = useTexts().evidence.coverageUnavailable;
  useEffect(() => {
    if (!run.id) return;
    let cancelled = false;
    fetch(acceptanceUrl(run))
      .then(async (response) => {
        const body = await response.json() as unknown;
        if (cancelled) return;
        const coverage = response.ok ? readAcceptanceView(body) : undefined;
        if (!coverage) { setError(refusal(body) ?? unavailable); return; }
        setError(undefined);
        setView(coverage);
      })
      .catch(() => { if (!cancelled) setError(unavailable); });
    return () => { cancelled = true; };
  }, [run.id, run.archived, run.acceptance?.revision, run.evidenceUpdatedAt, unavailable]);
  return { view, error };
}

const CONFIDENCE_TONE = { error: "text-red-700", attention: "text-amber-800", verified: "text-[var(--accent)]", neutral: "text-[var(--ink)]" } as const;

/** The note the console gives the automated review, and each observation that lowered it. */
function Confidence({ confidence }: { confidence: ReviewConfidence }) {
  const language = useLanguage();
  const chip = confidenceChip(confidence.score, language)!;
  const t = useTexts().evidence;
  return (
    <div className="mb-5" data-testid="review-confidence">
      <p className="text-[10px] uppercase tracking-[.16em] text-[var(--muted)]">{t.reviewConfidence}</p>
      <p role="status" aria-live="polite" aria-label={chip.title} className={`mt-1 font-mono text-sm font-semibold ${CONFIDENCE_TONE[chip.tone]}`} data-testid="review-confidence-score">{chip.label}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">{t.confidenceHelp(CONFIDENCE_MAXIMUM)}</p>
      {confidence.reasons.length > 0
        ? <ul className="mt-2 space-y-0.5" data-testid="review-confidence-reasons">{confidence.reasons.map((reason) => <li key={reason.rule} className="text-[11px] leading-relaxed text-[var(--ink)]">{confidenceReasonLine(reason, language)}</li>)}</ul>
        : <p className="mt-2 text-[11px] text-[var(--muted)]">{t.confidenceNothing}</p>}
    </div>
  );
}

function Summary({ view, notes }: { view: AcceptanceView; notes: string[] }) {
  const language = useLanguage();
  const t = useTexts().evidence;
  const errors = view.diagnostics.filter((diagnostic) => diagnostic.level === "error");
  const details = [
    view.currentSnapshot ? t.currentCode(view.currentSnapshot.id) : t.currentCodeUnknown,
    t.updatedAt(clock(language, view.updatedAt) ?? "?"),
    view.counts.stale ? t.staleCount(view.counts.stale) : "",
  ].filter(Boolean).join(" · ");
  return (
    <div className="mb-5">
      <p className="text-[10px] uppercase tracking-[.16em] text-[var(--muted)]">{t.acceptanceCriteria}</p>
      <p role="status" aria-live="polite" className="mt-1 text-sm font-medium text-[var(--ink)]" data-testid="acceptance-sentence">{view.sentence}</p>
      <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{details}</p>
      {view.qa && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]" data-testid="qa-verdict">
          {t.qaVerdict}{view.qa.round ? ` · ${t.round(view.qa.round)}` : ""}{view.qa.mandate ? ` · ${t.mandate(view.qa.mandate)}` : ""}
          <QaStatus status={view.qa.status} />
        </p>
      )}
      <QaWarning qa={view.qa} />
      {notes.length > 0 && <ul className="mt-2 space-y-0.5" data-testid="review-notes">{notes.map((note) => <li key={note} className="text-[11px] leading-relaxed text-[var(--muted)]">{note}</li>)}</ul>}
      {errors.length > 0 && (
        <details className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-medium text-amber-900">
            {t.traceabilityIssues(errors.length)}
          </summary>
          <ul className="mt-2 space-y-1">{errors.map((diagnostic, index) => <li key={index} className="text-[11px] leading-relaxed text-[var(--ink)]">{diagnostic.file && <span className="font-mono text-[10px] text-[var(--muted)]">{diagnostic.file} · </span>}{diagnostic.message}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

export function EvidencePanel({ run }: { run: RunState }) {
  const language = useLanguage();
  const t = useTexts().evidence;
  const runId = run.id ?? "";
  const { view, error } = useAcceptance(run);
  const inProgress = run.status === "starting" || run.status === "running" || run.status === "attention";
  const traced = Boolean(view?.available);
  const archivedReports = view?.reports ?? [];

  return (
    <ArchivedRun.Provider value={Boolean(run.archived)}>
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-[var(--raised)] p-5">
      <section aria-label={t.criteriaCoverage} className="mb-6">
        {error && <p role="alert" className="mb-3 text-[11px] text-red-700">{error}</p>}
        {run.confidence && <Confidence confidence={run.confidence} />}
        {view && traced && <Summary view={view} notes={run.reviewNotes ?? []} />}
        {view && traced && view.criteria.length > 0 && <ul>{view.criteria.map((criterion) => <CriterionRow key={criterion.id} runId={runId} criterion={criterion} />)}</ul>}
        {view && !traced && (
          <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5">
            <p className="text-xs font-medium text-[var(--ink)]">{inProgress && !run.acceptance ? t.criteriaPending : t.traceabilityUnavailable}</p>
            {!inProgress && <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">{t.noRegistry}</p>}
            {view.criteria.length > 0 && (
              <ul className="mt-2 space-y-1">{view.criteria.map((criterion) => <li key={criterion.id} className="text-[11px] text-[var(--muted)]"><span className="font-mono">{criterion.id}</span> · {criterion.text} · {t.rebuilt}</li>)}</ul>
            )}
            {(run.reviewNotes ?? []).length > 0 && <ul className="mt-2 space-y-0.5" data-testid="review-notes">{(run.reviewNotes ?? []).map((note) => <li key={note} className="text-[11px] leading-relaxed text-[var(--muted)]">{note}</li>)}</ul>}
          </div>
        )}
      </section>

      {view && view.general.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 text-xs font-semibold text-[var(--ink)]">{t.generalChecks}</h3>
          <ul className="space-y-2">{view.general.map((entry) => <EvidenceCard key={entry.key} runId={runId} view={entry} />)}</ul>
          {view.generalHistory.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-[var(--muted)]">{t.previousRounds(view.generalHistory.length)}</summary>
              <ul className="mt-2 space-y-2">{view.generalHistory.map((entry) => <EvidenceCard key={entry.key} runId={runId} view={entry} />)}</ul>
            </details>
          )}
        </section>
      )}

      <details open={!traced} className="border-t border-[var(--line)] pt-4">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--ink)]">{t.reportsBySource}</summary>
        <div className="mt-3">
          {SOURCES.map(({ file, title }) => <Section key={file} title={t[title]} file={file} run={run} qa={view?.qa} />)}
          {archivedReports.length > 0 && (
            <section className="mt-4">
              <h3 className="mb-2 text-xs font-semibold text-[var(--ink)]">{t.archivedVersions}</h3>
              <ul className="space-y-0.5">{archivedReports.map((report) => (
                <li key={`${report.file}@${report.version}`} className="font-mono text-[10px] text-[var(--muted)]">
                  {report.file} v{report.version} · {t.items(report.items)} · {clock(language, report.receivedAt)}{report.current ? ` · ${t.current}` : ""}
                </li>
              ))}</ul>
            </section>
          )}
        </div>
      </details>
    </div>
    </ArchivedRun.Provider>
  );
}
