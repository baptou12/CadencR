import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { CompletionActions, CompletionActionsLive } from "./CompletionActions.js";
import { SessionPersistence, type SessionPersistenceService } from "./SessionPersistence.js";
import { EventBroadcaster, type EventBroadcasterService } from "./EventBroadcaster.js";
import { Database } from "./Database.js";
import { DatabaseError } from "../errors.js";
import type { ManagedSubprocess } from "../../agents/types.js";

// ---------------------------------------------------------------------------
// Mock SessionPersistence service
// ---------------------------------------------------------------------------

const mockPersistSessionStatus = vi.fn<SessionPersistenceService["persistSessionStatus"]>(() => Effect.void);
const mockPersistClaudeSessionId = vi.fn<SessionPersistenceService["persistClaudeSessionId"]>(() => Effect.void);
const mockPersistStreamEvent = vi.fn<SessionPersistenceService["persistStreamEvent"]>(() => Effect.void);
const mockGetSessionDbId = vi.fn<SessionPersistenceService["getSessionDbId"]>(() => Effect.succeed(null));
const mockFlushNotify = vi.fn<EventBroadcasterService["flushNotify"]>(() => Effect.void);
const mockBroadcastAgentEvent = vi.fn<EventBroadcasterService["broadcastAgentEvent"]>(() => Effect.void);
const mockThrottledNotify = vi.fn<EventBroadcasterService["throttledNotify"]>(() => Effect.void);
const mockNotifyDbUpdated = vi.fn<EventBroadcasterService["notifyDbUpdated"]>(() => Effect.void);
const mockDbExecute = vi.fn((..._args: unknown[]) => Effect.succeed({ changes: 1, lastInsertRowid: 0 }));
const mockDbQueryOne = vi.fn((..._args: unknown[]) => Effect.succeed(null));
const mockDbQueryAll = vi.fn((..._args: unknown[]) => Effect.succeed([]));

const mockSPService: SessionPersistenceService = {
  persistStreamEvent: mockPersistStreamEvent,
  persistSessionStatus: mockPersistSessionStatus,
  persistClaudeSessionId: mockPersistClaudeSessionId,
  setSessionModel: vi.fn(() => Effect.void),
  updateTokenUsage: vi.fn(() => Effect.void),
  saveAllSessionStates: vi.fn(() => Effect.void),
  getSessionDbId: mockGetSessionDbId,
  restoreSessionMap: vi.fn(() => Effect.void),
  registerSession: vi.fn(() => Effect.void),
  removeSession: vi.fn(() => Effect.void),
  getSubprocessIdForSession: vi.fn(() => Effect.succeed(undefined)),
  getSubprocessIdsForSessionDbIds: vi.fn(() => Effect.succeed([])),
};

const mockEBService: EventBroadcasterService = {
  broadcastAgentEvent: mockBroadcastAgentEvent,
  notifyDbUpdated: mockNotifyDbUpdated,
  throttledNotify: mockThrottledNotify,
  flushNotify: mockFlushNotify,
};

const MockSessionPersistence = Layer.succeed(SessionPersistence, mockSPService);
const MockEventBroadcaster = Layer.succeed(EventBroadcaster, mockEBService);
const MockDatabase = Layer.succeed(Database, {
  execute: (sql, ...params) => mockDbExecute(sql, ...params),
  queryOne: (sql, ...params) => mockDbQueryOne(sql, ...params),
  queryAll: (sql, ...params) => mockDbQueryAll(sql, ...params),
  queryOneValidated: vi.fn(),
  queryAllValidated: vi.fn(),
});

