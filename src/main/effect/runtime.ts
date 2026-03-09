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
