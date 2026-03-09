/**
 * lifecycle.test.ts — Unit tests for Effect ManagedRuntime lifecycle
 *
 * These tests verify:
 *  1. The runtime initializes services in correct order
 *  2. Disposal cleans up in reverse order
 *  3. Disposal handles errors gracefully (one failing finalizer doesn't block others)
 *
 * We use mock layers rather than AppLayer directly to avoid needing Electron,
 * SQLite, and other native dependencies.
 */

import { describe, it, expect } from "vitest";
import { Context, Effect, Layer, ManagedRuntime } from "effect";

// ---------------------------------------------------------------------------
// Test helpers — minimal service tags and layer factories
// ---------------------------------------------------------------------------

/** Simple tag for a service that tracks its init/dispose sequence */
class ServiceA extends Context.Tag("TestServiceA")<ServiceA, { name: string }>() {}
class ServiceB extends Context.Tag("TestServiceB")<ServiceB, { name: string }>() {}
class ServiceC extends Context.Tag("TestServiceC")<ServiceC, { name: string }>() {}

/**
 * Create a scoped layer that pushes its name to `initOrder` on acquire
 * and to `disposeOrder` on release.
 */
function makeTrackedLayer<I, S extends { name: string }>(
  tag: Context.Tag<I, S>,
  name: string,
  initOrder: string[],
  disposeOrder: string[],
): Layer.Layer<I> {
  return Layer.scoped(
    tag,
    Effect.acquireRelease(
      Effect.sync(() => {
        initOrder.push(name);
        return { name } as S;
      }),
      (_svc) =>
        Effect.sync(() => {
          disposeOrder.push(name);
        }),
    ),
  );
}

/**
 * Create a scoped layer whose finalizer throws an error, then pushes to the
 * disposeOrder array to confirm subsequent finalizers still run.
 */
