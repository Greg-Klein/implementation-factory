"use client";

import { CaretRightIcon, CheckCircleIcon, MinusCircleIcon, WarningCircleIcon, XCircleIcon, XIcon } from "@phosphor-icons/react";
import { createContext, useContext, useEffect, useState } from "react";
import { acceptanceUrl, artifactUrl } from "@/lib/run-state";
import type {
  AcceptanceCheckView, AcceptanceCriterionView, AcceptanceStatus, AcceptanceView, ArtifactResponse,
  EvidenceItem, EvidenceReport, EvidenceVerdict, EvidenceView, RunState,
} from "@/lib/types";

const SOURCES: { file: string; title: string }[] = [
  { file: "dev-evidence.json", title: "Navigateur" },
  { file: "qa-evidence.json", title: "Tests & vérifications" },
  { file: "design-evidence.json", title: "Conformité au design" },
];

const VERDICT_STYLE: Record<EvidenceVerdict, { label: string; className: string; icon: typeof CheckCircleIcon }> = {
  pass: { label: "Passe", className: "bg-emerald-50 text-emerald-700", icon: CheckCircleIcon },
  measured: { label: "Mesuré", className: "bg-emerald-50 text-emerald-700", icon: CheckCircleIcon },
  confirmed: { label: "Confirmé", className: "bg-emerald-50 text-emerald-700", icon: CheckCircleIcon },
  fail: { label: "Échec", className: "bg-red-50 text-red-700", icon: XCircleIcon },
  not_run: { label: "Non exécuté", className: "bg-[var(--paper)] text-[var(--muted)]", icon: MinusCircleIcon },
  unverified: { label: "Non vérifié", className: "bg-amber-50 text-amber-700", icon: WarningCircleIcon },
};

/** Green moves forward, amber waits on someone, red broke; an unverified criterion is neutral, never green. */
const STATUS_STYLE: Record<AcceptanceStatus, { label: string; className: string; icon: typeof CheckCircleIcon }> = {
  verified: { label: "Vérifié", className: "bg-emerald-50 text-emerald-700", icon: CheckCircleIcon },
  failed: { label: "Échec", className: "bg-red-50 text-red-700", icon: XCircleIcon },
  blocked: { label: "Bloqué", className: "bg-amber-50 text-amber-800", icon: WarningCircleIcon },
  unverified: { label: "Non vérifié", className: "bg-[var(--line)] text-[var(--ink)]", icon: MinusCircleIcon },
};

const SOURCE_LABEL: Record<EvidenceView["source"], string> = { qa: "QA", design: "Design", developer: "Développeur" };
const METHOD_LABEL: Record<string, string> = { test: "test", browser: "navigateur", static_analysis: "analyse statique", manual: "manuel" };
const IMAGE = /\.(?:png|jpe?g)$/i;

/** Whether the run on screen is read back from its archive, whose documents have routes of their own. */
const ArchivedRun = createContext(false);

async function fetchArtifact(runId: string, path: string, archived: boolean): Promise<ArtifactResponse> {
  const response = await fetch(artifactUrl({ id: runId, archived }, path));
  const result = await response.json() as ArtifactResponse;
  if (!response.ok) throw new Error(result.error ?? "Impossible de charger ce document.");
  return result;
}

