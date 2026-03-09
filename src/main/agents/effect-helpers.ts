/**
 * Thin synchronous wrappers around the Effect SessionPersistence and
 * EventBroadcaster services. Keeps call-sites simple — they don't need to
 * write out `AppRuntime.runSync(Effect.flatMap(SessionPersistence, sp => ...))`.
 *
 * All heavy implementation lives in the Effect services; this module is just
 * a convenience façade for non-Effect callers.
 *
 * NOTE: AppRuntime is lazy-loaded to break circular module dependencies.
 * (effect-helpers → runtime → SdkQueryRunner → tool-permissions → effect-helpers)
 */

import { Effect } from "effect";
import { SessionPersistence } from "../effect/services/SessionPersistence";
import { EventBroadcaster } from "../effect/services/EventBroadcaster";

// Re-export channel constant and types so importers don't need multiple sources
export { DB_UPDATED_CHANNEL } from "../effect/services/EventBroadcaster";

export type DbEntity = "feature" | "phase" | "plan" | "agent_session";

export interface DbUpdateEvent {
  entity: DbEntity;
  featureId: number;
}

// ---------------------------------------------------------------------------
// Lazy AppRuntime loader — breaks the circular module-dependency chain
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _runtime: any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRuntime(): any {
  if (!_runtime) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _runtime = require("../effect/runtime").AppRuntime;
  }
  return _runtime!;
}

// ---------------------------------------------------------------------------
// Wrappers
// ---------------------------------------------------------------------------

/** Notify all renderer windows that data changed in the DB. */
export function notifyDbUpdated(entity: DbEntity, featureId: number): void {
  getRuntime().runSync(
    Effect.flatMap(EventBroadcaster, (eb) => eb.notifyDbUpdated(entity, featureId)),
  );
}

/** Get the session DB ID for a subprocess (returns undefined if not registered). */
export function getSessionDbId(subprocessId: string): number | undefined {
  const result = getRuntime().runSync(
    Effect.flatMap(SessionPersistence, (sp) => sp.getSessionDbId(subprocessId)),
  );
  return result ?? undefined;
}

/** Register a subprocess for session persistence tracking. */
export function registerSessionPersistence(
  subprocessId: string,
  sessionDbId: number,
): void {
  getRuntime().runSync(
    Effect.flatMap(SessionPersistence, (sp) => sp.registerSession(subprocessId, sessionDbId)),
  );
}

/**
 * Find the active subprocess ID for a given DB session ID.
 * Returns the subprocess ID if it's still in the session map, or undefined.
 */
export function getSubprocessIdForSession(sessionDbId: number): string | undefined {
  return getRuntime().runSync(
    Effect.flatMap(SessionPersistence, (sp) => sp.getSubprocessIdForSession(sessionDbId)),
  );
}

/**
 * Find subprocess IDs that are mapped to any of the given session DB IDs.
 * Used to stop running subprocesses when deleting a feature.
 */
export function getSubprocessIdsForSessionDbIds(sessionDbIds: number[]): string[] {
  return getRuntime().runSync(
    Effect.flatMap(SessionPersistence, (sp) => sp.getSubprocessIdsForSessionDbIds(sessionDbIds)),
  );
}
