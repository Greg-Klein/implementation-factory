import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { languageOf, type Language } from "../lib/i18n/index.js";
import { texts } from "../lib/i18n/texts.js";
import { consoleRoot, envFile } from "./config.js";

const exec = promisify(execFile);

let current: Language = languageOf(process.env.IMPL_LANGUAGE);

/**
 * The language of the interface, of the terminal client and of the runs launched
 * from now on. A run keeps the one it was launched in (`RunState.language`).
 */
export function currentLanguage(): Language {
  return current;
}

export function currentTexts() {
  return texts(current);
}

/**
 * Applied at once, then written to `.env` through `impl config`, which owns the
 * file. The environment follows too: the headless sessions the console spawns
 * inherit it.
 */
/** What a run writes for people, decided at its launch. A run archived before the setting existed reads the current one. */
export function runLanguage(state: { language?: Language }): Language {
  return state.language ?? current;
}

export async function setLanguage(language: Language) {
  await exec(process.execPath, [path.join(consoleRoot, "..", "bin", "config.mjs"), "set", `IMPL_LANGUAGE=${language}`], { env: { ...process.env, IMPL_ENV_FILE: envFile } });
  current = language;
  process.env.IMPL_LANGUAGE = language;
}
