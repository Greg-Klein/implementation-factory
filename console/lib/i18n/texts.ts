import { pickTexts, type Language, type TextsOf } from "./index";
import { common } from "./common";
import { shell } from "./shell";
import { rail } from "./rail";
import { launch } from "./launch";
import { run } from "./run";
import { conversation } from "./conversation";
import { evidence } from "./evidence";
import { metrics } from "./metrics";
import { runState } from "./run-state";
import { cli } from "./cli";
import { serverRun } from "./server-run";
import { serverOps } from "./server-ops";
import { demo } from "./demo";

/**
 * Every text the interface, the server and the terminal client show, one area
 * per file so that each surface owns its own.
 */
export const CATALOG = { common, shell, rail, launch, run, conversation, evidence, metrics, runState, cli, serverRun, serverOps, demo };

export type Texts = TextsOf<typeof CATALOG>;

const cache = new Map<Language, Texts>();

export function texts(language: Language): Texts {
  let picked = cache.get(language);
  if (!picked) {
    picked = pickTexts(CATALOG, language);
    cache.set(language, picked);
  }
  return picked;
}
