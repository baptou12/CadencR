/**
 * Centralized state transition functions for features, phases, and agent sessions.
 *
 * All status updates for these entities should go through these functions
 * to ensure consistent validation, logging, and DB notification.
 */

import type Database from "better-sqlite3";
import { notifyDbUpdated } from "./ipc-bridge";

// ---------------------------------------------------------------------------
// Status types
// ---------------------------------------------------------------------------

export type FeatureStatus = "draft" | "planned" | "in-progress" | "review" | "done";

export type PhaseStatus = "draft" | "pending" | "running" | "completed" | "error";

export type AgentSessionStatus = "running" | "waiting" | "paused" | "completed" | "error";

// ---------------------------------------------------------------------------
// Allowed transitions
// ---------------------------------------------------------------------------

const FEATURE_TRANSITIONS: Record<FeatureStatus, FeatureStatus[]> = {
  draft: ["planned"],
  planned: ["in-progress"],
  "in-progress": ["review", "done"],
  review: ["done", "in-progress"],
  done: [],
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
  db: Database.Database,
  featureId: number,
  to: FeatureStatus,
): void {
  const row = db.prepare("SELECT status FROM features WHERE id = ?").get(featureId) as { status: string } | undefined;
  if (!row) {
    console.warn(`[state-transitions] Feature ${featureId} not found`);
    return;
  }

  const from = row.status as FeatureStatus;
  const allowed = FEATURE_TRANSITIONS[from];
  if (allowed && !allowed.includes(to)) {
    console.warn(`[state-transitions] Invalid feature transition: ${from} -> ${to} (feature ${featureId})`);
  }

  db.prepare("UPDATE features SET status = ? WHERE id = ?").run(to, featureId);
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
  db: Database.Database,
  phaseId: number,
  to: PhaseStatus,
  featureId: number,
  extraColumns?: Record<string, unknown>,
): void {
  const row = db.prepare("SELECT status FROM phases WHERE id = ?").get(phaseId) as { status: string } | undefined;
  if (!row) {
    console.warn(`[state-transitions] Phase ${phaseId} not found`);
    return;
  }

  const from = row.status as PhaseStatus;
  const allowed = PHASE_TRANSITIONS[from];
  if (allowed && !allowed.includes(to)) {
    console.warn(`[state-transitions] Invalid phase transition: ${from} -> ${to} (phase ${phaseId})`);
  }

  if (extraColumns && Object.keys(extraColumns).length > 0) {
    const keys = Object.keys(extraColumns);
    const sets = ["status = ?", ...keys.map((k) => `${k} = ?`)];
    const values = [to, ...keys.map((k) => extraColumns[k]), phaseId];
    db.prepare(`UPDATE phases SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  } else {
    db.prepare("UPDATE phases SET status = ? WHERE id = ?").run(to, phaseId);
  }

  notifyDbUpdated("phase", featureId);
}

/**
 * Transition a phase's status only if the current status matches `expectedFrom`.
 * Used for conditional updates like "reset to pending only if still running".
 */
export function transitionPhaseIf(
  db: Database.Database,
  phaseId: number,
  expectedFrom: PhaseStatus,
  to: PhaseStatus,
  featureId: number,
): void {
  const result = db.prepare("UPDATE phases SET status = ? WHERE id = ? AND status = ?").run(to, phaseId, expectedFrom);
  if (result.changes > 0) {
    notifyDbUpdated("phase", featureId);
  }
}

/**
 * Transition an agent session's status. Validates the transition, updates DB, notifies renderer.
 * If the transition is invalid, logs a warning but still performs the update.
 *
 * @param featureId - Required for notifyDbUpdated. If null, notification is skipped.
 * @param extraColumns - Optional extra column updates (e.g., { ended_at: "datetime('now')" }).
 */
export function transitionAgentSession(
  db: Database.Database,
  sessionId: number,
  to: AgentSessionStatus,
  featureId?: number | null,
  extraColumns?: Record<string, unknown>,
): void {
  const row = db.prepare("SELECT status, feature_id FROM agent_sessions WHERE id = ?").get(sessionId) as { status: string; feature_id: number | null } | undefined;
  if (!row) {
    console.warn(`[state-transitions] Agent session ${sessionId} not found`);
    return;
  }

  const from = row.status as AgentSessionStatus;
  const allowed = SESSION_TRANSITIONS[from];
  if (allowed && !allowed.includes(to)) {
    console.warn(`[state-transitions] Invalid session transition: ${from} -> ${to} (session ${sessionId})`);
  }

  const resolvedFeatureId = featureId ?? row.feature_id;

  if (extraColumns && Object.keys(extraColumns).length > 0) {
    const keys = Object.keys(extraColumns);
    const sets = ["status = ?", ...keys.map((k) => `${k} = ?`)];
    const values = [to, ...keys.map((k) => extraColumns[k]), sessionId];
    db.prepare(`UPDATE agent_sessions SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  } else {
    db.prepare("UPDATE agent_sessions SET status = ? WHERE id = ?").run(to, sessionId);
  }

  if (resolvedFeatureId) {
    notifyDbUpdated("agent_session", resolvedFeatureId);
  }
}
