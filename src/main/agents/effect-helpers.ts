/**
 * Thin synchronous wrappers around the Effect SessionPersistence and
 * EventBroadcaster services. Keeps call-sites simple — they don't need to
 * write out `AppRuntime.runSync(Effect.flatMap(SessionPersistence, sp => ...))`.
 *
 * All heavy implementation lives in the Effect services; this module is just
 * a convenience façade for non-Effect callers.
 *
 * The AppRuntime singleton lives in `effect/app-runtime-ref.ts` and is set
 * once during startup from src/main.ts, which breaks the circular
 * module-dependency chain (effect-helpers → runtime → SdkQueryRunner →
 * tool-permissions → effect-helpers).
 */

import { SessionPersistence } from "../effect/services/SessionPersistence";
import { EventBroadcaster } from "../effect/services/EventBroadcaster";
import { getAppRuntime } from "../effect/app-runtime-ref";

// Re-export channel constant and types so importers don't need multiple sources
export { DB_UPDATED_CHANNEL } from "../effect/services/EventBroadcaster";

export type DbEntity = "feature" | "phase" | "plan" | "agent_session";

export interface DbUpdateEvent {
  entity: DbEntity;
  featureId: number;
}

// ---------------------------------------------------------------------------
// Wrappers
// ---------------------------------------------------------------------------

/** Notify all renderer windows that data changed in the DB. */
export function notifyDbUpdated(entity: DbEntity, featureId: number): void {
  getAppRuntime().runSync(EventBroadcaster.notifyDbUpdated(entity, featureId));
}

/** Get the session DB ID for a subprocess (returns undefined if not registered). */
export function getSessionDbId(subprocessId: string): number | undefined {
  const result = getAppRuntime().runSync(SessionPersistence.getSessionDbId(subprocessId));
  return result ?? undefined;
}

/** Register a subprocess for session persistence tracking. */
export function registerSessionPersistence(
  subprocessId: string,
  sessionDbId: number,
): void {
  getAppRuntime().runSync(SessionPersistence.registerSession(subprocessId, sessionDbId));
}

/**
 * Find the active subprocess ID for a given DB session ID.
 * Returns the subprocess ID if it's still in the session map, or undefined.
 */
export function getSubprocessIdForSession(sessionDbId: number): string | undefined {
  return getAppRuntime().runSync(SessionPersistence.getSubprocessIdForSession(sessionDbId));
}

/**
 * Find subprocess IDs that are mapped to any of the given session DB IDs.
 * Used to stop running subprocesses when deleting a feature.
 */
export function getSubprocessIdsForSessionDbIds(sessionDbIds: number[]): string[] {
  return getAppRuntime().runSync(SessionPersistence.getSubprocessIdsForSessionDbIds(sessionDbIds));
}
