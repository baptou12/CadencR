import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect, Layer } from "effect";
import { CliNotFoundError } from "../../effect/errors.js";
import { SdkQueryRunner, SdkQueryRunnerLive } from "./SdkQueryRunner.js";
import { SessionPersistence } from "./SessionPersistence.js";
import { EventBroadcaster } from "./EventBroadcaster.js";
import { Database } from "./Database.js";
import { CompletionActions } from "./CompletionActions.js";
import { BackgroundTaskRegistry } from "./BackgroundTaskRegistry.js";
import type { ManagedSubprocess, SubprocessOptions } from "../../agents/types.js";

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

const mockGetSdkClient = vi.fn();
const mockDiscoverClaudeCli = vi.fn();
const mockResolveSetting = vi.fn(() => null);
const mockCreateCanUseToolHandler = vi.fn(() => vi.fn());
const mockAddBackgroundTask = vi.fn();
const mockUpdateBackgroundTask = vi.fn();
const mockClearBackgroundTasks = vi.fn();
const mockLoadAllowedPatterns = vi.fn(() => new Set<string>());

vi.mock("../../agents/sdk-client", () => ({ getSdkClient: (...args: unknown[]) => mockGetSdkClient(...args) }));
vi.mock("../../agents/cli-discovery", () => ({ discoverClaudeCli: (...args: unknown[]) => mockDiscoverClaudeCli(...args) }));
// No arg forwarding for these — tests don't assert on their call args, and their
// typed implementations would cause TS2556 (spread unknown[] into 0-param fn).
vi.mock("../../db/settings", () => ({ resolveSetting: () => mockResolveSetting() }));
vi.mock("../../agents/tool-permissions", () => ({ createCanUseToolHandler: () => mockCreateCanUseToolHandler() }));
vi.mock("../../agents/background-tasks", () => ({
  addBackgroundTask: (...args: unknown[]) => mockAddBackgroundTask(...args),
  updateBackgroundTask: (...args: unknown[]) => mockUpdateBackgroundTask(...args),
  clearBackgroundTasks: (...args: unknown[]) => mockClearBackgroundTasks(...args),
}));
vi.mock("../../agents/models", () => ({
  DEFAULT_MODEL: "claude-3-5-sonnet-20241022",
  resolveModel: vi.fn(() => undefined),
}));
vi.mock("../../agents/permissions", () => ({ loadAllowedPatterns: () => mockLoadAllowedPatterns() }));

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------

// Plain vi.fn() (no type args) → inferred as Mock<AnyFunction>, which is callable
// with any arguments. mockReturnValue works with any Effect type. The `as any`
// casts in Layer.succeed ensure the mock receives exactly the args passed by the
// caller, without the wrapper adding extra `undefined` for omitted optional params.
const mockSPPersistStreamEvent = vi.fn();
const mockSPPersistSessionStatus = vi.fn();
const mockSPPersistClaudeSessionId = vi.fn();
const mockSPSetSessionModel = vi.fn();
const mockSPUpdateTokenUsage = vi.fn();
const mockSPGetSessionDbId = vi.fn();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockSessionPersistence = Layer.succeed(SessionPersistence, {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  persistStreamEvent: mockSPPersistStreamEvent as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  persistSessionStatus: mockSPPersistSessionStatus as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  persistClaudeSessionId: mockSPPersistClaudeSessionId as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSessionModel: mockSPSetSessionModel as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateTokenUsage: mockSPUpdateTokenUsage as any,
  saveAllSessionStates: vi.fn(() => Effect.void),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSessionDbId: mockSPGetSessionDbId as any,
  restoreSessionMap: vi.fn(() => Effect.void),
  registerSession: vi.fn(() => Effect.void),
  removeSession: vi.fn(() => Effect.void),
  getSubprocessIdForSession: vi.fn(() => Effect.succeed(undefined)),
  getSubprocessIdsForSessionDbIds: vi.fn(() => Effect.succeed([])),
});

const mockEBBroadcastAgentEvent = vi.fn();
const mockEBThrottledNotify = vi.fn();
const mockEBFlushNotify = vi.fn();
const mockEBNotifyDbUpdated = vi.fn();

