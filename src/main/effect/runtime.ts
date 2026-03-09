import { Effect, Layer, ManagedRuntime } from "effect";
import { DatabaseLive } from "./services/Database.js";
import { PtyManagerLive } from "./services/PtyManager.js";
import { SessionPersistenceLive } from "./services/SessionPersistence.js";
import { EventBroadcasterLive } from "./services/EventBroadcaster.js";

// SessionPersistenceLive depends on Database, so we provide DatabaseLive to it
const SessionPersistenceWithDb = Layer.provide(SessionPersistenceLive, DatabaseLive);

export const AppLayer = Layer.mergeAll(
  DatabaseLive,
  PtyManagerLive,
  SessionPersistenceWithDb,
  EventBroadcasterLive,
);

export const AppRuntime = ManagedRuntime.make(AppLayer);

export function runEffect<A, E>(
  effect: Effect.Effect<A, E, never>
): Promise<A> {
  return AppRuntime.runPromise(effect);
}
