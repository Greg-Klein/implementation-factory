import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  deriveAcceptanceCoverage, MAX_REPORT_BYTES, parseCriteriaRegistry, parseEvidenceReport, parsePlanLinks, sourceOfReport,
  type CriteriaRegistry, type EvidenceRecord, type PlanLinks,
} from "./acceptance.js";
import { isEvidenceReport } from "./domain.js";
import type { AcceptanceDiagnostic, AcceptanceReportVersion, AcceptanceView } from "./types.js";

/**
 * Every useful revision of the documents acceptance coverage is computed from,
 * kept under an immutable path with its hash and the time it arrived. The
 * workflow rewrites `qa-evidence.json` on every review round and deletes its
 * whole task directory at the end: without this archive a second round erases
 * the failure of the first, and the end of the run erases everything.
 *
 * Idempotent: the same bytes seen twice (a watcher firing twice, a rescan) add
 * nothing. A file caught half written is recorded as a diagnostic and the last
 * valid version keeps standing; it is never presented as a new result.
 */

export const CRITERIA_FILE = "acceptance-criteria.json";
export const PLAN_FILE = "planner-output.json";
export const SUMMARY_FILES = { markdown: "acceptance-summary.md", json: "acceptance-summary.json" } as const;
export const SYNC_REQUEST_FILE = "archive-sync-request.json";
export const SYNC_ACK_FILE = "archive-sync-ack.json";

export type AcceptanceInputKind = "criteria" | "plan" | "evidence";

export function acceptanceInputKind(relativePath: string): AcceptanceInputKind | undefined {
  if (relativePath === CRITERIA_FILE) return "criteria";
  if (relativePath === PLAN_FILE) return "plan";
  return isEvidenceReport(relativePath) ? "evidence" : undefined;
}

/** Where a document and what it names are read from, and where their copies go. */
export type ArchiveStorage = {
  /** A file of the task directory, or undefined when it is missing or leaves that directory. */
  readSource(relativePath: string): Promise<Buffer | undefined>;
  write(archivePath: string, data: Buffer | string): Promise<void>;
  read(archivePath: string): Promise<Buffer | undefined>;
};

export type ArchivedAttachment = { source: string; archivePath: string; archived: boolean };
export type ArchivedVersion = AcceptanceReportVersion & { kind: AcceptanceInputKind; archivePath: string; attachments: ArchivedAttachment[] };
type Invalid = { hash: string; receivedAt: string; message: string };

const INDEX_PATH = "evidence/index.json";

