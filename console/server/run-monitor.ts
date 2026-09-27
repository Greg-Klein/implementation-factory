import { runInProgress } from "./domain.js";
import { demoHealthGraceMs } from "./demo.js";
import { drainHookSpool } from "./hook-bridge.js";
import { DEFAULT_HEALTH_POLICY, evaluateRunHealth, healthSignalsView, wokeUpFromSuspension, type HealthInput, type HealthPolicy } from "./run-health.js";
import { reconcileIncidents, resolutionOutcome } from "./run-incidents.js";
import type { RunSession } from "./run-session.js";
import type { RunHealthView, WaitReason } from "./types.js";

/**
 * The one scheduler behind run health: a tick for every live run, plus a look
 * whenever something happened to one of them. Evaluations of a run are
 * serialised with the incident actions on that run, and a run that left the
 * registry is never evaluated again, so a late tick cannot bring back a run
 * that was closed or stopped.
 */

/** Waits that only the user can lift: they put the run in "attention". */
const HUMAN_WAITS = new Set<WaitReason>(["user_question", "permission", "terminal_interaction", "unknown"]);

export function healthInput(session: RunSession): HealthInput {
  const state = session.state;
  return {
    status: state.status,
    // The simulated run has no session process: while it plays, it is live.
    sessionActive: state.sessionActive || (session.demo && runInProgress(state.status)),
    stoppedBy: session.stoppedBy,
    pendingQuestion: Boolean(state.pendingQuestion),
    agents: state.agents,
    artifacts: state.artifacts,
    ...(state.planTasks ? { planTasks: state.planTasks } : {}),
    ...(state.planDelegations ? { planDelegations: state.planDelegations } : {}),
    ...(state.mergeRequestUrl ? { mergeRequestUrl: state.mergeRequestUrl } : {}),
    ...(state.workflow ? { workflow: state.workflow } : {}),
    signals: healthSignalsView(session.signals),
  };
}

function comparable(view: RunHealthView | undefined) {
  if (!view) return "";
  const { evaluatedAt: _evaluatedAt, ...rest } = view;
  return JSON.stringify(rest);
}

/**
 * One evaluation of one run, applied: its health, its incidents, and whether
 * it needs the user. Returns true when anything changed.
 */
export async function applyHealth(session: RunSession, now: number, policy: HealthPolicy = DEFAULT_HEALTH_POLICY) {
  if (session.disposed || session.state.archived) return false;
  const input = healthInput(session);
  const verdict = evaluateRunHealth(input, now, policy);
  const at = new Date(now).toISOString();
  const transition = reconcileIncidents(session.state.incidents ?? [], verdict.incident, {
    runId: session.id, now: at, outcome: (incident) => resolutionOutcome(incident, input, verdict),
  });
  const dismissed = verdict.incident && transition.incidents.find((incident) => incident.fingerprint === verdict.incident!.fingerprint)?.status === "dismissed";
  // A cause the user classified as a false positive stays visible in the incident, not in the health.
  const shown = dismissed ? { health: "healthy" as const } : verdict;
  const workflow: RunHealthView["workflow"] = session.demo ? undefined
    : session.state.workflow ? { state: session.state.workflow.state, revision: session.state.workflow.revision, receivedAt: session.state.workflow.receivedAt, ...(session.state.workflow.nextAction ? { nextAction: session.state.workflow.nextAction.kind } : {}) }
      : { missing: true };
  const view: RunHealthView = {
    health: shown.health, ...(shown.wait ? { wait: shown.wait } : {}), ...(shown.title ? { title: shown.title } : {}), ...(shown.detail ? { detail: shown.detail } : {}),
    ...(workflow ? { workflow } : {}), evaluatedAt: at,
  };
  let changed = transition.changed || comparable(view) !== comparable(session.state.health);
  if (transition.changed) session.state.incidents = transition.incidents;
  if (comparable(view) !== comparable(session.state.health)) session.state.health = view;
  if (runInProgress(session.state.status) && session.state.status !== "starting") {
    const openLive = transition.incidents.some((incident) => incident.status === "open" && incident.kind !== "lost_session");
    const needsUser = (shown.health === "waiting" && HUMAN_WAITS.has(shown.wait!.reason)) || openLive;
    const status = needsUser ? "attention" as const : "running" as const;
    if (status !== session.state.status) { session.state.status = status; changed = true; }
  }
  for (const incident of transition.opened) session.activity("attention", incident.title, incident.reason);
  for (const incident of transition.resolved) session.activity("system", `Incident clos : ${incident.title}`, incident.resolution?.outcome);
  if (!changed) return false;
  session.publish();
  // An incident is only worth something if it survives the next crash.
  if (transition.changed) await session.persist();
  return true;
}

export class RunMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick: number | undefined;
  private stopped = false;
  private readonly queued = new Set<RunSession>();

  constructor(
    private readonly sessions: () => RunSession[],
    private readonly policy: HealthPolicy = DEFAULT_HEALTH_POLICY,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  start() {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.tick(), this.policy.tickMs);
    this.timer.unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.queued.clear();
  }

  /** Every live run: late hooks first, then its health. */
  async tick() {
    if (this.stopped) return;
    const now = this.clock();
    // Asleep, nothing could happen, and nothing did: every grace restarts from the wake-up.
    if (wokeUpFromSuspension(this.lastTick, now, this.policy)) for (const session of this.sessions()) session.signals.resumedAt = now;
    this.lastTick = now;
    await Promise.all(this.sessions().map(async (session) => {
      if (session.state.sessionActive) await drainHookSpool(session);
      await this.evaluate(session);
    }));
  }

  /** Something happened to this run: look at it again once the current event is fully applied. */
  poke(session: RunSession) {
    if (this.stopped || this.queued.has(session)) return;
    this.queued.add(session);
    setImmediate(() => {
      this.queued.delete(session);
      void this.evaluate(session);
    });
  }

  evaluate(session: RunSession) {
    if (this.stopped || session.disposed) return Promise.resolve(false);
    // The simulated run plays in seconds: its graces are shortened to match.
    const policy = session.demo ? { ...this.policy, turnEndGraceMs: Math.min(this.policy.turnEndGraceMs, demoHealthGraceMs()), artifactGraceMs: Math.min(this.policy.artifactGraceMs, demoHealthGraceMs()) } : this.policy;
    return session.serializeHealth(() => (this.stopped ? false : applyHealth(session, this.clock(), policy))).catch(() => false);
  }
}