function makeFailingFinalizer<I, S extends { name: string }>(
  tag: Context.Tag<I, S>,
  name: string,
  initOrder: string[],
  disposeOrder: string[],
): Layer.Layer<I> {
  return Layer.scoped(
    tag,
    Effect.acquireRelease(
      Effect.sync(() => {
        initOrder.push(name);
        return { name } as S;
      }),
      (_svc) =>
        Effect.sync(() => {
          disposeOrder.push(`${name}:error`);
          throw new Error(`${name} finalizer failed`);
        }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Effect ManagedRuntime lifecycle", () => {
  describe("service initialization", () => {
    it("builds all layers when the first effect is run", async () => {
      const initOrder: string[] = [];
      const disposeOrder: string[] = [];

      const LayerA = makeTrackedLayer(ServiceA, "A", initOrder, disposeOrder);
      const LayerB = makeTrackedLayer(ServiceB, "B", initOrder, disposeOrder);

      const TestLayer = Layer.mergeAll(LayerA, LayerB);
      const runtime = ManagedRuntime.make(TestLayer);

      // Before running any effect, layers are not yet initialized
      expect(initOrder).toEqual([]);

      // Run a no-op to trigger lazy initialization
      await runtime.runPromise(Effect.void);

      // Both services should now be initialized
      expect(initOrder).toHaveLength(2);
      expect(initOrder).toContain("A");
      expect(initOrder).toContain("B");

      await runtime.dispose();

      // Cleanup
      expect(disposeOrder).toHaveLength(2);
      expect(disposeOrder).toContain("A");
      expect(disposeOrder).toContain("B");
    });

    it("allows dependent layers to be initialized in dependency order", async () => {
      const initOrder: string[] = [];
      const disposeOrder: string[] = [];

      const LayerA = makeTrackedLayer(ServiceA, "A", initOrder, disposeOrder);
      // B depends on A
      const LayerB = Layer.scoped(
        ServiceB,
        Effect.acquireRelease(
          Effect.flatMap(ServiceA, (a) =>
            Effect.sync(() => {
              initOrder.push("B-after-" + a.name);
              return { name: "B" };
            }),
          ),
          (_svc) =>
            Effect.sync(() => {
              disposeOrder.push("B");
            }),
        ),
      );

      const TestLayer = Layer.provide(LayerB, LayerA);
      const runtime = ManagedRuntime.make(TestLayer);

      await runtime.runPromise(Effect.void);

      // A must be initialized before B
      expect(initOrder[0]).toBe("A");
      expect(initOrder[1]).toBe("B-after-A");

      await runtime.dispose();
    });
  });

  describe("disposal", () => {
    it("disposes all layers when dispose() is called", async () => {
      const initOrder: string[] = [];
      const disposeOrder: string[] = [];

      const LayerA = makeTrackedLayer(ServiceA, "A", initOrder, disposeOrder);
      const LayerB = makeTrackedLayer(ServiceB, "B", initOrder, disposeOrder);
      const LayerC = makeTrackedLayer(ServiceC, "C", initOrder, disposeOrder);

      const TestLayer = Layer.mergeAll(LayerA, LayerB, LayerC);
      const runtime = ManagedRuntime.make(TestLayer);

      await runtime.runPromise(Effect.void);
      expect(initOrder).toHaveLength(3);

      await runtime.dispose();

      // All three should be disposed
      expect(disposeOrder).toHaveLength(3);
      expect(disposeOrder).toContain("A");
      expect(disposeOrder).toContain("B");
      expect(disposeOrder).toContain("C");
    });

    it("disposes layers in reverse initialization order for sequential dependencies", async () => {
      const initOrder: string[] = [];
      const disposeOrder: string[] = [];

      // A is a base layer, B depends on A (initialized after A, disposed before A)
      const LayerA = makeTrackedLayer(ServiceA, "A", initOrder, disposeOrder);
      const LayerBRaw = makeTrackedLayer(ServiceB, "B", initOrder, disposeOrder);
      const LayerB = Layer.provide(LayerBRaw, LayerA);

      const TestLayer = Layer.mergeAll(LayerA, LayerB);
      const runtime = ManagedRuntime.make(TestLayer);

      await runtime.runPromise(Effect.void);
      await runtime.dispose();

      // B (dependent) should be disposed before A (dependency)
      const aIdx = disposeOrder.indexOf("A");
      const bIdx = disposeOrder.indexOf("B");
      expect(bIdx).toBeLessThan(aIdx);
    });

    it("handles errors in finalizers — other finalizers still run, error is surfaced", async () => {
      const initOrder: string[] = [];
      const disposeOrder: string[] = [];

      const LayerA = makeTrackedLayer(ServiceA, "A", initOrder, disposeOrder);
      // B has a failing finalizer
      const LayerBRaw = makeFailingFinalizer(ServiceB, "B", initOrder, disposeOrder);
      const LayerCRaw = makeTrackedLayer(ServiceC, "C", initOrder, disposeOrder);

      // Build them as independent layers merged together
      const TestLayer = Layer.mergeAll(LayerA, LayerBRaw, LayerCRaw);
      const runtime = ManagedRuntime.make(TestLayer);

      await runtime.runPromise(Effect.void);
      expect(initOrder).toHaveLength(3);

      // Effect surfaces finalizer errors — the Promise rejects, but all finalizers
      // still run before the rejection (Effect runs all finalizers even on error).
      let disposeError: unknown;
      try {
        await runtime.dispose();
      } catch (e) {
        disposeError = e;
      }

      // B's failing finalizer should have propagated
      expect(disposeError).toBeDefined();

      // A and C should still have been disposed despite B failing
      expect(disposeOrder).toContain("A");
      expect(disposeOrder).toContain("C");
      expect(disposeOrder).toContain("B:error"); // B attempted disposal
    });

    it("dispose() is idempotent — calling it twice does not throw", async () => {
      const initOrder: string[] = [];
      const disposeOrder: string[] = [];

      const LayerA = makeTrackedLayer(ServiceA, "A", initOrder, disposeOrder);
      const runtime = ManagedRuntime.make(LayerA);

      await runtime.runPromise(Effect.void);
      await runtime.dispose();

      // Second dispose should not throw
      await expect(runtime.dispose()).resolves.not.toThrow();

      // Finalizer should only run once
      expect(disposeOrder.filter((n) => n === "A")).toHaveLength(1);
    });
  });

  describe("initRuntime / disposeRuntime wrapper semantics", () => {
    it("initRuntime warms up the runtime so services are ready", async () => {
      const initOrder: string[] = [];
      const disposeOrder: string[] = [];

      const LayerA = makeTrackedLayer(ServiceA, "A", initOrder, disposeOrder);
      const runtime = ManagedRuntime.make(LayerA);

      // Simulate initRuntime: run a no-op to force layer construction
      await runtime.runPromise(Effect.void);
      expect(initOrder).toContain("A");

      await runtime.dispose();
    });

    it("disposeRuntime resolves after all finalizers complete", async () => {
      const disposeOrder: string[] = [];
      const initOrder: string[] = [];
      const calls: string[] = [];

      const LayerA = Layer.scoped(
        ServiceA,
        Effect.acquireRelease(
          Effect.sync(() => {
            initOrder.push("A");
            return { name: "A" };
          }),
          (_svc) =>
            Effect.sync(() => {
              disposeOrder.push("A");
              calls.push("finalizer-ran");
            }),
        ),
      );

      const runtime = ManagedRuntime.make(LayerA);
      await runtime.runPromise(Effect.void);

      // Simulate disposeRuntime()
      await runtime.dispose();

      // Confirm finalizer ran before the awaited promise settled
      expect(calls).toContain("finalizer-ran");
      expect(disposeOrder).toContain("A");
    });
  });
});
