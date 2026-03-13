import { describe, it, expect } from "vitest";
import { Effect, Exit } from "effect";
import { DispatchLock, DispatchLockLive } from "./DispatchLock.js";

describe("DispatchLock", () => {
  it("acquire succeeds on first call, fails with DispatchConflictError on second", () => {
    const layer = DispatchLockLive;
    const exit = Effect.runSyncExit(
      Effect.provide(
        Effect.gen(function* () {
          const dl = yield* DispatchLock;
          yield* dl.acquire(1);
          // Second acquire should fail
          yield* dl.acquire(1);
        }),
        layer,
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("release allows re-acquire", () => {
    const layer = DispatchLockLive;
    // Should not throw — acquire after release should succeed
    Effect.runSync(
      Effect.provide(
        Effect.gen(function* () {
          const dl = yield* DispatchLock;
          yield* dl.acquire(1);
          yield* dl.release(1);
          yield* dl.acquire(1);
        }),
        layer,
      ),
    );
  });

  it("isHeld reflects lock state", () => {
    const layer = DispatchLockLive;
    const result = Effect.runSync(
      Effect.provide(
        Effect.gen(function* () {
          const dl = yield* DispatchLock;
          const before = yield* dl.isHeld(1);
          yield* dl.acquire(1);
          const during = yield* dl.isHeld(1);
          yield* dl.release(1);
          const after = yield* dl.isHeld(1);
          return { before, during, after };
        }),
        layer,
      ),
    );
    expect(result).toEqual({ before: false, during: true, after: false });
  });

  it("locks are independent per feature", () => {
    const layer = DispatchLockLive;
    // Feature 1 locked, feature 2 should still be acquirable
    Effect.runSync(
      Effect.provide(
        Effect.gen(function* () {
          const dl = yield* DispatchLock;
          yield* dl.acquire(1);
          yield* dl.acquire(2); // Should succeed — different feature
        }),
        layer,
      ),
    );
  });

  it("acquire fails with correct tag for catchTag usage", () => {
    const layer = DispatchLockLive;
    const result = Effect.runSync(
      Effect.provide(
        Effect.gen(function* () {
          const dl = yield* DispatchLock;
          yield* dl.acquire(42);
          return yield* dl.acquire(42).pipe(
            Effect.map(() => "acquired" as const),
            Effect.catchTag("DispatchConflictError", (e) =>
              Effect.succeed(`conflict:${e.featureId}` as const),
            ),
          );
        }),
        layer,
      ),
    );
    expect(result).toBe("conflict:42");
  });
});