function clock(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function Lightbox({ image, label, onClose }: { image: string; label: string; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-50 grid place-items-center bg-[#17201bb8] p-6 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <img src={image} alt={label} className="max-h-[92vh] max-w-[94vw] rounded-5 border border-white/15 shadow-[0_32px_90px_-28px_rgba(0,0,0,.6)]" />
      <button type="button" onClick={onClose} aria-label="Fermer" className="absolute right-6 top-6 grid size-8 place-items-center rounded-full border border-white/20 bg-white/90 transition hover:bg-white active:scale-95"><XIcon size={14} /></button>
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
  useEffect(() => {
    let cancelled = false;
    fetchArtifact(runId, path, archived)
      .then((result) => { if (!cancelled && result.encoding === "base64" && result.contentType) setImage(`data:${result.contentType};base64,${result.content}`); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [runId, path, archived]);
  if (!image) return null;
  return (
    <>
      <button type="button" onClick={() => setEnlarged(true)} aria-label={`Agrandir la capture ${label}`} className="mt-1.5 block rounded-md transition hover:opacity-90 active:scale-[.99]">
        <img src={image} alt="" className="max-h-32 rounded-md border border-[var(--line)]" />
      </button>
      {enlarged && <Lightbox image={image} label={label} onClose={() => setEnlarged(false)} />}
    </>
  );
}

function Pill({ label, className, icon: Icon }: { label: string; className: string; icon: typeof CheckCircleIcon }) {
  return <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${className}`}><Icon size={11} weight="fill" />{label}</span>;
}

function StatusPill({ status }: { status: AcceptanceStatus }) {
  return <Pill {...STATUS_STYLE[status]} />;
}

function Tag({ children, tone = "neutral" }: { children: string; tone?: "neutral" | "attention" }) {
  return <span className={`rounded-full px-1.5 py-px text-[9px] font-semibold ${tone === "attention" ? "bg-amber-50 text-amber-800" : "bg-[var(--paper)] text-[var(--muted)]"}`}>{children}</span>;
}

/** The labels that say how far a piece of evidence can be trusted, only when they apply. */
function qualifiers(view: EvidenceView) {
  return [
    view.freshness === "stale" ? { text: "Preuve ancienne", tone: "attention" as const } : undefined,
    view.freshness === "unknown" ? { text: "Version inconnue", tone: "attention" as const } : undefined,
    view.freshness === "inconclusive" ? { text: "Mesure non concluante", tone: "attention" as const } : undefined,
    view.basis === "reported" ? { text: "Résultat rapporté", tone: "neutral" as const } : undefined,
    view.basis === "confirmation" ? { text: "Confirmation", tone: "neutral" as const } : undefined,
  ].filter((entry) => entry !== undefined);
}

function EvidenceCard({ runId, view }: { runId: string; view: EvidenceView }) {
  const verdict = VERDICT_STYLE[view.verdict as EvidenceVerdict] ?? VERDICT_STYLE.unverified;
  const meta = [
    SOURCE_LABEL[view.source], view.producer?.role, view.id, view.method ? METHOD_LABEL[view.method] : undefined,
    view.round ? `tour ${view.round}` : undefined, `${view.file} v${view.version}`, clock(view.observedAt ?? view.receivedAt),
  ].filter(Boolean).join(" · ");
  return (
    <li className="rounded-lg border border-[var(--line)] bg-white px-3 py-2.5" data-testid="evidence-item">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-[var(--ink)]">{view.label}</p>
        <Pill {...verdict} />
      </div>
      {qualifiers(view).length > 0 && <p className="mt-1 flex flex-wrap gap-1">{qualifiers(view).map((entry) => <Tag key={entry.text} tone={entry.tone}>{entry.text}</Tag>)}</p>}
      <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{meta}</p>
      {(view.expected || view.actual) && (
        <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
          {view.expected && <>attendu <span className="text-[var(--ink)]">{view.expected}</span>{view.actual ? " · " : ""}</>}
          {view.actual && <>observé <span className="text-[var(--ink)]">{view.actual}</span></>}
        </p>
      )}
      {view.command && <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{view.command}</p>}
      {view.note && <p className="mt-1 text-[10px] text-[var(--muted)]">{view.note}</p>}
      {view.blocker && <p className="mt-1 text-[10px] text-amber-800">Bloqué : {view.blocker.reason}{view.blocker.action ? ` Action nécessaire : ${view.blocker.action}` : ""}</p>}
      {view.confirms && <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">confirme {view.confirms}</p>}
      {view.supersedes.length > 0 && <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">remplace {view.supersedes.join(", ")}</p>}
      {view.supersededBy && <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">remplacée par {view.supersededBy}</p>}
      {view.attachments.map((attachment) => attachment.path && IMAGE.test(attachment.source)
        ? <Screenshot key={attachment.source} runId={runId} path={attachment.path} label={attachment.source} />
        : <p key={attachment.source} className="mt-1 font-mono text-[10px] text-[var(--muted)]">{attachment.source}{attachment.archived ? "" : " · pas encore archivée"}</p>)}
    </li>
  );
}

function Reasons({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return <ul className="mt-1 space-y-0.5">{reasons.map((reason) => <li key={reason} className="text-[11px] leading-relaxed text-[var(--muted)]">{reason}</li>)}</ul>;
}

function CheckBlock({ runId, check, titled }: { runId: string; check: AcceptanceCheckView; titled: boolean }) {
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
          <summary className="cursor-pointer text-[11px] text-[var(--muted)]">Historique ({check.history.length})</summary>
          <ul className="mt-2 space-y-2">{check.history.map((view) => <EvidenceCard key={view.key} runId={runId} view={view} />)}</ul>
        </details>
      )}
    </div>
  );
}

function CriterionRow({ runId, criterion }: { runId: string; criterion: AcceptanceCriterionView }) {
  const [open, setOpen] = useState(false);
  const single = criterion.checks.length === 1 && criterion.checks[0].id === criterion.id;
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
          {criterion.source && <p className="text-[11px] text-[var(--muted)]">Source : {criterion.source.kind}{criterion.source.excerpt ? ` · « ${criterion.source.excerpt} »` : ""}</p>}
          {criterion.expected && <p className="mt-1 text-[11px] text-[var(--muted)]">Attendu : <span className="text-[var(--ink)]">{criterion.expected}</span></p>}
          {criterion.tasks.length > 0 && <p className="mt-1 text-[11px] text-[var(--muted)]">Tâches : {criterion.tasks.map((task) => `${task.id} ${task.title}`).join(", ")}</p>}
          <Reasons reasons={criterion.reasons} />
          {criterion.checks.map((check) => <CheckBlock key={check.id} runId={runId} check={check} titled={!single} />)}
          {criterion.unassigned.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] text-[var(--muted)]">Preuves qui citent le critère sans dire quel contrôle elles couvrent, affichées sans être comptées :</p>
              <ul className="mt-2 space-y-2">{criterion.unassigned.map((view) => <EvidenceCard key={view.key} runId={runId} view={view} />)}</ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Row({ runId, item }: { runId: string; item: EvidenceItem }) {
  const style = VERDICT_STYLE[item.verdict] ?? VERDICT_STYLE.unverified;
  return (
    <li className="border-b border-[var(--line)] py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-[var(--ink)]">{item.label}</p>
        <Pill {...style} />
      </div>
      {(item.expected || item.actual) && (
        <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
          {item.expected && <>attendu <span className="text-[var(--ink)]">{item.expected}</span>{item.actual ? " · " : ""}</>}
          {item.actual && <>mesuré <span className="text-[var(--ink)]">{item.actual}</span></>}
        </p>
      )}
      {item.command && <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{item.command}</p>}
      {item.note && <p className="mt-1 text-[10px] text-[var(--muted)]">{item.note}</p>}
      {item.screenshot && <Screenshot runId={runId} path={item.screenshot} />}
    </li>
  );
}

/** One report as the workflow last wrote it, the view this tab had before criteria existed. */
function Section({ title, file, run }: { title: string; file: string; run: RunState }) {
  const [report, setReport] = useState<EvidenceReport>();
  const [error, setError] = useState<string>();
  const present = run.artifacts.includes(file);
  const archived = Boolean(run.archived);

  useEffect(() => {
    if (!present) { setReport(undefined); setError(undefined); return; }
    let cancelled = false;
    fetchArtifact(run.id ?? "", file, archived)
      .then((result) => { if (cancelled) return; try { setReport(JSON.parse(result.content) as EvidenceReport); } catch { setError("Document illisible."); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Erreur."); });
    return () => { cancelled = true; };
    // evidenceUpdatedAt is what tells a rewrite: a later review round overwrites
    // the same file, so nothing else in the state moves and the tab would keep
    // showing the findings of the first round.
  }, [file, present, run.id, run.evidenceUpdatedAt, archived]);

  return (
    <section className="mb-6 last:mb-0">
      <h3 className="mb-2 text-xs font-semibold text-[var(--ink)]">
        {title}
        {report?.status && <span className="ml-2 font-mono text-[10px] font-normal text-[var(--muted)]">{report.status}</span>}
      </h3>
      {!present ? <p className="text-[11px] text-[var(--muted)]">Aucune preuve écrite pour ce run.</p>
        : error ? <p className="text-[11px] text-red-700">{error}</p>
        : !report ? <p className="text-[11px] text-[var(--muted)]">Chargement…</p>
        : !Array.isArray(report.items) || report.items.length === 0 ? <p className="text-[11px] text-[var(--muted)]">Aucun élément rapporté.</p>
        : <ul>{report.items.map((item, index) => <Row key={index} runId={run.id ?? ""} item={item} />)}</ul>}
    </section>
  );
}

function useAcceptance(run: RunState) {
  const [view, setView] = useState<AcceptanceView>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!run.id) return;
    let cancelled = false;
    fetch(acceptanceUrl(run))
      .then(async (response) => {
        const body = await response.json() as AcceptanceView & { error?: string };
        if (cancelled) return;
        if (!response.ok) { setError(body.error ?? "Couverture indisponible."); return; }
        setError(undefined);
        setView(body);
      })
      .catch(() => { if (!cancelled) setError("Couverture indisponible."); });
    return () => { cancelled = true; };
  }, [run.id, run.archived, run.acceptance?.revision, run.evidenceUpdatedAt]);
  return { view, error };
}

function Summary({ view }: { view: AcceptanceView }) {
  const errors = view.diagnostics.filter((diagnostic) => diagnostic.level === "error");
  const details = [
    view.currentSnapshot ? `code actuel ${view.currentSnapshot.id}` : "code actuel non identifié",
    `mis à jour à ${clock(view.updatedAt) ?? "?"}`,
    view.counts.stale ? `${view.counts.stale} ${view.counts.stale > 1 ? "preuves anciennes" : "preuve ancienne"}` : "",
  ].filter(Boolean).join(" · ");
  return (
    <div className="mb-5">
      <p className="text-[10px] uppercase tracking-[.16em] text-[var(--muted)]">Critères d’acceptation</p>
      <p role="status" aria-live="polite" className="mt-1 text-sm font-medium text-[var(--ink)]" data-testid="acceptance-sentence">{view.sentence}</p>
      <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{details}</p>
      {errors.length > 0 && (
        <details className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-medium text-amber-900">
            {`${errors.length} ${errors.length > 1 ? "anomalies" : "anomalie"} de traçabilité`}
          </summary>
          <ul className="mt-2 space-y-1">{errors.map((diagnostic, index) => <li key={index} className="text-[11px] leading-relaxed text-[var(--ink)]">{diagnostic.file && <span className="font-mono text-[10px] text-[var(--muted)]">{diagnostic.file} · </span>}{diagnostic.message}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

export function EvidencePanel({ run }: { run: RunState }) {
  const runId = run.id ?? "";
  const { view, error } = useAcceptance(run);
  const inProgress = run.status === "starting" || run.status === "running" || run.status === "attention";
  const traced = Boolean(view?.available);
  const archivedReports = view?.reports ?? [];

  return (
    <ArchivedRun.Provider value={Boolean(run.archived)}>
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-white p-5">
      <section aria-label="Couverture des critères" className="mb-6">
        {error && <p role="alert" className="mb-3 text-[11px] text-red-700">{error}</p>}
        {view && traced && <Summary view={view} />}
        {view && traced && view.criteria.length > 0 && <ul>{view.criteria.map((criterion) => <CriterionRow key={criterion.id} runId={runId} criterion={criterion} />)}</ul>}
        {view && !traced && (
          <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5">
            <p className="text-xs font-medium text-[var(--ink)]">{inProgress && !run.acceptance ? "Les critères d’acceptation apparaîtront ici dès que le workflow les aura écrits." : "Traçabilité par critère indisponible pour ce run."}</p>
            {!inProgress && <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">Le workflow n’a pas écrit de registre de critères. Les rapports restent lisibles ci-dessous, sans qu’aucun critère soit présenté comme vérifié.</p>}
            {view.criteria.length > 0 && (
              <ul className="mt-2 space-y-1">{view.criteria.map((criterion) => <li key={criterion.id} className="text-[11px] text-[var(--muted)]"><span className="font-mono">{criterion.id}</span> · {criterion.text} · reconstruit depuis le plan, non vérifié</li>)}</ul>
            )}
          </div>
        )}
      </section>

      {view && view.general.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 text-xs font-semibold text-[var(--ink)]">Vérifications générales</h3>
          <ul className="space-y-2">{view.general.map((entry) => <EvidenceCard key={entry.key} runId={runId} view={entry} />)}</ul>
          {view.generalHistory.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-[var(--muted)]">Tours précédents ({view.generalHistory.length})</summary>
              <ul className="mt-2 space-y-2">{view.generalHistory.map((entry) => <EvidenceCard key={entry.key} runId={runId} view={entry} />)}</ul>
            </details>
          )}
        </section>
      )}

      <details open={!traced} className="border-t border-[var(--line)] pt-4">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--ink)]">Rapports par source</summary>
        <div className="mt-3">
          {SOURCES.map(({ file, title }) => <Section key={file} title={title} file={file} run={run} />)}
          {archivedReports.length > 0 && (
            <section className="mt-4">
              <h3 className="mb-2 text-xs font-semibold text-[var(--ink)]">Versions archivées</h3>
              <ul className="space-y-0.5">{archivedReports.map((report) => (
                <li key={`${report.file}@${report.version}`} className="font-mono text-[10px] text-[var(--muted)]">
                  {report.file} v{report.version} · {report.items} {report.items > 1 ? "éléments" : "élément"} · {clock(report.receivedAt)}{report.current ? " · actuelle" : ""}
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