const TestLayer = Layer.provide(
  CompletionActionsLive,
  Layer.mergeAll(MockSessionPersistence, MockEventBroadcaster, MockDatabase),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runCA<A>(
  eff: Effect.Effect<A, unknown, CompletionActions>,
): Promise<A> {
  return Effect.runPromise(Effect.provide(eff, TestLayer));
}

function makeManagedSubprocess(
  overrides: Partial<ManagedSubprocess> = {},
): ManagedSubprocess {
  return {
    id: "test-subprocess-1",
    agentType: "plan",
    startedAt: new Date(),
    status: "running",
    eventListeners: [],
    completionListeners: [],
    cachedPermissions: new Set<string>(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CompletionActions service — CompletionActionsLive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks return successful Effects
    mockPersistSessionStatus.mockReturnValue(Effect.void);
    mockPersistClaudeSessionId.mockReturnValue(Effect.void);
    mockPersistStreamEvent.mockReturnValue(Effect.void);
    mockGetSessionDbId.mockReturnValue(Effect.succeed(null));
    mockFlushNotify.mockReturnValue(Effect.void);
    mockBroadcastAgentEvent.mockReturnValue(Effect.void);
    mockDbExecute.mockReturnValue(Effect.succeed({ changes: 1, lastInsertRowid: 0 }));
    mockDbQueryOne.mockReturnValue(Effect.succeed(null));
    mockDbQueryAll.mockReturnValue(Effect.succeed([]));
  });

  // -------------------------------------------------------------------------
  // onCompleted
  // -------------------------------------------------------------------------

  describe("onCompleted", () => {
    it("sets managed.status to 'completed'", async () => {
      const managed = makeManagedSubprocess({ status: "running" });

      await runCA(
        CompletionActions.onCompleted(managed),
      );

      expect(managed.status).toBe("completed");
    });

    it("persists 'completed' status to DB", async () => {
      const managed = makeManagedSubprocess();

      await runCA(
        CompletionActions.onCompleted(managed, "sdk-session-id"),
      );

      expect(mockPersistSessionStatus).toHaveBeenCalledWith(
        managed.id,
        "completed",
        "sdk-session-id",
      );
    });

    it("flushes pending throttled notification", async () => {
      const managed = makeManagedSubprocess();

      await runCA(
        CompletionActions.onCompleted(managed),
      );

      expect(mockFlushNotify).toHaveBeenCalledWith(managed.id);
    });

    it("calls all completion listeners with exit code 0", async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const managed = makeManagedSubprocess({
        completionListeners: [listener1, listener2],
      });

      await runCA(
        CompletionActions.onCompleted(managed),
      );

      expect(listener1).toHaveBeenCalledWith(0);
      expect(listener2).toHaveBeenCalledWith(0);
    });

    it("broadcasts agent_done event with exitCode 0", async () => {
      const managed = makeManagedSubprocess({ agentType: "execute" });

      await runCA(
        CompletionActions.onCompleted(managed),
      );

      expect(mockBroadcastAgentEvent).toHaveBeenCalledWith(
        managed.id,
        "execute",
        { type: "agent_done", exitCode: 0 },
      );
    });

    it("continues even if DB persistence fails", async () => {
      mockPersistSessionStatus.mockReturnValue(
        Effect.fail(new DatabaseError({ operation: "execute", cause: new Error("DB fail") })),
      );
      const managed = makeManagedSubprocess();

      // Should not throw
      await expect(
        runCA(
          CompletionActions.onCompleted(managed),
        ),
      ).resolves.toBeUndefined();

      // Should still broadcast even after DB failure
      expect(mockBroadcastAgentEvent).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // onPaused
  // -------------------------------------------------------------------------

  describe("onPaused", () => {
    it("flushes pending throttled notification", async () => {
      const managed = makeManagedSubprocess({ status: "paused" });

      await runCA(
        CompletionActions.onPaused(managed),
      );

      expect(mockFlushNotify).toHaveBeenCalledWith(managed.id);
    });

    it("calls all completion listeners with exit code 2 (paused)", async () => {
      const listener = vi.fn();
      const managed = makeManagedSubprocess({
        status: "paused",
        completionListeners: [listener],
      });

      await runCA(
        CompletionActions.onPaused(managed),
      );

      expect(listener).toHaveBeenCalledWith(2);
    });

    it("broadcasts agent_paused event", async () => {
      const managed = makeManagedSubprocess({ status: "paused", agentType: "session" });

      await runCA(
        CompletionActions.onPaused(managed),
      );

      expect(mockBroadcastAgentEvent).toHaveBeenCalledWith(
        managed.id,
        "session",
        { type: "agent_paused" },
      );
    });

    it("does NOT persist status (pauseSubprocess already persists it)", async () => {
      const managed = makeManagedSubprocess({ status: "paused" });

      await runCA(
        CompletionActions.onPaused(managed),
      );

      expect(mockPersistSessionStatus).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // onStopped
  // -------------------------------------------------------------------------

  describe("onStopped", () => {
    it("persists 'completed' status to DB (stopped → completed)", async () => {
      const managed = makeManagedSubprocess({ status: "stopped" });

      await runCA(
        CompletionActions.onStopped(managed, "sdk-session-xyz"),
      );

      expect(mockPersistSessionStatus).toHaveBeenCalledWith(
        managed.id,
        "completed",
        "sdk-session-xyz",
      );
    });

    it("flushes pending throttled notification", async () => {
      const managed = makeManagedSubprocess({ status: "stopped" });

      await runCA(
        CompletionActions.onStopped(managed),
      );

      expect(mockFlushNotify).toHaveBeenCalledWith(managed.id);
    });

    it("calls all completion listeners with exit code 1", async () => {
      const listener = vi.fn();
      const managed = makeManagedSubprocess({
        status: "stopped",
        completionListeners: [listener],
      });

      await runCA(
        CompletionActions.onStopped(managed),
      );

      expect(listener).toHaveBeenCalledWith(1);
    });

    it("broadcasts agent_done event with exitCode 1", async () => {
      const managed = makeManagedSubprocess({ status: "stopped", agentType: "prd" });

      await runCA(
        CompletionActions.onStopped(managed),
      );

      expect(mockBroadcastAgentEvent).toHaveBeenCalledWith(
        managed.id,
        "prd",
        { type: "agent_done", exitCode: 1 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // onError
  // -------------------------------------------------------------------------

  describe("onError", () => {
    it("sets managed.status to 'error'", async () => {
      const managed = makeManagedSubprocess({ status: "running" });

      await runCA(
        CompletionActions.onError(managed, new Error("SDK failed")),
      );

      expect(managed.status).toBe("error");
    });

    it("persists 'error' status to DB", async () => {
      const managed = makeManagedSubprocess({ status: "running" });

      await runCA(
        CompletionActions.onError(managed, new Error("boom")),
      );

      expect(mockPersistSessionStatus).toHaveBeenCalledWith(managed.id, "error");
    });

    it("broadcasts error event with the error message", async () => {
      const managed = makeManagedSubprocess({ status: "running", agentType: "execute" });
      const error = new Error("SDK query failed");

      await runCA(
        CompletionActions.onError(managed, error),
      );

      expect(mockBroadcastAgentEvent).toHaveBeenCalledWith(
        managed.id,
        "execute",
        expect.objectContaining({
          type: "error",
          error: expect.objectContaining({ message: "SDK query failed" }),
        }),
      );
    });

    it("broadcasts agent_done with exitCode 1 after error", async () => {
      const managed = makeManagedSubprocess({ status: "running" });

      await runCA(
        CompletionActions.onError(managed, new Error("fail")),
      );

      expect(mockBroadcastAgentEvent).toHaveBeenCalledWith(
        managed.id,
        "plan",
        { type: "agent_done", exitCode: 1 },
      );
    });

    it("calls all completion listeners with exit code 1", async () => {
      const listener = vi.fn();
      const managed = makeManagedSubprocess({
        completionListeners: [listener],
      });

      await runCA(
        CompletionActions.onError(managed, new Error("fail")),
      );

      expect(listener).toHaveBeenCalledWith(1);
    });

    it("persists error event to DB when sessionDbId is available", async () => {
      mockGetSessionDbId.mockReturnValue(Effect.succeed(55));
      const managed = makeManagedSubprocess({ status: "running" });

      await runCA(
        CompletionActions.onError(managed, new Error("some error")),
      );

      expect(mockPersistStreamEvent).toHaveBeenCalledWith(
        55,
        expect.objectContaining({
          type: "error",
          error: expect.objectContaining({ type: "sdk_error", message: "some error" }),
        }),
      );
    });

    // Resume failure recovery
    describe("resume failure recovery", () => {
      it("does NOT persist 'error' status when resumingFromSessionId is set", async () => {
        const managed = makeManagedSubprocess({
          resumingFromSessionId: "original-session-id",
        });

        await runCA(
          CompletionActions.onError(managed, new Error("resume failed")),
        );

        expect(mockPersistSessionStatus).not.toHaveBeenCalled();
      });

      it("restores the original claude_session_id when resume fails and sessionDbId is available", async () => {
        mockGetSessionDbId.mockReturnValue(Effect.succeed(42));
        const managed = makeManagedSubprocess({
          resumingFromSessionId: "original-claude-session",
        });

        await runCA(
          CompletionActions.onError(managed, new Error("resume failed")),
        );

        expect(mockPersistClaudeSessionId).toHaveBeenCalledWith(
          42,
          "original-claude-session",
        );
      });

      it("uses a user-friendly error message for resume failures", async () => {
        const managed = makeManagedSubprocess({
          resumingFromSessionId: "original-session-id",
        });
        const error = new Error("Connection refused");

        await runCA(
          CompletionActions.onError(managed, error),
        );

        expect(mockBroadcastAgentEvent).toHaveBeenCalledWith(
          managed.id,
          "plan",
          expect.objectContaining({
            type: "error",
            error: expect.objectContaining({
              message: expect.stringContaining("Failed to resume session"),
            }),
          }),
        );
      });

      it("still sets managed.status to 'error' after resume failure", async () => {
        const managed = makeManagedSubprocess({
          resumingFromSessionId: "some-session",
        });

        await runCA(
          CompletionActions.onError(managed, new Error("resume failed")),
        );

        expect(managed.status).toBe("error");
      });
    });
  });
});
