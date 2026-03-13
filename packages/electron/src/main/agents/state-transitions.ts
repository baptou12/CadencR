/**
 * Centralized state transition functions for features, phases, and agent sessions.
 *
 * All status updates for these entities should go through these functions
 * to ensure consistent validation, logging, and DB notification.
 */

import { Effect } from "effect";
import { queryOne, execute } from "../db/query";
import { notifyDbUpdated } from "./effect-helpers";

// ---------------------------------------------------------------------------
// Status types
// ---------------------------------------------------------------------------

export type FeatureStatus = "draft" | "planned" | "in-progress" | "done";

export type PhaseStatus = "draft" | "pending" | "running" | "completed" | "error";

export type AgentSessionStatus = "running" | "waiting" | "paused" | "completed" | "error";

// ---------------------------------------------------------------------------
// Allowed transitions
// ---------------------------------------------------------------------------

const FEATURE_TRANSITIONS: Record<FeatureStatus, FeatureStatus[]> = {
  draft: ["planned"],
  planned: ["in-progress"],
  "in-progress": ["done"],
  done: ["planned"],
};

const PHASE_TRANSITIONS: Record<PhaseStatus, PhaseStatus[]> = {
  draft: ["pending"],
  pending: ["running"],
  running: ["completed", "error", "pending"],
  completed: ["pending"],
  error: ["pending", "running"],
};

const SESSION_TRANSITIONS: Record<AgentSessionStatus, AgentSessionStatus[]> = {
  running: ["completed", "error", "paused", "waiting"],
  waiting: ["running", "paused", "completed"],
  paused: ["running", "completed", "error"],
  completed: ["running"],
  error: ["running"],
};

// ---------------------------------------------------------------------------
// Transition functions
// ---------------------------------------------------------------------------

/**
 * Transition a feature's status. Validates the transition, updates DB, notifies renderer.
 * If the transition is invalid, logs a warning but still performs the update.
 */
export function transitionFeature(
  featureId: number,
  to: FeatureStatus,
): void {
  const row = Effect.runSync(queryOne<{ status: string }>("SELECT status FROM features WHERE id = ?", featureId));
  if (!row) {
    console.warn(`[state-transitions] Feature ${featureId} not found`);
    return;
  }

  const from = row.status as FeatureStatus;
  const allowed = FEATURE_TRANSITIONS[from];
  if (allowed && !allowed.includes(to)) {
    console.warn(`[state-transitions] Invalid feature transition: ${from} -> ${to} (feature ${featureId})`);
  }

  Effect.runSync(execute("UPDATE features SET status = ? WHERE id = ?", to, featureId));
  notifyDbUpdated("feature", featureId);
}

/**
 * Transition a phase's status. Validates the transition, updates DB, notifies renderer.
 * If the transition is invalid, logs a warning but still performs the update.
 *
 * @param featureId - Required for notifyDbUpdated; pass the owning feature's ID.
 * @param extraColumns - Optional extra column updates (e.g., { implementation_notes: "..." }).
 */
export function transitionPhase(
  phaseId: number,
  to: PhaseStatus,
  featureId: number,
  extraColumns?: Record<string, unknown>,
): void {
  const row = Effect.runSync(queryOne<{ status: string }>("SELECT status FROM phases WHERE id = ?", phaseId));
  if (!row) {
    console.warn(`[state-transitions] Phase ${phaseId} not found`);
    return;
  }

  const from = row.status as PhaseStatus;
  const allowed = PHASE_TRANSITIONS[from];
  if (allowed && !allowed.includes(to)) {
    console.warn(`[state-transitions] Invalid phase transition: ${from} -> ${to} (phase ${phaseId})`);
  }

  console.log(`[phase-trace] phase ${phaseId}: ${from} -> ${to} (feature ${featureId})`, new Error().stack?.split("\n").slice(1, 4).join(" <- "));

  if (extraColumns && Object.keys(extraColumns).length > 0) {
    const keys = Object.keys(extraColumns);
    const sets = ["status = ?", ...keys.map((k) => `${k} = ?`)];
    const values = [to, ...keys.map((k) => extraColumns[k]), phaseId];
    Effect.runSync(execute(`UPDATE phases SET ${sets.join(", ")} WHERE id = ?`, ...values));
  } else {
    Effect.runSync(execute("UPDATE phases SET status = ? WHERE id = ?", to, phaseId));
  }

  notifyDbUpdated("phase", featureId);
}

/**
 * Transition a phase's status only if the current status matches `expectedFrom`.
 * Used for conditional updates like "reset to pending only if still running".
 */
export function transitionPhaseIf(
  phaseId: number,
  expectedFrom: PhaseStatus,
  to: PhaseStatus,
  featureId: number,
): void {
  const result = Effect.runSync(execute("UPDATE phases SET status = ? WHERE id = ? AND status = ?", to, phaseId, expectedFrom));
  if (result.changes > 0) {
    console.log(`[phase-trace] phaseIf ${phaseId}: ${expectedFrom} -> ${to} (changed, feature ${featureId})`);
    notifyDbUpdated("phase", featureId);
  } else {
    console.log(`[phase-trace] phaseIf ${phaseId}: ${expectedFrom} -> ${to} (no-op, current status didn't match)`);
  }
}

/**
 * Transition an agent session's status. Validates the transition, updates DB, notifies renderer.
 * If the transition is invalid, logs a warning but still performs the update.
 *
 * @param featureId - Required for notifyDbUpdated. If null, notification is skipped.
 * @param extraColumns - Optional extra column updates (e.g., { ended_at: new Date().toISOString() }).
 */
export function transitionAgentSession(
  sessionId: number,
  to: AgentSessionStatus,
  featureId?: number | null,
  extraColumns?: Record<string, unknown>,
): void {
  const row = Effect.runSync(queryOne<{ status: string; feature_id: number | null }>("SELECT status, feature_id FROM agent_sessions WHERE id = ?", sessionId));
  if (!row) {
    console.warn(`[state-transitions] Agent session ${sessionId} not found`);
    return;
  }

  const from = row.status as AgentSessionStatus;
  const allowed = SESSION_TRANSITIONS[from];
  if (allowed && !allowed.includes(to)) {
    console.warn(`[state-transitions] Invalid session transition: ${from} -> ${to} (session ${sessionId})`);
  }

  console.log(`[session-trace] session ${sessionId}: ${from} -> ${to} (feature ${featureId ?? row.feature_id})`, new Error().stack?.split("\n").slice(1, 4).join(" <- "));

  const resolvedFeatureId = featureId ?? row.feature_id;

  if (extraColumns && Object.keys(extraColumns).length > 0) {
    const keys = Object.keys(extraColumns);
    const sets = ["status = ?", ...keys.map((k) => `${k} = ?`)];
    const values = [to, ...keys.map((k) => extraColumns[k]), sessionId];
    Effect.runSync(execute(`UPDATE agent_sessions SET ${sets.join(", ")} WHERE id = ?`, ...values));
  } else {
    Effect.runSync(execute("UPDATE agent_sessions SET status = ? WHERE id = ?", to, sessionId));
  }

  if (resolvedFeatureId) {
    notifyDbUpdated("agent_session", resolvedFeatureId);
  }
}
