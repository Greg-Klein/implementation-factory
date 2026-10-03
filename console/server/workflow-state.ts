import { normalizeText } from "./domain.js";
import type { WorkflowState, WorkflowStateName } from "./types.js";

/**
 * `workflow-state.json`: what the pilot says it is doing and what comes next,
 * written at every significant transition of the workflow (see the "Workflow
 * state" section of commands/implement.md). Hooks say what happened; only this
 * file says what the workflow expects to happen, which is what tells a pilot
 * legitimately waiting from one that has nothing left to do.
 *
 * It completes the observed events, it never overrides them: a declared wait
 * on an agent with no agent running does not hide a run with no next action,
 * and a declared end is checked against the deliverable before it counts.
 */
export const WORKFLOW_STATE_FILE = "workflow-state.json";

const MAX_BYTES = 64_000;
const STATES: WorkflowStateName[] = ["working", "waiting", "completed", "blocked"];
const DELIVERIES = ["merge_request", "draft_merge_request", "none"] as const;

function identifiers(value: unknown) {
  return Array.isArray(value) ? value.flatMap((entry) => normalizeText(entry) ?? []).slice(0, 50) : [];
}

/** A task-relative path, never one leaving the task directory. */
function relativeFile(value: unknown) {
  const file = normalizeText(value);
  if (!file || file.startsWith("/") || file.split(/[\\/]/).includes("..")) return undefined;
  return file;
}

export type WorkflowStateReading = { state: WorkflowState } | { error: string };

/** Reads the file as untrusted data: anything malformed is a diagnostic, never a state. */
export function parseWorkflowState(content: string, receivedAt: string): WorkflowStateReading {
  if (content.length > MAX_BYTES) return { error: "workflow-state.json dépasse la taille admise." };
  let value: unknown;
  try { value = JSON.parse(content); } catch { return { error: "workflow-state.json n'est pas un JSON valide (écriture partielle ?)." }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "workflow-state.json n'est pas un objet." };
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) return { error: `Version de workflow-state.json inconnue : ${String(raw.schemaVersion)}.` };
  const revision = raw.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) return { error: "workflow-state.json n'a pas de révision valide." };
  const state = raw.state;
  if (typeof state !== "string" || !(STATES as string[]).includes(state)) return { error: `État de workflow inconnu : ${String(state)}.` };
  const parsed: WorkflowState = { schemaVersion: 1, revision, state: state as WorkflowStateName, receivedAt };
  const step = normalizeText(raw.step);
  if (step) parsed.step = step.slice(0, 40);
  const next = raw.nextAction as Record<string, unknown> | undefined;
  if (next && typeof next === "object" && !Array.isArray(next)) {
    const kind = normalizeText(next.kind);
    if (kind) {
      const expectedArtifact = relativeFile(next.expectedArtifact);
      const description = normalizeText(next.description);
      parsed.nextAction = {
        kind: kind.slice(0, 40), taskIds: identifiers(next.taskIds), agents: identifiers(next.agents),
        ...(expectedArtifact ? { expectedArtifact } : {}), ...(description ? { description: description.slice(0, 400) } : {}),
      };
    }
  }
  const result = raw.result as Record<string, unknown> | undefined;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const delivery = result.delivery;
    if (typeof delivery === "string" && (DELIVERIES as readonly string[]).includes(delivery)) {
      const mergeRequestUrl = normalizeText(result.mergeRequestUrl);
      parsed.result = { delivery: delivery as (typeof DELIVERIES)[number], ...(mergeRequestUrl ? { mergeRequestUrl } : {}), blockers: identifiers(result.blockers) };
    }
  }
  if (raw.reviewTier === 0 || raw.reviewTier === 1 || raw.reviewTier === 2) parsed.reviewTier = raw.reviewTier;
  return { state: parsed };
}

/**
 * Whether a declared end holds against what the run shows. A merge request,
 * draft or not, must exist; delivering nothing is an end only with the reason
 * written down. Anything else is an end the console does not believe.
 */
export function declaredCompletion(workflow: WorkflowState | undefined, mergeRequestUrl: string | undefined): { complete: boolean; problem?: string } {
  if (!workflow || workflow.state !== "completed") return { complete: false };
  const result = workflow.result;
  if (!result) return { complete: false, problem: "Fin déclarée sans résultat de livraison." };
  if (result.delivery === "none") return result.blockers.length > 0 ? { complete: true } : { complete: false, problem: "Fin déclarée sans livraison ni blocage expliqué." };
  if (mergeRequestUrl || result.mergeRequestUrl) return { complete: true };
  return { complete: false, problem: "Fin déclarée avec une merge request que le run n'a jamais ouverte." };
}
