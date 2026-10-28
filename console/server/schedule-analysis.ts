import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isMissingFile } from "./context.js";
import { pluginRoot, scheduleRoot, scheduleTimeoutMs } from "./config.js";
import { currentLanguage, currentTexts } from "./language.js";
import { scheduleInput, validateSchedule, type KnownTicket, type ScheduleOutput } from "./domain.js";
import { engine } from "./engine/index.js";
import type { ScheduleSession } from "./engine/types.js";

export type AnalysisResult = { ok: true; schedule: ScheduleOutput } | { ok: false; failure: string };

function duration(milliseconds: number) {
  return milliseconds >= 60_000 ? `${Math.round(milliseconds / 60_000)} min` : `${Math.round(milliseconds / 1_000)} s`;
}

/**
 * One scheduling session for the new tickets of one repository. The result is
 * judged on the output file alone, held against contracts/schedule.md: the
 * exit code of the session says nothing. Every call gets a directory of its
 * own under the data directory, so a file left by an earlier call is never
 * read as an answer; it goes once the answer is read, and stays, with the end
 * of what the session printed, when there was none to read.
 * `onSession` hands the session back, for a shutdown to stop it.
 */
export async function analyseTickets(repository: string, tickets: string[], known: KnownTicket[], onSession?: (session: ScheduleSession | null) => void): Promise<AnalysisResult> {
  const directory = path.join(scheduleRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`);
  const inputPath = path.join(directory, "input.json");
  const outputPath = path.join(directory, "output.json");
  const fail = async (failure: string, log?: string): Promise<AnalysisResult> => {
    if (log) await writeFile(path.join(directory, "session.log"), log).catch(() => undefined);
    return { ok: false, failure };
  };
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(inputPath, JSON.stringify(scheduleInput(repository, currentLanguage(), tickets, known), null, 2));
  } catch {
    return { ok: false, failure: currentTexts().serverRun.analysisInputNotWritten };
  }
  const session = engine.startSchedule({ repository, pluginDir: pluginRoot, inputPath, outputPath, timeoutMs: scheduleTimeoutMs });
  if (!session) return fail(currentTexts().serverRun.analysisEngineNotFound(engine.label));
  onSession?.(session);
  const { timedOut, log } = await session.finished;
  onSession?.(null);
  if (timedOut) return fail(currentTexts().serverRun.analysisTimeout(duration(scheduleTimeoutMs)), log);
  let output: unknown;
  try {
    output = JSON.parse(await readFile(outputPath, "utf8"));
  } catch (error) {
    return fail(isMissingFile(error) ? currentTexts().serverRun.analysisOutputMissing : currentTexts().serverRun.analysisOutputUnreadable, log);
  }
  const validation = validateSchedule({ tickets, known: known.map(({ ticket }) => ticket.issueUrl) }, output);
  if (!validation.ok) return fail(currentTexts().serverRun.analysisOutputRefused(validation.error), log);
  await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  return { ok: true, schedule: validation.schedule };
}

/** Whatever an earlier process left: its sessions are gone, and so are the answers nobody will read. */
export async function clearScheduleFiles() {
  await rm(scheduleRoot, { recursive: true, force: true }).catch(() => undefined);
}
