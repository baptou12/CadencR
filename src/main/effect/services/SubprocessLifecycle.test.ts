import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import {
  SubprocessLifecycle,
  SubprocessLifecycleLive,
} from "./SubprocessLifecycle.js";
import { SdkQueryRunner } from "./SdkQueryRunner.js";
import { SessionPersistence, type SessionPersistenceService } from "./SessionPersistence.js";
import { EventBroadcaster, type EventBroadcasterService } from "./EventBroadcaster.js";
import { Database } from "./Database.js";
import type { ManagedSubprocess, SubprocessOptions } from "../../agents/types.js";

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

vi.mock("../../agents/permissions", () => ({
  loadAllowedPatterns: vi.fn(() => new Set<string>()),
}));

vi.mock("../../agents/models", () => ({
  DEFAULT_MODEL: "claude-3-5-sonnet-20241022",
  resolveModel: vi.fn(() => undefined),
}));

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------

const mockSdkExecute = vi.fn(() => Effect.void);

const MockSdkQueryRunner = Layer.succeed(SdkQueryRunner, {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: mockSdkExecute as any,
});

const mockSPGetSessionDbId = vi.fn(() => Effect.succeed<number | null>(null));
const mockSPSaveAllSessionStates = vi.fn(() => Effect.void);
const mockSPPersistClaudeSessionId = vi.fn(() => Effect.void);

const mockSPService: SessionPersistenceService = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSessionDbId: mockSPGetSessionDbId as any,
  saveAllSessionStates: mockSPSaveAllSessionStates,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  persistClaudeSessionId: mockSPPersistClaudeSessionId as any,
  persistStreamEvent: vi.fn(() => Effect.void),
  persistSessionStatus: vi.fn(() => Effect.void),
  setSessionModel: vi.fn(() => Effect.void),
  updateTokenUsage: vi.fn(() => Effect.void),
  restoreSessionMap: vi.fn(() => Effect.void),
  registerSession: vi.fn(() => Effect.void),
  removeSession: vi.fn(() => Effect.void),
};

const MockSessionPersistence = Layer.succeed(SessionPersistence, mockSPService);

const mockEBBroadcastAgentEvent = vi.fn(() => Effect.void);
const mockEBFlushNotify = vi.fn(() => Effect.void);
const mockEBNotifyDbUpdated = vi.fn(() => Effect.void);
const mockEBThrottledNotify = vi.fn(() => Effect.void);

const mockEBService: EventBroadcasterService = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  broadcastAgentEvent: mockEBBroadcastAgentEvent as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  notifyDbUpdated: mockEBNotifyDbUpdated as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  throttledNotify: mockEBThrottledNotify as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flushNotify: mockEBFlushNotify as any,
};

const MockEventBroadcaster = Layer.succeed(EventBroadcaster, mockEBService);

const mockDBExecute = vi.fn(() => Effect.succeed({ changes: 1, lastInsertRowid: 0 }));
const mockDBQueryOne = vi.fn(() => Effect.succeed(null));
const mockDBQueryAll = vi.fn(() => Effect.succeed([]));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockDatabase = Layer.succeed(Database, {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: mockDBExecute as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryOne: mockDBQueryOne as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryAll: mockDBQueryAll as any,
  queryOneValidated: vi.fn(() => Effect.succeed(null)),
  queryAllValidated: vi.fn(() => Effect.succeed([])),
});

