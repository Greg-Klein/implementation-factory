import { claudeCode } from "./claude-code.js";

/**
 * The agent the harness drives. One implementation today; the selection lives
 * here so that adding a second one is a change in this file and nowhere else.
 */
export const engine = claudeCode;

export type { Engine, EngineEvent, EngineSession, SessionPromptDecision, SessionUsage, StartOptions, UsageSource } from "./types.js";
