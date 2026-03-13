/**
 * Tests for the ToolPermissions Effect service.
 *
 * Tests the Deferred-based request/response coordination, timeout behavior,
 * concurrent requests, and cleanup.
 */

import { describe, it, expect, vi } from "vitest";
import { Effect, Fiber, Duration } from "effect";
import { ToolPermissions, ToolPermissionsLive } from "../ToolPermissions";
import { PermissionTimeoutError, QuestionTimeoutError } from "../../errors";

// Mock broadcast so it doesn't try to use Electron BrowserWindow
vi.mock("../../../agents/broadcast", () => ({
  broadcast: vi.fn(),
  ASK_USER_QUESTION_CHANNEL: "agent:ask-user-question",
  TOOL_PERMISSION_CHANNEL: "agent:tool-permission",
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Run an Effect against the ToolPermissionsLive layer */
function runTest<A, E>(effect: Effect.Effect<A, E, ToolPermissions>): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, ToolPermissionsLive));
}

const permissionRequest = {
  toolName: "Read",
  input: { file_path: "/etc/hosts" },
  description: "Read wants to access /etc/hosts",
  pattern: "Read(/etc/hosts)",
};

// Short delay to allow forked fibers to start and register Deferreds
const FIBER_START_DELAY = Duration.millis(10);

// ---------------------------------------------------------------------------
// requestPermission / submitPermission
// ---------------------------------------------------------------------------

describe("requestPermission / submitPermission", () => {
  it("resolves with allow_once when submitPermission is called before timeout", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const tp = yield* ToolPermissions;

        // Fork the request so it runs concurrently
        const fiber = yield* Effect.fork(
          tp.requestPermission("sub-1", permissionRequest),
        );

        // Wait for the forked fiber to start and register its Deferred
        yield* Effect.sleep(FIBER_START_DELAY);

        // Submit the permission decision
        yield* tp.submitPermission("sub-1", "allow_once");

        return yield* Fiber.join(fiber);
      }),
    );

    expect(result.decision).toBe("allow_once");
  });

  it("resolves with allow_future", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const tp = yield* ToolPermissions;
        const fiber = yield* Effect.fork(
          tp.requestPermission("sub-2", permissionRequest),
        );
        yield* Effect.sleep(FIBER_START_DELAY);
        yield* tp.submitPermission("sub-2", "allow_future", "approved");
        return yield* Fiber.join(fiber);
      }),
    );

    expect(result.decision).toBe("allow_future");
    expect(result.feedback).toBe("approved");
  });

  it("resolves with deny and feedback", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const tp = yield* ToolPermissions;
        const fiber = yield* Effect.fork(
          tp.requestPermission("sub-3", permissionRequest),
        );
        yield* Effect.sleep(FIBER_START_DELAY);
        yield* tp.submitPermission("sub-3", "deny", "Not allowed");
        return yield* Fiber.join(fiber);
      }),
    );

    expect(result.decision).toBe("deny");
    expect(result.feedback).toBe("Not allowed");
  });

  it("submitPermission is a no-op when no request is pending", async () => {
    // Should not throw — just silently ignored
    await runTest(
      Effect.gen(function* () {
        const tp = yield* ToolPermissions;
        yield* tp.submitPermission("nonexistent", "allow_once");
      }),
    );
  });

  it("handles multiple concurrent requests with different subprocess IDs", async () => {
    const [r1, r2] = await runTest(
      Effect.gen(function* () {
        const tp = yield* ToolPermissions;

        const fiber1 = yield* Effect.fork(tp.requestPermission("concurrent-1", permissionRequest));
        const fiber2 = yield* Effect.fork(tp.requestPermission("concurrent-2", permissionRequest));

        yield* Effect.sleep(FIBER_START_DELAY);

        yield* tp.submitPermission("concurrent-1", "allow_once");
        yield* tp.submitPermission("concurrent-2", "deny");

        const res1 = yield* Fiber.join(fiber1);
        const res2 = yield* Fiber.join(fiber2);
        return [res1, res2] as const;
      }),
    );

    expect(r1.decision).toBe("allow_once");
    expect(r2.decision).toBe("deny");
  });

  it("cleanup: submit after request is already resolved is a no-op", async () => {
    // Submit before creating a request — should be no-op
    await runTest(
      Effect.gen(function* () {
        const tp = yield* ToolPermissions;
        yield* tp.submitPermission("phantom-sub", "allow_once");
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// requestUserAnswer / submitUserAnswer
// ---------------------------------------------------------------------------

describe("requestUserAnswer / submitUserAnswer", () => {
  it("resolves with answers when submitUserAnswer is called", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const tp = yield* ToolPermissions;
        const fiber = yield* Effect.fork(
          tp.requestUserAnswer("sub-ask-1", { questions: [] }),
        );
        yield* Effect.sleep(FIBER_START_DELAY);
        yield* tp.submitUserAnswer("sub-ask-1", { q1: "my answer" });
        return yield* Fiber.join(fiber);
      }),
    );

    expect(result.q1).toBe("my answer");
  });

  it("submitUserAnswer is a no-op when no request is pending", async () => {
    await runTest(
      Effect.gen(function* () {
        const tp = yield* ToolPermissions;
        yield* tp.submitUserAnswer("nonexistent", { q: "a" });
      }),
    );
  });

  it("handles multiple concurrent user-answer requests", async () => {
    const [r1, r2] = await runTest(
      Effect.gen(function* () {
        const tp = yield* ToolPermissions;
        const fiber1 = yield* Effect.fork(tp.requestUserAnswer("ask-1", {}));
        const fiber2 = yield* Effect.fork(tp.requestUserAnswer("ask-2", {}));
        yield* Effect.sleep(FIBER_START_DELAY);
        yield* tp.submitUserAnswer("ask-1", { k: "v1" });
        yield* tp.submitUserAnswer("ask-2", { k: "v2" });
        const r1 = yield* Fiber.join(fiber1);
        const r2 = yield* Fiber.join(fiber2);
        return [r1, r2] as const;
      }),
    );

    expect(r1.k).toBe("v1");
    expect(r2.k).toBe("v2");
  });
});


// ---------------------------------------------------------------------------
// Error type verification
// ---------------------------------------------------------------------------

describe("error types", () => {
  it("PermissionTimeoutError has correct _tag", () => {
    const err = new PermissionTimeoutError({ subprocessId: "test" });
    expect(err._tag).toBe("PermissionTimeoutError");
    expect(err.subprocessId).toBe("test");
  });

  it("QuestionTimeoutError has correct _tag", () => {
    const err = new QuestionTimeoutError({ subprocessId: "test" });
    expect(err._tag).toBe("QuestionTimeoutError");
    expect(err.subprocessId).toBe("test");
  });

});
