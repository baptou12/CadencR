import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before imports that use them
// ---------------------------------------------------------------------------

const mockSend = vi.fn();
const mockGetAllWindows = vi.fn(() => [
  { isDestroyed: () => false, webContents: { send: mockSend } },
]);

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => mockGetAllWindows() },
}));

import {
  EventBroadcaster,
  EventBroadcasterLive,
  AGENT_EVENT_CHANNEL,
  DB_UPDATED_CHANNEL,
} from "./EventBroadcaster.js";
import { SessionPersistence } from "./SessionPersistence.js";
import type { SessionPersistenceService } from "./SessionPersistence.js";

// ---------------------------------------------------------------------------
// Mock SessionPersistence service
// ---------------------------------------------------------------------------

const mockGetSessionDbIdFn = vi.fn((_id: string) => 99 as number | null);

function makeMockSessionPersistence(): SessionPersistenceService {
  return {
    getSessionDbId: (id: string) => Effect.sync(() => mockGetSessionDbIdFn(id)),
    persistStreamEvent: vi.fn(() => Effect.void),
    persistSessionStatus: vi.fn(() => Effect.void),
    persistClaudeSessionId: vi.fn(() => Effect.void),
    setSessionModel: vi.fn(() => Effect.void),
    updateTokenUsage: vi.fn(() => Effect.void),
    saveAllSessionStates: vi.fn(() => Effect.void),
    restoreSessionMap: vi.fn(() => Effect.void),
    registerSession: vi.fn(() => Effect.void),
    removeSession: vi.fn(() => Effect.void),
    getSubprocessIdForSession: vi.fn(() => Effect.succeed(undefined)),
    getSubprocessIdsForSessionDbIds: vi.fn(() => Effect.succeed([])),
  };
}

const MockSessionPersistenceLayer = Layer.succeed(
  SessionPersistence,
  makeMockSessionPersistence(),
);