function hashOf(data: Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

/** A path named inside a report, kept only when it stays inside the task directory. */
export function containedRelativePath(candidate: string) {
  const normalized = path.posix.normalize(candidate.replace(/\\/g, "/"));
  if (!normalized || normalized.startsWith("../") || normalized === ".." || path.posix.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) return undefined;
  // The workflow prompts name captures from the repository root (`.claude/tasks/assets/x.png`).
  return normalized.replace(/^\.\//, "").replace(/^\.claude\/tasks\//, "") || undefined;
}

export class EvidenceArchive {
  versions: ArchivedVersion[] = [];
  private raw = new Map<string, unknown>();
  private invalid = new Map<string, Invalid>();
  /** Every snapshot the shared utility or the console itself took for this run. */
  readonly knownSnapshots = new Map<string, string>();
  currentSnapshot: { id: string; capturedAt: string } | undefined;
  snapshotTakenAt = 0;
  /** Serialises ingestion and refreshes: a watcher event, a timer and a request never interleave. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: ArchiveStorage, private readonly clock: () => string = () => new Date().toISOString()) {}

  /** Runs one step after every step already queued, whatever happened to them. */
  serialize<T>(step: () => Promise<T>): Promise<T> {
    const next = this.chain.then(step, step);
    this.chain = next.catch(() => undefined);
    return next;
  }

  get hasInputs() {
    return this.versions.length > 0 || this.invalid.size > 0;
  }

  latest(file: string) {
    return this.versions.findLast((version) => version.file === file);
  }

  /** Reads one document of the task directory and archives it when its content is new. True when something changed. */
  async ingest(relativePath: string): Promise<boolean> {
    const kind = acceptanceInputKind(relativePath);
    if (!kind) return false;
    const data = await this.storage.readSource(relativePath);
    if (!data) return false;
    const receivedAt = this.clock();
    if (data.byteLength > MAX_REPORT_BYTES) return this.reject(relativePath, hashOf(data), receivedAt, `Document ignoré : il dépasse ${Math.round(MAX_REPORT_BYTES / 1000)} ko.`);
    const hash = hashOf(data);
    if (this.latest(relativePath)?.hash === hash || this.invalid.get(relativePath)?.hash === hash) return false;
    let value: unknown;
    try { value = JSON.parse(data.toString("utf8")); } catch {
      return this.reject(relativePath, hash, receivedAt, "JSON invalide ou incomplet : la dernière version valide reste affichée, sans compter comme une nouvelle vérification.");
    }
    const version = (this.latest(relativePath)?.version ?? 0) + 1;
    const base = { file: relativePath, version, receivedAt, hash, current: true, kind, archivePath: `evidence/${relativePath}/v${version}.json` };
    let archived: ArchivedVersion;
    if (kind === "criteria") {
      if (!parseCriteriaRegistry(value, relativePath).registry) return this.reject(relativePath, hash, receivedAt, "Registre des critères illisible : la dernière version valide reste en vigueur.");
      archived = { ...base, items: (value as { criteria: unknown[] }).criteria.length, attachments: [] };
    } else if (kind === "plan") {
      if (!parsePlanLinks(value)) return this.reject(relativePath, hash, receivedAt, "Plan illisible : la dernière version valide reste en vigueur.");
      archived = { ...base, items: (value as { tasks: unknown[] }).tasks.length, attachments: [] };
    } else {
      const requested: string[] = [];
      const parsed = parseEvidenceReport(value, { file: relativePath, version, receivedAt, hash }, (source) => { requested.push(source); return undefined; });
      if (!("records" in parsed)) return this.reject(relativePath, hash, receivedAt, parsed.diagnostics[0]?.message ?? "Rapport de preuves illisible.");
      // The captures are copied into this version before it is announced, so a
      // later round writing a new capture under the same name cannot replace it.
      const attachments: ArchivedAttachment[] = [];
      for (const source of [...new Set(requested)]) attachments.push(await this.copyAttachment(relativePath, version, source));
      archived = { ...base, source: parsed.source, ...(parsed.round ? { round: parsed.round } : {}), items: parsed.records.length, attachments };
    }
    await this.storage.write(archived.archivePath, data);
    this.raw.set(archived.archivePath, value);
    this.versions = [...this.versions, archived];
    this.invalid.delete(relativePath);
    await this.persistIndex();
    return true;
  }

  private async reject(file: string, hash: string, receivedAt: string, message: string) {
    this.invalid.set(file, { hash, receivedAt, message });
    await this.persistIndex();
    return true;
  }

  private async copyAttachment(file: string, version: number, source: string): Promise<ArchivedAttachment> {
    const relative = containedRelativePath(source);
    const archivePath = `evidence/${file}/v${version}/${relative ?? path.basename(source)}`;
    if (!relative) return { source, archivePath, archived: false };
    const data = await this.storage.readSource(relative);
    if (!data || data.byteLength > 15_000_000) return { source, archivePath, archived: false };
    await this.storage.write(archivePath, data);
    return { source, archivePath, archived: true };
  }

  /** A capture that arrived after the report naming it, copied into the latest version of that report. True when one was. */
  async retryPendingAttachments(): Promise<boolean> {
    let changed = false;
    const latestByFile = new Map<string, ArchivedVersion>();
    for (const version of this.versions) latestByFile.set(version.file, version);
    for (const version of latestByFile.values()) {
      if (!version.attachments.some((attachment) => !attachment.archived)) continue;
      const attachments: ArchivedAttachment[] = [];
      for (const attachment of version.attachments) {
        const retried = attachment.archived ? attachment : await this.copyAttachment(version.file, version.version, attachment.source);
        if (retried.archived && !attachment.archived) changed = true;
        attachments.push(retried);
      }
      version.attachments = attachments;
    }
    if (changed) await this.persistIndex();
    return changed;
  }

  pendingAttachments() {
    const latestByFile = new Map<string, ArchivedVersion>();
    for (const version of this.versions) latestByFile.set(version.file, version);
    return [...latestByFile.values()].flatMap((version) => version.attachments.filter((attachment) => !attachment.archived).map((attachment) => attachment.source));
  }

  rememberSnapshot(id: string, capturedAt: string) {
    if (!this.knownSnapshots.has(id)) this.knownSnapshots.set(id, capturedAt);
  }

  /** Whether an archive path is one this archive wrote, the only paths it serves. */
  serves(archivePath: string) {
    return this.versions.some((version) => version.archivePath === archivePath || version.attachments.some((attachment) => attachment.archived && attachment.archivePath === archivePath));
  }

  read(archivePath: string) {
    return this.serves(archivePath) ? this.storage.read(archivePath) : Promise.resolve(undefined);
  }

  private registry(): { registry?: CriteriaRegistry; diagnostics: AcceptanceDiagnostic[] } {
    const latest = this.latest(CRITERIA_FILE);
    return latest ? parseCriteriaRegistry(this.raw.get(latest.archivePath), latest.file) : { diagnostics: [] };
  }

  private plan(): PlanLinks | undefined {
    const latest = this.latest(PLAN_FILE);
    return latest ? parsePlanLinks(this.raw.get(latest.archivePath)) : undefined;
  }

  /** The coverage of the run as it stands, from every archived version. */
  view(): AcceptanceView {
    const { registry, diagnostics } = this.registry();
    const reports: { version: AcceptanceReportVersion; records: EvidenceRecord[] }[] = [];
    for (const version of this.versions.filter((entry) => entry.kind === "evidence")) {
      const archived = new Map(version.attachments.filter((attachment) => attachment.archived).map((attachment) => [attachment.source, attachment.archivePath]));
      const parsed = parseEvidenceReport(this.raw.get(version.archivePath), version, (source) => archived.get(source));
      if (!("records" in parsed)) continue;
      const current = this.latest(version.file)?.version === version.version;
      if (current) diagnostics.push(...parsed.diagnostics);
      reports.push({ version: { file: version.file, version: version.version, receivedAt: version.receivedAt, hash: version.hash, source: version.source ?? sourceOfReport(version.file), ...(version.round ? { round: version.round } : {}), items: version.items, current }, records: parsed.records });
    }
    for (const [file, invalid] of this.invalid) diagnostics.push({ level: "error", file, message: invalid.message });
    for (const source of this.pendingAttachments()) diagnostics.push({ level: "warning", file: source, message: "Pièce jointe citée mais pas encore archivée." });
    const plan = this.plan();
    return deriveAcceptanceCoverage({
      ...(registry ? { registry } : {}),
      ...(plan ? { plan } : {}),
      reports,
      ...(this.currentSnapshot ? { currentSnapshot: this.currentSnapshot } : {}),
      knownSnapshots: new Set(this.knownSnapshots.keys()),
      diagnostics,
      now: this.clock(),
    });
  }

  /**
   * Reads back what an earlier process archived, for a run consulted after a
   * restart. Read only: nothing is ingested, and a missing or damaged index
   * leaves the archive empty rather than failing.
   */
  async restore() {
    const index = await this.storage.read(INDEX_PATH).catch(() => undefined);
    if (!index) return false;
    let parsed: { versions?: unknown; invalid?: unknown };
    try { parsed = JSON.parse(index.toString("utf8")) as typeof parsed; } catch { return false; }
    if (!Array.isArray(parsed.versions)) return false;
    const versions: ArchivedVersion[] = [];
    for (const version of parsed.versions as ArchivedVersion[]) {
      if (!version || typeof version.archivePath !== "string" || typeof version.file !== "string") continue;
      const data = await this.storage.read(version.archivePath).catch(() => undefined);
      if (!data) continue;
      try { this.raw.set(version.archivePath, JSON.parse(data.toString("utf8"))); } catch { continue; }
      versions.push({ ...version, attachments: Array.isArray(version.attachments) ? version.attachments : [] });
    }
    this.versions = versions;
    if (parsed.invalid && typeof parsed.invalid === "object") for (const [file, invalid] of Object.entries(parsed.invalid as Record<string, Invalid>)) this.invalid.set(file, invalid);
    return true;
  }

  private async persistIndex() {
    const index = { schemaVersion: 1, versions: this.versions, invalid: Object.fromEntries(this.invalid) };
    await this.storage.write(INDEX_PATH, JSON.stringify(index, null, 2));
  }
}

async function atomicWrite(target: string, data: Buffer | string) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, target);
}