const TestLayer = Layer.provide(
  SubprocessLifecycleLive,
  Layer.mergeAll(
    MockSdkQueryRunner,
    MockSessionPersistence,
    MockEventBroadcaster,
    MockDatabase,
  ),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run an Effect within the SubprocessLifecycle test scope.
 * All operations in a single test should be in ONE runSL call to share state.
 */
function runSL<A>(
  eff: Effect.Effect<A, unknown, SubprocessLifecycle>,
): Promise<A> {
  return Effect.runPromise(Effect.provide(eff, TestLayer));
}

function makeOptions(overrides: Partial<SubprocessOptions> = {}): SubprocessOptions {
  return {
    cwd: "/some/project",
    agentType: "plan",
    prompt: "Hello, world!",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SubprocessLifecycle service — SubprocessLifecycleLive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSdkExecute.mockReturnValue(Effect.void);
    mockSPGetSessionDbId.mockReturnValue(Effect.succeed(null));
    mockSPSaveAllSessionStates.mockReturnValue(Effect.void);
    mockSPPersistClaudeSessionId.mockReturnValue(Effect.void);
    mockEBBroadcastAgentEvent.mockReturnValue(Effect.void);
    mockEBFlushNotify.mockReturnValue(Effect.void);
    mockEBNotifyDbUpdated.mockReturnValue(Effect.void);
    mockDBExecute.mockReturnValue(Effect.succeed({ changes: 1, lastInsertRowid: 0 }));
    mockDBQueryOne.mockReturnValue(Effect.succeed(null));
  });

  // -------------------------------------------------------------------------
  // start
  // -------------------------------------------------------------------------

  describe("start", () => {
    it("creates a managed subprocess with correct fields", async () => {
      const options = makeOptions({ agentType: "plan" });

      // Capture a snapshot WITHIN the Effect before the scope closes and
      // the finalizer kills running subprocesses (which would mutate status).
      const snapshot = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(options);
          return {
            agentType: m.agentType,
            status: m.status,
            id: m.id,
            startedAt: m.startedAt,
            hasAbortController: m.abortController instanceof AbortController,
            eventListeners: m.eventListeners,
            completionListeners: m.completionListeners,
          };
        }),
      );

      expect(snapshot.agentType).toBe("plan");
      expect(snapshot.status).toBe("running");
      expect(snapshot.id).toMatch(/^agent-\d+-\d+$/);
      expect(snapshot.startedAt).toBeInstanceOf(Date);
      expect(snapshot.hasAbortController).toBe(true);
      expect(snapshot.eventListeners).toEqual([]);
      expect(snapshot.completionListeners).toEqual([]);
    });

    it("uses pre-generated id if provided in options", async () => {
      const options = makeOptions({ id: "pre-generated-id" });

      const managed = await runSL(
        Effect.flatMap(SubprocessLifecycle, (svc) => svc.start(options)),
      );

      expect(managed.id).toBe("pre-generated-id");
    });

    it("adds subprocess to active map (visible via getActive)", async () => {
      const options = makeOptions();

      // Both operations must be in the same runSL to share the service instance
      const [managed, found] = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(options);
          const f = yield* svc.getActive(m.id);
          return [m, f] as const;
        }),
      );

      expect(found).toBe(managed);
    });

    it("calls SdkQueryRunner.execute (fires off SDK query)", async () => {
      const options = makeOptions();

      await runSL(
        Effect.flatMap(SubprocessLifecycle, (svc) => svc.start(options)),
      );

      // Give the forked fiber a tick to run
      await new Promise((r) => setTimeout(r, 10));

      expect(mockSdkExecute).toHaveBeenCalled();
    });

    it("lists the started subprocess via list()", async () => {
      const options = makeOptions({ agentType: "execute" });

      const list = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          yield* svc.start(options);
          return yield* svc.list();
        }),
      );

      expect(list.some((s) => s.agentType === "execute")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // stop / interrupt / pause
  // -------------------------------------------------------------------------

  describe("stop / interrupt / pause", () => {
    it("pause sets managed.status to 'paused'", async () => {
      const options = makeOptions();

      const managed = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(options);
          yield* svc.pause(m.id);
          return m;
        }),
      );

      expect(managed.status).toBe("paused");
    });

    it("pause returns false for non-existent subprocess", async () => {
      const result = await runSL(
        Effect.flatMap(SubprocessLifecycle, (svc) => svc.pause("does-not-exist")),
      );
      expect(result).toBe(false);
    });

    it("pause returns false when subprocess is already completed", async () => {
      const options = makeOptions();

      const result = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(options);
          m.status = "completed";
          return yield* svc.pause(m.id);
        }),
      );

      // pause only accepts "running" by default
      expect(result).toBe(false);
    });

    it("stop accepts already-paused subprocess", async () => {
      const options = makeOptions();

      const result = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(options);
          m.status = "paused";
          return yield* svc.stop(m.id);
        }),
      );

      // stop uses allowPaused: true
      expect(result).toBe(true);
    });

    it("interrupt only accepts running subprocess", async () => {
      const options = makeOptions();

      const result = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(options);
          m.status = "paused";
          return yield* svc.interrupt(m.id);
        }),
      );

      // interrupt does not accept paused
      expect(result).toBe(false);
    });

    it("pause broadcasts agent_paused event", async () => {
      const options = makeOptions();

      await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(options);
          yield* svc.pause(m.id);
        }),
      );

      expect(mockEBBroadcastAgentEvent).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { type: "agent_paused" },
      );
    });

    it("pause persists to DB when sessionDbId is available", async () => {
      mockSPGetSessionDbId.mockReturnValue(Effect.succeed(42));
      const options = makeOptions();

      await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(options);
          yield* svc.pause(m.id);
        }),
      );

      expect(mockDBExecute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE agent_sessions"),
        "paused",
        expect.any(String),
        42,
      );
    });

    it("pause aborts the abort controller when no query object", async () => {
      const options = makeOptions();

      const managed = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(options);
          // Ensure no query object (default state before SDK starts)
          m.query = undefined;
          yield* svc.pause(m.id);
          return m;
        }),
      );

      expect(managed.abortController?.signal.aborted).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // sendMessage
  // -------------------------------------------------------------------------

  describe("sendMessage", () => {
    it("returns no_process for unknown subprocess", async () => {
      const result = await runSL(
        Effect.flatMap(SubprocessLifecycle, (svc) =>
          svc.sendMessage("unknown-id", "hello"),
        ),
      );
      expect(result).toEqual({ success: false, reason: "no_process" });
    });

    it("returns invalid_status for stopped subprocess", async () => {
      const options = makeOptions();

      const result = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(options);
          m.status = "stopped";
          return yield* svc.sendMessage(m.id, "hello");
        }),
      );

      expect(result).toEqual({ success: false, reason: "invalid_status" });
    });

    it("sends message to running subprocess via pushMessage", async () => {
      const options = makeOptions();
      const mockPush = vi.fn();

      const result = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(options);
          m.pushMessage = mockPush;
          return yield* svc.sendMessage(m.id, "hello world");
        }),
      );

      expect(result).toEqual({ success: true, reason: "sent" });
      expect(mockPush).toHaveBeenCalledWith("hello world");
    });

    it("returns no_push when pushMessage is not set on running subprocess", async () => {
      const options = makeOptions();

      const result = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(options);
          // pushMessage is not set (before SDK starts)
          m.pushMessage = undefined;
          return yield* svc.sendMessage(m.id, "hello");
        }),
      );

      expect(result).toEqual({ success: false, reason: "no_push" });
    });

    it("resumes paused subprocess with new query", async () => {
      const options = makeOptions();

      const result = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(options);
          m.status = "paused";
          m.sdkSessionId = "sdk-session-123";
          return yield* svc.sendMessage(m.id, "resume me");
        }),
      );

      expect(result).toEqual({ success: true, reason: "resumed" });
    });

    it("sets managed.status back to 'running' when resuming from paused", async () => {
      const options = makeOptions();

      // Capture status as a string snapshot WITHIN the Effect before scope
      // closes and the finalizer kills running subprocesses.
      const statusAfterResume = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(options);
          m.status = "paused";
          yield* svc.sendMessage(m.id, "resume me");
          return m.status; // "running" at this point
        }),
      );

      expect(statusAfterResume).toBe("running");
    });

    it("returns no_resume_id when paused subprocess has no originalOptions", async () => {
      const options = makeOptions();

      const result = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(options);
          m.status = "paused";
          m.originalOptions = undefined;
          return yield* svc.sendMessage(m.id, "hello");
        }),
      );

      expect(result).toEqual({ success: false, reason: "no_resume_id" });
    });

    it("resumes from completed state", async () => {
      const options = makeOptions();

      const result = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(options);
          m.status = "completed";
          return yield* svc.sendMessage(m.id, "follow-up");
        }),
      );

      expect(result).toEqual({ success: true, reason: "resumed" });
    });

    it("persists user message to DB when sessionDbId is available", async () => {
      mockSPGetSessionDbId.mockReturnValue(Effect.succeed(55));
      const options = makeOptions();
      const mockPush = vi.fn();

      await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(options);
          m.pushMessage = mockPush;
          yield* svc.sendMessage(m.id, "hello");
        }),
      );

      expect(mockDBExecute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO agent_messages"),
        55,
        "user",
        "hello",
        "user_message",
        null,
      );
    });
  });

  // -------------------------------------------------------------------------
  // list and hasRunning
  // -------------------------------------------------------------------------

  describe("list and hasRunning", () => {
    it("list returns all active processes", async () => {
      const list = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          yield* svc.start(makeOptions({ agentType: "plan" }));
          yield* svc.start(makeOptions({ agentType: "prd" }));
          return yield* svc.list();
        }),
      );

      expect(list.length).toBe(2);
      expect(list.map((s) => s.agentType).toSorted()).toEqual(["plan", "prd"]);
    });

    it("hasRunning returns true when at least one subprocess is running", async () => {
      const result = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          yield* svc.start(makeOptions());
          return yield* svc.hasRunning();
        }),
      );
      expect(result).toBe(true);
    });

    it("hasRunning returns false when no subprocesses exist", async () => {
      const result = await runSL(
        Effect.flatMap(SubprocessLifecycle, (svc) => svc.hasRunning()),
      );
      expect(result).toBe(false);
    });

    it("hasRunning returns false when all subprocesses are paused", async () => {
      const result = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(makeOptions());
          m.status = "paused";
          return yield* svc.hasRunning();
        }),
      );
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // gracefulShutdown
  // -------------------------------------------------------------------------

  describe("gracefulShutdown", () => {
    it("saves all session states via SessionPersistence", async () => {
      await runSL(
        Effect.flatMap(SubprocessLifecycle, (svc) => svc.gracefulShutdown()),
      );

      expect(mockSPSaveAllSessionStates).toHaveBeenCalled();
    });

    it("kills all running subprocesses", async () => {
      const managed = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(makeOptions());
          yield* svc.gracefulShutdown();
          return m;
        }),
      );

      expect(managed.status).toBe("stopped");
    });

    it("aborts abort controllers on gracefulShutdown", async () => {
      const managed = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(makeOptions());
          yield* svc.gracefulShutdown();
          return m;
        }),
      );

      expect(managed.abortController?.signal.aborted).toBe(true);
    });

    it("continues even if saveAllSessionStates fails", async () => {
      mockSPSaveAllSessionStates.mockReturnValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Effect.fail({ _tag: "DatabaseError", operation: "execute", cause: new Error("DB fail") }) as any,
      );

      // Should not throw
      await expect(
        runSL(
          Effect.flatMap(SubprocessLifecycle, (svc) => svc.gracefulShutdown()),
        ),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // killAll
  // -------------------------------------------------------------------------

  describe("killAll", () => {
    it("sets all running subprocesses to stopped", async () => {
      const [m1, m2] = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const a = yield* svc.start(makeOptions());
          const b = yield* svc.start(makeOptions());
          yield* svc.killAll();
          return [a, b] as const;
        }),
      );

      expect(m1.status).toBe("stopped");
      expect(m2.status).toBe("stopped");
    });

    it("does not change status of non-running subprocesses", async () => {
      const managed = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(makeOptions());
          m.status = "paused";
          yield* svc.killAll();
          return m;
        }),
      );

      expect(managed.status).toBe("paused");
    });
  });

  // -------------------------------------------------------------------------
  // Effect.addFinalizer (scope exit kills all)
  // -------------------------------------------------------------------------

  describe("finalizer — kills all on scope exit", () => {
    it("aborts all running subprocesses when the scope is disposed", async () => {
      let managed: ManagedSubprocess | undefined;

      // Create a scoped runtime to test finalizer behavior
      const scopedEffect = Effect.gen(function* () {
        const svc = yield* SubprocessLifecycle;
        managed = yield* svc.start(makeOptions());
        // Don't explicitly kill — let the scope finalizer handle it
        return managed;
      });

      await Effect.runPromise(
        Effect.scoped(Effect.provide(scopedEffect, TestLayer)),
      );

      // After scope exits, the finalizer should have run
      expect(managed!.status).toBe("stopped");
    });
  });

  // -------------------------------------------------------------------------
  // setPermissionMode
  // -------------------------------------------------------------------------

  describe("setPermissionMode", () => {
    it("returns false when subprocess does not exist", async () => {
      const result = await runSL(
        Effect.flatMap(SubprocessLifecycle, (svc) =>
          svc.setPermissionMode("unknown", "plan"),
        ),
      );
      expect(result).toBe(false);
    });

    it("returns false when subprocess is not running", async () => {
      const result = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(makeOptions());
          m.status = "paused";
          return yield* svc.setPermissionMode(m.id, "plan");
        }),
      );
      expect(result).toBe(false);
    });

    it("returns false when subprocess has no query object", async () => {
      const result = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(makeOptions());
          m.query = undefined;
          return yield* svc.setPermissionMode(m.id, "plan");
        }),
      );
      expect(result).toBe(false);
    });

    it("calls setPermissionMode on the query object when running", async () => {
      const mockSetPermissionMode = vi.fn(() => Promise.resolve());

      const result = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const m = yield* svc.start(makeOptions());
          m.query = {
            interrupt: vi.fn(() => Promise.resolve()),
            setPermissionMode: mockSetPermissionMode,
            setModel: vi.fn(() => Promise.resolve()),
            [Symbol.asyncIterator]: vi.fn(),
          } as unknown as import("@anthropic-ai/claude-agent-sdk").Query;
          return yield* svc.setPermissionMode(m.id, "plan");
        }),
      );

      expect(result).toBe(true);
      expect(mockSetPermissionMode).toHaveBeenCalledWith("plan");
    });
  });

  // -------------------------------------------------------------------------
  // generateSubprocessId
  // -------------------------------------------------------------------------

  describe("generateSubprocessId", () => {
    it("returns a string matching the agent-timestamp-counter pattern", async () => {
      const id = await runSL(
        Effect.flatMap(SubprocessLifecycle, (svc) => svc.generateSubprocessId()),
      );
      expect(id).toMatch(/^agent-\d+-\d+$/);
    });

    it("generates unique IDs on successive calls", async () => {
      const [id1, id2] = await runSL(
        Effect.gen(function* () {
          const svc = yield* SubprocessLifecycle;
          const a = yield* svc.generateSubprocessId();
          const b = yield* svc.generateSubprocessId();
          return [a, b] as const;
        }),
      );
      expect(id1).not.toBe(id2);
    });
  });
});
