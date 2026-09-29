import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { concurrencyLimit, permissionMode, positiveDuration } from "./domain.js";
import { DEFAULT_HEALTH_POLICY, type HealthPolicy } from "./run-health.js";

export const consoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = process.env.IMPL_ENV_FILE ?? path.resolve(consoleRoot, "..", ".env");
try {
  process.loadEnvFile(envFile);
} catch (error) {
  // A missing .env is the normal case; anything else means the file is there
  // but unusable, and staying silent would hide a broken configuration.
  if (existsSync(envFile)) console.warn(`Configuration ignorée, ${envFile} est illisible : ${error instanceof Error ? error.message : error}`);
}
export const pluginRoot = path.resolve(process.env.IMPL_PLUGIN_ROOT?.trim() || path.join(consoleRoot, ".."));
export const storageRoot = path.resolve(process.env.IMPL_DATA_DIR ?? path.join(consoleRoot, "data"));
export const dataRoot = path.join(storageRoot, "runs");
export const feedbackRoot = path.join(storageRoot, "feedback", "pending");
/** The launches accepted but not started, kept across a restart of the console. */
export const queueFile = path.join(storageRoot, "queue.json");
export let port = Number(process.env.PORT ?? process.env.IMPL_PORT ?? 3210);
/** Port zero lets the OS bind a free port; agent hooks need the actual one. */
export function setListeningPort(value: number) { port = value; }
/** On unless explicitly turned off. */
export function selfImprovementAutorun() { return process.env.IMPL_SELF_IMPROVEMENT_AUTORUN !== "false"; }
export const hostname = process.env.IMPL_HOST ?? "127.0.0.1";
export const dev = process.env.NODE_ENV !== "production";
export const remoteControl = process.env.IMPL_REMOTE_CONTROL !== "false";
export const sessionPermissionMode = permissionMode(process.env.IMPL_PERMISSION_MODE, "auto");
export const demoStepDuration = positiveDuration(process.env.IMPL_DEMO_STEP_MS, 5_000);
export const maxConcurrentRuns = concurrencyLimit(process.env.IMPL_MAX_CONCURRENT_RUNS, 3);
/**
 * The thresholds of the run health monitor (see run-health.ts). Only the
 * silence before a doubt is a user setting; the others are overridable for the
 * integration suite, which cannot wait a minute per scenario.
 */
export const healthPolicy: HealthPolicy = {
  tickMs: positiveDuration(process.env.IMPL_HEALTH_TICK_MS, DEFAULT_HEALTH_POLICY.tickMs),
  turnEndGraceMs: positiveDuration(process.env.IMPL_HEALTH_TURN_GRACE_MS, DEFAULT_HEALTH_POLICY.turnEndGraceMs),
  artifactGraceMs: positiveDuration(process.env.IMPL_HEALTH_ARTIFACT_GRACE_MS, DEFAULT_HEALTH_POLICY.artifactGraceMs),
  suspicionMs: positiveDuration(process.env.IMPL_STALL_MINUTES, DEFAULT_HEALTH_POLICY.suspicionMs / 60_000) * 60_000,
  resumeGraceMs: DEFAULT_HEALTH_POLICY.resumeGraceMs,
};
/**
 * The secret every hook posts back, drawn at each start. The integration suite
 * sets its own, being the only caller that posts hooks without a session.
 */
export const hookToken = process.env.IMPL_HOOK_TOKEN?.trim() || randomBytes(32).toString("hex");