const TestEventBroadcasterLayer = Layer.provide(
  EventBroadcasterLive,
  MockSessionPersistenceLayer,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runEB<A>(
  eff: Effect.Effect<A, unknown, EventBroadcaster>,
): A {
  return Effect.runSync(Effect.provide(eff, TestEventBroadcasterLayer));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EventBroadcaster service — EventBroadcasterLive", () => {
  beforeEach(() => {
    // Reset call history without losing implementations
    mockSend.mockClear();
    mockGetSessionDbIdFn.mockClear();
    mockGetSessionDbIdFn.mockImplementation((_id: string) => 99);
    // Re-establish window mock so clearAllMocks in global setup can't break it
    mockGetAllWindows.mockImplementation(() => [
      { isDestroyed: () => false, webContents: { send: mockSend } },
    ]);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // broadcastAgentEvent
  // ---------------------------------------------------------------------------

  describe("broadcastAgentEvent", () => {
    it("sends an AgentEvent on AGENT_EVENT_CHANNEL to all windows", () => {
      runEB(
        EventBroadcaster.broadcastAgentEvent("proc-1", "plan", {
          type: "error",
          error: { type: "sdk_error", message: "fail" },
        }),
      );

      expect(mockSend).toHaveBeenCalledOnce();
      const [channel, payload] = mockSend.mock.calls[0];
      expect(channel).toBe(AGENT_EVENT_CHANNEL);
      expect(payload.subprocessId).toBe("proc-1");
      expect(payload.agentType).toBe("plan");
      expect(payload.event.type).toBe("error");
    });

    it("includes sessionDbId from SessionPersistence service", () => {
      mockGetSessionDbIdFn.mockImplementation((_id: string) => 42);

      runEB(
        EventBroadcaster.broadcastAgentEvent("proc-2", "execute", {
          type: "agent_done",
          exitCode: 0,
        }),
      );

      const [, payload] = mockSend.mock.calls[0];
      expect(payload.sessionDbId).toBe(42);
    });

    it("includes parentToolUseId when provided", () => {
      runEB(
        EventBroadcaster.broadcastAgentEvent(
          "proc-3",
          "plan",
          { type: "agent_done", exitCode: 0 },
          "parent-tool-id",
        ),
      );

      const [, payload] = mockSend.mock.calls[0];
      expect(payload.parentToolUseId).toBe("parent-tool-id");
    });

    it("skips destroyed windows", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockGetAllWindows.mockReturnValue([{ isDestroyed: () => true, webContents: { send: mockSend } }] as any);

      runEB(
        EventBroadcaster.broadcastAgentEvent("proc-4", "session", {
          type: "agent_done",
          exitCode: 0,
        }),
      );

      expect(mockSend).not.toHaveBeenCalled();
    });

    it("sets sessionDbId to undefined when SessionPersistence returns null", () => {
      mockGetSessionDbIdFn.mockImplementation((_id: string) => null);

      runEB(
        EventBroadcaster.broadcastAgentEvent("proc-5", "plan", {
          type: "agent_done",
          exitCode: 0,
        }),
      );

      const [, payload] = mockSend.mock.calls[0];
      expect(payload.sessionDbId).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // notifyDbUpdated
  // ---------------------------------------------------------------------------

  describe("notifyDbUpdated", () => {
    it("sends a DB_UPDATED_CHANNEL message with entity and featureId", () => {
      runEB(
        EventBroadcaster.notifyDbUpdated("feature", 7),
      );

      expect(mockSend).toHaveBeenCalledOnce();
      const [channel, payload] = mockSend.mock.calls[0];
      expect(channel).toBe(DB_UPDATED_CHANNEL);
      expect(payload).toEqual({ entity: "feature", featureId: 7 });
    });
  });

  // ---------------------------------------------------------------------------
  // throttledNotify
  // ---------------------------------------------------------------------------

  describe("throttledNotify", () => {
    it("does not notify immediately", () => {
      runEB(
        EventBroadcaster.throttledNotify("session-key-1", 5),
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    // These four tests use ManagedRuntime (instead of runEB) so the Layer scope
    // stays open across vi.advanceTimersByTime — Layer.scoped's finalizer would
    // clear pending timers if the scope were closed before the assertion.

    it("notifies after 200ms", async () => {
      const runtime = ManagedRuntime.make(TestEventBroadcasterLayer);
      runtime.runSync(EventBroadcaster.throttledNotify("session-key-2", 5));
      vi.advanceTimersByTime(200);
      expect(mockSend).toHaveBeenCalledOnce();
      const [channel, payload] = mockSend.mock.calls[0];
      expect(channel).toBe(DB_UPDATED_CHANNEL);
      expect(payload).toEqual({ entity: "agent_session", featureId: 5 });
      await runtime.dispose();
    });

    it("coalesces multiple calls into a single notification", async () => {
      const runtime = ManagedRuntime.make(TestEventBroadcasterLayer);
      runtime.runSync(
        Effect.gen(function* () {
          yield* EventBroadcaster.throttledNotify("session-key-3", 10);
          yield* EventBroadcaster.throttledNotify("session-key-3", 10);
          yield* EventBroadcaster.throttledNotify("session-key-3", 10);
        }),
      );
      vi.advanceTimersByTime(200);
      // Should only send once despite 3 calls
      expect(mockSend).toHaveBeenCalledOnce();
      await runtime.dispose();
    });

    it("uses the latest featureId when coalescing", async () => {
      const runtime = ManagedRuntime.make(TestEventBroadcasterLayer);
      runtime.runSync(
        Effect.gen(function* () {
          yield* EventBroadcaster.throttledNotify("session-key-4", 1);
          yield* EventBroadcaster.throttledNotify("session-key-4", 99);
        }),
      );
      vi.advanceTimersByTime(200);
      const [, payload] = mockSend.mock.calls[0];
      expect(payload.featureId).toBe(99);
      await runtime.dispose();
    });

    it("allows separate session keys to fire independently", async () => {
      const runtime = ManagedRuntime.make(TestEventBroadcasterLayer);
      runtime.runSync(
        Effect.gen(function* () {
          yield* EventBroadcaster.throttledNotify("key-a", 1);
          yield* EventBroadcaster.throttledNotify("key-b", 2);
        }),
      );
      vi.advanceTimersByTime(200);
      expect(mockSend).toHaveBeenCalledTimes(2);
      await runtime.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // flushNotify
  // ---------------------------------------------------------------------------

  describe("flushNotify", () => {
    it("sends the pending notification immediately when flushed", () => {
      runEB(
        Effect.gen(function* () {
          yield* EventBroadcaster.throttledNotify("flush-key-1", 77);
          yield* EventBroadcaster.flushNotify("flush-key-1");
        }),
      );
      // Notification should have been sent synchronously (flush cancels the timer)
      expect(mockSend).toHaveBeenCalledOnce();
      const [channel, payload] = mockSend.mock.calls[0];
      expect(channel).toBe(DB_UPDATED_CHANNEL);
      expect(payload.featureId).toBe(77);
    });

    it("does NOT fire again after timer would have elapsed", () => {
      runEB(
        Effect.gen(function* () {
          yield* EventBroadcaster.throttledNotify("flush-key-2", 88);
          yield* EventBroadcaster.flushNotify("flush-key-2");
        }),
      );
      const countAfterFlush = mockSend.mock.calls.length;
      vi.advanceTimersByTime(200);
      // No additional calls after timer expires — timer was cancelled
      expect(mockSend.mock.calls.length).toBe(countAfterFlush);
    });

    it("is a no-op when there is no pending notification", () => {
      runEB(
        EventBroadcaster.flushNotify("nonexistent-key"),
      );
      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});