const MockEventBroadcaster = Layer.succeed(EventBroadcaster, {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  broadcastAgentEvent: mockEBBroadcastAgentEvent as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  notifyDbUpdated: mockEBNotifyDbUpdated as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  throttledNotify: mockEBThrottledNotify as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flushNotify: mockEBFlushNotify as any,
});

const mockDBExecute = vi.fn();
const mockDBQueryOne = vi.fn();
const mockDBQueryAll = vi.fn();

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

const mockCAOnCompleted = vi.fn();
const mockCAOnPaused = vi.fn();
const mockCAOnStopped = vi.fn();
const mockCAOnError = vi.fn();

const MockCompletionActions = Layer.succeed(CompletionActions, {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onCompleted: mockCAOnCompleted as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPaused: mockCAOnPaused as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onStopped: mockCAOnStopped as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: mockCAOnError as any,
});

const mockBGAdd = vi.fn(() => Effect.void);
const mockBGUpdate = vi.fn(() => Effect.void);
const mockBGGetBySubprocess = vi.fn(() => Effect.succeed([]));
const mockBGClear = vi.fn(() => Effect.void);
const mockBGBroadcast = vi.fn(() => Effect.void);

const MockBackgroundTaskRegistry = Layer.succeed(BackgroundTaskRegistry, {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  add: mockBGAdd as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update: mockBGUpdate as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getBySubprocess: mockBGGetBySubprocess as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clear: mockBGClear as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  broadcast: mockBGBroadcast as any,
});

const TestLayer = Layer.provide(
  SdkQueryRunnerLive,
  Layer.mergeAll(
    MockSessionPersistence,
    MockEventBroadcaster,
    MockDatabase,
    MockCompletionActions,
    MockBackgroundTaskRegistry,
  ),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runSDK<A>(
  eff: Effect.Effect<A, unknown, SdkQueryRunner>,
): Promise<A> {
  return Effect.runPromise(Effect.provide(eff, TestLayer));
}

function makeManagedSubprocess(
  overrides: Partial<ManagedSubprocess> = {},
): ManagedSubprocess {
  return {
    id: "test-subprocess-sdk",
    agentType: "plan",
    startedAt: new Date(),
    status: "running",
    abortController: new AbortController(),
    eventListeners: [],
    completionListeners: [],
    cachedPermissions: new Set<string>(),
    ...overrides,
  };
}

function makeOptions(overrides: Partial<SubprocessOptions> = {}): SubprocessOptions {
  return {
    cwd: "/some/project",
    agentType: "plan",
    prompt: "Hello, world!",
    ...overrides,
  };
}

/** Create a mock SDK that yields the given messages then ends. */
function makeMockSdk(messages: unknown[]) {
  return {
    query: vi.fn((_opts: unknown) => {
      let idx = 0;
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () => {
              if (idx < messages.length) {
                return Promise.resolve({ done: false, value: messages[idx++] });
              }
              return Promise.resolve({ done: true, value: undefined });
            },
            return: () => Promise.resolve({ done: true, value: undefined }),
          };
        },
        interrupt: vi.fn(() => Promise.resolve()),
        close: vi.fn(),
        setPermissionMode: vi.fn(() => Promise.resolve()),
        supportedCommands: vi.fn(() => Promise.resolve([])),
        setModel: vi.fn(() => Promise.resolve()),
      };
    }),
  };
}

