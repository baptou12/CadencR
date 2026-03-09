import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { DispatchLock, DispatchLockLive } from "./DispatchLock.js";

describe("DispatchLock", () => {
  it("acquire returns true on first call, false on second", () => {
    const layer = DispatchLockLive;
    const result = Effect.runSync(
      Effect.provide(
        Effect.gen(function* () {
          const dl = yield* DispatchLock;
          const first = yield* dl.acquire(1);
          const second = yield* dl.acquire(1);
          return { first, second };
        }),
        layer,
      ),
    );
    expect(result).toEqual({ first: true, second: false });
  });

  it("release allows re-acquire", () => {
    const layer = DispatchLockLive;
    const result = Effect.runSync(
      Effect.provide(
        Effect.gen(function* () {
          const dl = yield* DispatchLock;
          yield* dl.acquire(1);
          yield* dl.release(1);
          return yield* dl.acquire(1);
        }),
        layer,
      ),
    );
    expect(result).toBe(true);
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
    const result = Effect.runSync(
      Effect.provide(
        Effect.gen(function* () {
          const dl = yield* DispatchLock;
          yield* dl.acquire(1);
          const canAcquire2 = yield* dl.acquire(2);
          const canAcquire1Again = yield* dl.acquire(1);
          return { canAcquire2, canAcquire1Again };
        }),
        layer,
      ),
    );
    expect(result).toEqual({ canAcquire2: true, canAcquire1Again: false });
  });
});