/** Resolves a path under a root and refuses anything that leaves it, a symbolic link pointing out included. */
export async function confinedPath(root: string, relativePath: string) {
  const base = path.resolve(root);
  const target = path.resolve(base, relativePath);
  if (!target.startsWith(`${base}${path.sep}`)) return undefined;
  try {
    const [realBase, realTarget] = await Promise.all([realpath(base), realpath(target)]);
    return realTarget.startsWith(`${realBase}${path.sep}`) ? realTarget : undefined;
  } catch {
    return undefined;
  }
}

/** The task directory of a real run on one side, the run's own data directory on the other. */
export function diskStorage(taskRoot: () => string, runDirectory: string): ArchiveStorage {
  return {
    async readSource(relativePath) {
      const target = await confinedPath(taskRoot(), relativePath);
      return target ? readFile(target).catch(() => undefined) : undefined;
    },
    async write(archivePath, data) {
      const target = path.resolve(runDirectory, archivePath);
      if (!target.startsWith(`${path.resolve(runDirectory)}${path.sep}`)) throw new Error("Chemin d'archive invalide.");
      await atomicWrite(target, data);
    },
    async read(archivePath) {
      const target = await confinedPath(runDirectory, archivePath);
      return target ? readFile(target).catch(() => undefined) : undefined;
    },
  };
}

/** For the simulated run: sources come from the demo documents, copies stay in memory. */
export function memoryStorage(sources: (relativePath: string) => Buffer | undefined): ArchiveStorage {
  const copies = new Map<string, Buffer>();
  return {
    readSource: async (relativePath) => sources(relativePath),
    write: async (archivePath, data) => { copies.set(archivePath, Buffer.isBuffer(data) ? data : Buffer.from(data)); },
    read: async (archivePath) => copies.get(archivePath),
  };
}

export { atomicWrite };
