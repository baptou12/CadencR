import { Effect, Layer, ManagedRuntime } from "effect";
import { DatabaseLive } from "./services/Database.js";
import { PtyManagerLive } from "./services/PtyManager.js";
import { SessionPersistenceLive } from "./services/SessionPersistence.js";
import { EventBroadcasterLive } from "./services/EventBroadcaster.js";
import { CompletionActionsLive } from "./services/CompletionActions.js";
import { SdkQueryRunnerLive } from "./services/SdkQueryRunner.js";
import { SubprocessLifecycleLive } from "./services/SubprocessLifecycle.js";

// SessionPersistenceLive depends on Database, so we provide DatabaseLive to it
const SessionPersistenceWithDb = Layer.provide(SessionPersistenceLive, DatabaseLive);

// CompletionActionsLive depends on SessionPersistence and EventBroadcaster
const CompletionActionsWithDeps = Layer.provide(
  CompletionActionsLive,
  Layer.mergeAll(SessionPersistenceWithDb, EventBroadcasterLive),
);

// SdkQueryRunnerLive depends on SessionPersistence, EventBroadcaster, Database, CompletionActions
const SdkQueryRunnerWithDeps = Layer.provide(
  SdkQueryRunnerLive,
  Layer.mergeAll(
    SessionPersistenceWithDb,
    EventBroadcasterLive,
    DatabaseLive,
    CompletionActionsWithDeps,
  ),
);

// SubprocessLifecycleLive depends on SdkQueryRunner, SessionPersistence, EventBroadcaster, Database
const SubprocessLifecycleWithDeps = Layer.provide(
  SubprocessLifecycleLive,
  Layer.mergeAll(
    SdkQueryRunnerWithDeps,
    SessionPersistenceWithDb,
    EventBroadcasterLive,
    DatabaseLive,
  ),
);

export const AppLayer = Layer.mergeAll(
  DatabaseLive,
  PtyManagerLive,
  SessionPersistenceWithDb,
  EventBroadcasterLive,
  CompletionActionsWithDeps,
  SdkQueryRunnerWithDeps,
  SubprocessLifecycleWithDeps,
);

export const AppRuntime = ManagedRuntime.make(AppLayer);

export function runEffect<A, E>(
  effect: Effect.Effect<A, E, never>
): Promise<A> {
  return AppRuntime.runPromise(effect);
}

/**
 * Initialize the app's Effect ManagedRuntime.
 * Calling this warms up the runtime so that the first service access is fast.
 * Safe to call multiple times (subsequent calls are no-ops).
 */
export async function initRuntime(): Promise<void> {
  // Running a no-op effect forces the ManagedRuntime to build its internal
  // fiber runtime (lazy initialization).
  await AppRuntime.runPromise(Effect.void);
}

/**
 * Dispose the app's Effect ManagedRuntime.
 * This triggers finalizers for all scoped layers in reverse order:
 *   SubprocessLifecycle → SdkQueryRunner → CompletionActions →
 *   EventBroadcaster → SessionPersistence → PtyManager → Database
 *
 * Replaces the manual cleanup calls (killAllTerminalPtys, gracefulShutdown,
 * closeDatabase) at app shutdown.
 */
export async function disposeRuntime(): Promise<void> {
  await AppRuntime.dispose();
}