/** Create a mock SDK that throws on iteration. */
function makeThrowingSdk(error: Error) {
  return {
    query: vi.fn((_opts: unknown) => {
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () => Promise.reject(error),
            return: () => Promise.resolve({ done: true, value: undefined }),
          };
        },
        interrupt: vi.fn(() => Promise.resolve()),
        close: vi.fn(),
        setPermissionMode: vi.fn(() => Promise.resolve()),
        supportedCommands: vi.fn(() => Promise.resolve([])),
        setModel: vi.fn(() => Promise.resolve()),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SdkQueryRunner service — SdkQueryRunnerLive", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // External module mock defaults
    mockDiscoverClaudeCli.mockReturnValue(Effect.succeed({ path: "/usr/local/bin/claude", version: "1.0.0" }));
    mockGetSdkClient.mockResolvedValue(makeMockSdk([]));

    // SessionPersistence mock defaults
    mockSPGetSessionDbId.mockReturnValue(Effect.succeed(null));
    mockSPPersistStreamEvent.mockReturnValue(Effect.void);
    mockSPPersistSessionStatus.mockReturnValue(Effect.void);
    mockSPPersistClaudeSessionId.mockReturnValue(Effect.void);
    mockSPSetSessionModel.mockReturnValue(Effect.void);
    mockSPUpdateTokenUsage.mockReturnValue(Effect.void);

    // EventBroadcaster mock defaults
    mockEBBroadcastAgentEvent.mockReturnValue(Effect.void);
    mockEBThrottledNotify.mockReturnValue(Effect.void);
    mockEBFlushNotify.mockReturnValue(Effect.void);
    mockEBNotifyDbUpdated.mockReturnValue(Effect.void);

    // Database mock defaults
    mockDBExecute.mockReturnValue(Effect.succeed({ changes: 1, lastInsertRowid: 0 }));
    mockDBQueryOne.mockReturnValue(Effect.succeed(null));
    mockDBQueryAll.mockReturnValue(Effect.succeed([]));

    // CompletionActions mock defaults
    mockCAOnCompleted.mockReturnValue(Effect.void);
    mockCAOnPaused.mockReturnValue(Effect.void);
    mockCAOnStopped.mockReturnValue(Effect.void);
    mockCAOnError.mockReturnValue(Effect.void);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // SDK lifecycle
  // -------------------------------------------------------------------------

  describe("SDK query lifecycle", () => {
    it("calls discoverClaudeCli during execution", async () => {
      const managed = makeManagedSubprocess();
      const options = makeOptions();

      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, options)),
      );

      expect(mockDiscoverClaudeCli).toHaveBeenCalled();
    });

    it("calls getSdkClient during execution", async () => {
      const managed = makeManagedSubprocess();
      const options = makeOptions();

      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, options)),
      );

      expect(mockGetSdkClient).toHaveBeenCalled();
    });

    it("calls onCompleted when loop finishes with status 'running'", async () => {
      const managed = makeManagedSubprocess({ status: "running" });
      const options = makeOptions();

      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, options)),
      );

      expect(mockCAOnCompleted).toHaveBeenCalledWith(managed, undefined);
    });

    it("calls onPaused when loop finishes with status 'paused'", async () => {
      const managed = makeManagedSubprocess({ status: "running" });
      const options = makeOptions();

      // Simulate SDK completing while managed.status is "paused"
      mockGetSdkClient.mockResolvedValue({
        query: vi.fn(() => {
          return {
            [Symbol.asyncIterator]() {
              return {
                next: () => {
                  managed.status = "paused"; // simulate interrupt
                  return Promise.resolve({ done: true, value: undefined });
                },
                return: () => Promise.resolve({ done: true, value: undefined }),
              };
            },
            interrupt: vi.fn(() => Promise.resolve()),
            close: vi.fn(),
            setPermissionMode: vi.fn(() => Promise.resolve()),
            supportedCommands: vi.fn(() => Promise.resolve([])),
          };
        }),
      });

      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, options)),
      );

      expect(mockCAOnPaused).toHaveBeenCalledWith(managed);
    });

    it("calls onStopped when loop finishes with status 'stopped'", async () => {
      const managed = makeManagedSubprocess({ status: "running" });
      const options = makeOptions();

      mockGetSdkClient.mockResolvedValue({
        query: vi.fn(() => {
          return {
            [Symbol.asyncIterator]() {
              return {
                next: () => {
                  managed.status = "stopped"; // simulate stop
                  return Promise.resolve({ done: true, value: undefined });
                },
                return: () => Promise.resolve({ done: true, value: undefined }),
              };
            },
            interrupt: vi.fn(() => Promise.resolve()),
            close: vi.fn(),
            setPermissionMode: vi.fn(() => Promise.resolve()),
            supportedCommands: vi.fn(() => Promise.resolve([])),
          };
        }),
      });

      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, options)),
      );

      expect(mockCAOnStopped).toHaveBeenCalledWith(managed, undefined);
    });

    it("calls clearBackgroundTasks in finally block when not paused", async () => {
      const managed = makeManagedSubprocess({ status: "running" });
      const options = makeOptions();

      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, options)),
      );

      expect(mockBGClear).toHaveBeenCalledWith(managed.id);
    });

    it("does NOT clear background tasks when status is paused", async () => {
      const managed = makeManagedSubprocess({ status: "running" });
      const options = makeOptions();

      mockGetSdkClient.mockResolvedValue({
        query: vi.fn(() => {
          return {
            [Symbol.asyncIterator]() {
              return {
                next: () => {
                  managed.status = "paused";
                  return Promise.resolve({ done: true, value: undefined });
                },
                return: () => Promise.resolve({ done: true, value: undefined }),
              };
            },
            interrupt: vi.fn(() => Promise.resolve()),
            close: vi.fn(),
            setPermissionMode: vi.fn(() => Promise.resolve()),
            supportedCommands: vi.fn(() => Promise.resolve([])),
          };
        }),
      });

      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, options)),
      );

      expect(mockBGClear).not.toHaveBeenCalled();
    });

    it("rejects with an error about CLI not found when CLI is missing", async () => {
      mockDiscoverClaudeCli.mockReturnValue(Effect.fail(new CliNotFoundError({ searchedPaths: [] })));
      const managed = makeManagedSubprocess();
      const options = makeOptions();

      // Effect.runPromise wraps typed errors in FiberFailure; verify via thrown message
      await expect(
        runSDK(
          Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, options)),
        ),
      ).rejects.toThrow(/Claude CLI not found/);
    });

    it("sets resumingFromSessionId when options.resumeSessionId is provided", async () => {
      const managed = makeManagedSubprocess();
      const options = makeOptions({ resumeSessionId: "resume-abc" });

      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, options)),
      );

      expect(managed.resumingFromSessionId).toBe("resume-abc");
    });
  });

  // -------------------------------------------------------------------------
  // Error recovery — catch block dispatch
  // -------------------------------------------------------------------------

  describe("error recovery in catch block", () => {
    it("calls onError when SDK throws and status is 'running'", async () => {
      const sdkError = new Error("SDK query failed unexpectedly");
      mockGetSdkClient.mockResolvedValue(makeThrowingSdk(sdkError));

      const managed = makeManagedSubprocess({ status: "running" });
      const options = makeOptions();

      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, options)),
      );

      expect(mockCAOnError).toHaveBeenCalledWith(managed, sdkError);
    });

    it("calls onPaused when SDK throws and status is 'paused' (interrupt threw)", async () => {
      mockGetSdkClient.mockResolvedValue({
        query: vi.fn(() => {
          return {
            [Symbol.asyncIterator]() {
              return {
                next: () => {
                  // Simulate: status was set to paused before error
                  return Promise.reject(new Error("AbortError"));
                },
                return: () => Promise.resolve({ done: true, value: undefined }),
              };
            },
            interrupt: vi.fn(() => Promise.resolve()),
            close: vi.fn(),
            setPermissionMode: vi.fn(() => Promise.resolve()),
            supportedCommands: vi.fn(() => Promise.resolve([])),
          };
        }),
      });

      const managed = makeManagedSubprocess({ status: "paused" });
      const options = makeOptions();

      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, options)),
      );

      expect(mockCAOnPaused).toHaveBeenCalledWith(managed);
      expect(mockCAOnError).not.toHaveBeenCalled();
    });

    it("calls onStopped when SDK throws and status is 'stopped'", async () => {
      mockGetSdkClient.mockResolvedValue({
        query: vi.fn(() => {
          return {
            [Symbol.asyncIterator]() {
              return {
                next: () => {
                  return Promise.reject(new Error("AbortError"));
                },
                return: () => Promise.resolve({ done: true, value: undefined }),
              };
            },
            interrupt: vi.fn(() => Promise.resolve()),
            close: vi.fn(),
            setPermissionMode: vi.fn(() => Promise.resolve()),
            supportedCommands: vi.fn(() => Promise.resolve([])),
          };
        }),
      });

      const managed = makeManagedSubprocess({ status: "stopped" });
      const options = makeOptions();

      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, options)),
      );

      expect(mockCAOnStopped).toHaveBeenCalledWith(managed);
      expect(mockCAOnError).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Message routing — stream_event
  // -------------------------------------------------------------------------

  describe("message routing — stream_event", () => {
    it("persists stream events to DB via SessionPersistence when sessionDbId is available", async () => {
      mockSPGetSessionDbId.mockReturnValue(Effect.succeed(10));

      const streamEvent = {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "Hello" },
      };

      mockGetSdkClient.mockResolvedValue(
        makeMockSdk([{ type: "stream_event", event: streamEvent }]),
      );

      const managed = makeManagedSubprocess();
      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, makeOptions())),
      );

      expect(mockSPPersistStreamEvent).toHaveBeenCalledWith(
        10,
        streamEvent,
        null,
      );
    });

    it("throttles DB notifications for stream_events when featureId is available", async () => {
      mockSPGetSessionDbId.mockReturnValue(Effect.succeed(5));
      mockDBQueryOne.mockReturnValue(Effect.succeed({ feature_id: 99 }));

      mockGetSdkClient.mockResolvedValue(
        makeMockSdk([
          { type: "stream_event", event: { type: "content_block_stop", index: 0 } },
        ]),
      );

      const managed = makeManagedSubprocess();
      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, makeOptions())),
      );

      expect(mockEBThrottledNotify).toHaveBeenCalledWith(managed.id, 99);
    });

    it("fires event listeners for stream_events", async () => {
      mockSPGetSessionDbId.mockReturnValue(Effect.succeed(5));
      const innerEvent = { type: "content_block_stop", index: 0 };
      mockGetSdkClient.mockResolvedValue(
        makeMockSdk([{ type: "stream_event", event: innerEvent }]),
      );

      const listener = vi.fn();
      const managed = makeManagedSubprocess({ eventListeners: [listener] });

      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, makeOptions())),
      );

      expect(listener).toHaveBeenCalledWith(innerEvent);
    });
  });

  // -------------------------------------------------------------------------
  // Message routing — system messages
  // -------------------------------------------------------------------------

  describe("message routing — system messages", () => {
    it("captures SDK session ID from system messages", async () => {
      mockGetSdkClient.mockResolvedValue(
        makeMockSdk([
          { type: "system", subtype: "init", session_id: "sdk-session-abc" },
        ]),
      );

      const managed = makeManagedSubprocess();
      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, makeOptions())),
      );

      expect(managed.sdkSessionId).toBe("sdk-session-abc");
    });

    it("persists SDK session ID to DB via SessionPersistence", async () => {
      mockSPGetSessionDbId.mockReturnValue(Effect.succeed(20));
      mockGetSdkClient.mockResolvedValue(
        makeMockSdk([
          { type: "system", subtype: "init", session_id: "sdk-session-xyz" },
        ]),
      );

      const managed = makeManagedSubprocess();
      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, makeOptions())),
      );

      expect(mockSPPersistClaudeSessionId).toHaveBeenCalledWith(20, "sdk-session-xyz");
    });

    it("handles compact_boundary system event", async () => {
      mockSPGetSessionDbId.mockReturnValue(Effect.succeed(30));
      mockGetSdkClient.mockResolvedValue(
        makeMockSdk([
          { type: "system", subtype: "compact_boundary" },
        ]),
      );

      const managed = makeManagedSubprocess();
      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, makeOptions())),
      );

      // Should update was_compacted in DB
      expect(mockDBExecute).toHaveBeenCalledWith(
        "UPDATE agent_sessions SET was_compacted = 1 WHERE id = ?",
        30,
      );
      // Should persist compact_boundary stream event
      expect(mockSPPersistStreamEvent).toHaveBeenCalledWith(
        30,
        expect.objectContaining({ type: "system", subtype: "compact_boundary" }),
        null,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Message routing — assistant messages
  // -------------------------------------------------------------------------

  describe("message routing — assistant messages", () => {
    it("updates token usage via SessionPersistence", async () => {
      mockSPGetSessionDbId.mockReturnValue(Effect.succeed(15));
      mockGetSdkClient.mockResolvedValue(
        makeMockSdk([
          {
            type: "assistant",
            message: {
              content: [],
              usage: {
                input_tokens: 100,
                output_tokens: 50,
                cache_creation_input_tokens: 10,
                cache_read_input_tokens: 5,
              },
            },
          },
        ]),
      );

      const managed = makeManagedSubprocess();
      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, makeOptions())),
      );

      expect(mockSPUpdateTokenUsage).toHaveBeenCalledWith(15, 115, 50);
    });

    it("tracks background Bash tasks", async () => {
      mockGetSdkClient.mockResolvedValue(
        makeMockSdk([
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "tool-123",
                  name: "Bash",
                  input: { command: "sleep 10", run_in_background: true },
                },
              ],
            },
          },
        ]),
      );

      const managed = makeManagedSubprocess();
      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, makeOptions())),
      );

      expect(mockBGAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "tool-123",
          subprocessId: managed.id,
          kind: "bash",
          status: "running",
          command: "sleep 10",
        }),
      );
    });

    it("tracks background Task agent spawns", async () => {
      mockGetSdkClient.mockResolvedValue(
        makeMockSdk([
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "task-456",
                  name: "Task",
                  input: { run_in_background: true },
                },
              ],
            },
          },
        ]),
      );

      const managed = makeManagedSubprocess();
      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, makeOptions())),
      );

      expect(mockBGAdd).toHaveBeenCalledWith(
        expect.objectContaining({ id: "task-456", subprocessId: managed.id, kind: "agent" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Message routing — result message
  // -------------------------------------------------------------------------

  describe("message routing — result message", () => {
    it("broadcasts result event via EventBroadcaster", async () => {
      mockGetSdkClient.mockResolvedValue(
        makeMockSdk([
          {
            type: "result",
            result: "done",
            cost_usd: 0.01,
            duration_ms: 1000,
          },
        ]),
      );

      const managed = makeManagedSubprocess({ agentType: "plan" });
      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) => svc.execute(managed, makeOptions())),
      );

      expect(mockEBBroadcastAgentEvent).toHaveBeenCalledWith(
        managed.id,
        "plan",
        expect.objectContaining({ type: "result", result: "done" }),
        null,
      );
    });

    it("broadcasts turn_complete for session agents after result", async () => {
      mockGetSdkClient.mockResolvedValue(
        makeMockSdk([{ type: "result", result: "done" }]),
      );

      const managed = makeManagedSubprocess({ agentType: "session" });
      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) =>
          svc.execute(managed, makeOptions({ agentType: "session" })),
        ),
      );

      expect(mockEBBroadcastAgentEvent).toHaveBeenCalledWith(
        managed.id,
        "session",
        { type: "turn_complete" },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Resume mode
  // -------------------------------------------------------------------------

  describe("resume mode", () => {
    it("passes resume session ID in query options", async () => {
      let capturedOptions: Record<string, unknown> | undefined;
      const mockSdk = {
        query: vi.fn((opts: { prompt: unknown; options: Record<string, unknown> }) => {
          capturedOptions = opts.options;
          return {
            [Symbol.asyncIterator]() {
              return {
                next: () => Promise.resolve({ done: true, value: undefined }),
                return: () => Promise.resolve({ done: true, value: undefined }),
              };
            },
            interrupt: vi.fn(() => Promise.resolve()),
            close: vi.fn(),
            setPermissionMode: vi.fn(() => Promise.resolve()),
            supportedCommands: vi.fn(() => Promise.resolve([])),
          };
        }),
      };
      mockGetSdkClient.mockResolvedValue(mockSdk);

      const managed = makeManagedSubprocess();
      await runSDK(
        Effect.flatMap(SdkQueryRunner, (svc) =>
          svc.execute(managed, makeOptions({ resumeSessionId: "old-session-id" })),
        ),
      );

      expect(capturedOptions?.resume).toBe("old-session-id");
    });
  });
});
