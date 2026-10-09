import path from "node:path";
import type { JudgeOptions } from "./types.js";

/**
 * The judge reads the evidence and the branch, and writes its verdict file.
 * No shell, no agent, no edit: the run archives it reads hold ticket text
 * anyone who can file a ticket controls. `hooks/guard.mjs` (`judgeRefusal`)
 * holds the same line on the input of each call.
 */
const JUDGE_TOOLS = ["Read", "Glob", "Grep", "Write"];

/**
 * The arguments of the headless session that decides whether an improvement
 * branch is merged without the user. It loads the plugin of the checkout, never
 * the branch's, so a branch cannot rewrite the command that judges it.
 */
export function judgeArguments({ pluginDir, inputPath, outputPath, readDirectories }: Pick<JudgeOptions, "pluginDir" | "inputPath" | "outputPath" | "readDirectories">) {
  const directories = [...new Set([pluginDir, path.dirname(inputPath), path.dirname(outputPath), ...readDirectories])];
  return [
    "-p",
    "--setting-sources", "project,local",
    "--plugin-dir", pluginDir,
    ...directories.flatMap((directory) => ["--add-dir", directory]),
    "--model", "opus",
    "--permission-mode", "dontAsk",
    "--permission-prompts", "none",
    "--allowedTools", JUDGE_TOOLS.join(","),
    "--output-format", "json",
    "--", `/implementation-factory:judge-improvement ${inputPath} ${outputPath}`,
  ];
}

/** Without the variables of a run, so the plugin hooks post nothing, and with the one that makes the guard apply the judge's rules. */
export function judgeEnvironment<T extends Record<string, string | undefined>>(environment: T, outputPath: string): T & { IMPL_JUDGE_OUTPUT: string } {
  const cleaned: Record<string, string | undefined> = { ...environment };
  for (const key of ["IMPL_RUN_ID", "IMPL_HOOK_URL", "IMPL_HOOK_SPOOL", "IMPL_SCHEDULE_OUTPUT", "IMPL_JUDGE_OUTPUT"]) delete cleaned[key];
  return { ...cleaned, IMPL_JUDGE_OUTPUT: outputPath } as T & { IMPL_JUDGE_OUTPUT: string };
}
