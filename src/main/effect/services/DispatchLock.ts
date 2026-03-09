/**
 * DispatchLock Effect Service
 *
 * In-memory reentrant dispatch lock to prevent concurrent processNextPhase
 * calls for the same feature. Replaces module-level `dispatchingFeatures` Set
 * in execute-agent.ts.
 */

import { Context, Effect, Layer } from "effect";

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface DispatchLockService {
  /** Acquire the lock for a feature. Returns true if acquired, false if already held. */
  acquire: (featureId: number) => Effect.Effect<boolean>;

  /** Release the lock for a feature. */
  release: (featureId: number) => Effect.Effect<void>;

  /** Check if the lock is currently held for a feature. */
  isHeld: (featureId: number) => Effect.Effect<boolean>;
}

/** Context tag for the DispatchLock service */
export class DispatchLock extends Context.Tag("DispatchLock")<
  DispatchLock,
  DispatchLockService
>() {}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const DispatchLockLive = Layer.sync(DispatchLock, () => {
  const held = new Set<number>();

  return {
    acquire: (featureId: number) =>
      Effect.sync(() => {
        if (held.has(featureId)) return false;
        held.add(featureId);
        return true;
      }),

    release: (featureId: number) =>
      Effect.sync(() => {
        held.delete(featureId);
      }),

    isHeld: (featureId: number) =>
      Effect.sync(() => held.has(featureId)),
  };
});
