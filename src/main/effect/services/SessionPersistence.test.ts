import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { SessionPersistence, SessionPersistenceLive } from "./SessionPersistence.js";
import { Database } from "./Database.js";

// ---------------------------------------------------------------------------
// Mock Database service
// ---------------------------------------------------------------------------

const mockExecute = vi.fn();
const mockQueryOne = vi.fn();
const mockQueryAll = vi.fn();

const MockDatabase = Layer.succeed(Database, {
  execute: (...args: unknown[]) => mockExecute(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  queryAll: (...args: unknown[]) => mockQueryAll(...args),
  queryOneValidated: vi.fn(),
  queryAllValidated: vi.fn(),
});

const TestLayer = Layer.provide(SessionPersistenceLive, MockDatabase);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runSP<A>(
  eff: Effect.Effect<A, unknown, SessionPersistence>,
): Promise<A> {
  return Effect.runPromise(Effect.provide(eff, TestLayer));
}

function runSPSync<A>(
  eff: Effect.Effect<A, unknown, SessionPersistence>,
): A {
  return Effect.runSync(Effect.provide(eff, TestLayer));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionPersistence service — SessionPersistenceLive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: execute succeeds with no-op result
    mockExecute.mockReturnValue(
      Effect.succeed({ changes: 1, lastInsertRowid: 0 }),
    );
    mockQueryOne.mockReturnValue(Effect.succeed(null));
    mockQueryAll.mockReturnValue(Effect.succeed([]));
  });

  // ---------------------------------------------------------------------------
  // Session map
  // ---------------------------------------------------------------------------

  describe("registerSession / getSessionDbId / removeSession", () => {
    it("registerSession adds entry to the session map", () => {
      const result = runSPSync(
        Effect.gen(function* () {
          const svc = yield* SessionPersistence;
          yield* svc.registerSession("subprocess-1", 42);
          return yield* svc.getSessionDbId("subprocess-1");
        }),
      );
      expect(result).toBe(42);
    });

    it("getSessionDbId returns null for unknown subprocess", () => {
      const result = runSPSync(
        Effect.flatMap(SessionPersistence, (svc) =>
          svc.getSessionDbId("unknown"),
        ),
      );
      expect(result).toBeNull();
    });

    it("removeSession removes the entry", () => {
      const result = runSPSync(
        Effect.gen(function* () {
          const svc = yield* SessionPersistence;
          yield* svc.registerSession("subprocess-2", 99);
          yield* svc.removeSession("subprocess-2");
          return yield* svc.getSessionDbId("subprocess-2");
        }),
      );
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // setSessionModel
  // ---------------------------------------------------------------------------

  describe("setSessionModel", () => {
    it("stores the model without DB access", () => {
      runSPSync(
        Effect.flatMap(SessionPersistence, (svc) =>
          svc.setSessionModel(10, "claude-3-7-sonnet-latest"),
        ),
      );
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // persistClaudeSessionId
  // ---------------------------------------------------------------------------

  describe("persistClaudeSessionId", () => {
    it("executes an UPDATE against agent_sessions", async () => {
      await runSP(
        Effect.flatMap(SessionPersistence, (svc) =>
          svc.persistClaudeSessionId(5, "sdk-session-abc"),
        ),
      );
      expect(mockExecute).toHaveBeenCalledWith(
        "UPDATE agent_sessions SET claude_session_id = ? WHERE id = ?",
        "sdk-session-abc",
        5,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // updateTokenUsage
  // ---------------------------------------------------------------------------

  describe("updateTokenUsage", () => {
    it("updates input_tokens and output_tokens", async () => {
      await runSP(
        Effect.flatMap(SessionPersistence, (svc) =>
          svc.updateTokenUsage(7, 1234, 56),
        ),
      );
      expect(mockExecute).toHaveBeenCalledWith(
        "UPDATE agent_sessions SET input_tokens = ?, output_tokens = ? WHERE id = ?",
        1234,
        56,
        7,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // persistStreamEvent — message_start
  // ---------------------------------------------------------------------------

  describe("persistStreamEvent — message_start", () => {
    it("captures the model from message_start (no DB insert)", async () => {
      await runSP(
        Effect.flatMap(SessionPersistence, (svc) =>
          svc.persistStreamEvent(1, {
            type: "message_start",
            message: {
              id: "msg_1",
              type: "message",
              role: "assistant",
              model: "claude-3-5-sonnet",
            },
          }),
        ),
      );
      // No DB insert for message_start
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // persistStreamEvent — content_block_start text
  // ---------------------------------------------------------------------------

  describe("persistStreamEvent — content_block_start text", () => {
    it("inserts a text message row", async () => {
      mockExecute.mockReturnValue(
        Effect.succeed({ changes: 1, lastInsertRowid: 10 }),
      );

      await runSP(
        Effect.flatMap(SessionPersistence, (svc) =>
          svc.persistStreamEvent(
            1,
            {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "Hello world" },
            },
            null,
          ),
        ),
      );

      expect(mockExecute).toHaveBeenCalledOnce();
      const [sql, ...params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO agent_messages");
      expect(params).toContain("text");
      expect(params).toContain("Hello world");
    });
  });

  // ---------------------------------------------------------------------------
  // persistStreamEvent — tool_use
  // ---------------------------------------------------------------------------

  describe("persistStreamEvent — content_block_start tool_use", () => {
    it("inserts a tool_call row and tracks pending input", async () => {
      mockExecute.mockReturnValue(
        Effect.succeed({ changes: 1, lastInsertRowid: 20 }),
      );

      await runSP(
        Effect.flatMap(SessionPersistence, (svc) =>
          svc.persistStreamEvent(2, {
            type: "content_block_start",
            index: 0,
            content_block: {
              type: "tool_use",
              id: "tool-1",
              name: "Bash",
              input: {},
            },
          }),
        ),
      );

      const [sql, ...params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO agent_messages");
      expect(params).toContain("tool_call");
      expect(params).toContain("Bash");
    });

    it("marks file changes for Write/Edit/NotebookEdit tools", async () => {
      mockExecute.mockReturnValue(
        Effect.succeed({ changes: 1, lastInsertRowid: 30 }),
      );

      await runSP(
        Effect.flatMap(SessionPersistence, (svc) =>
          svc.persistStreamEvent(3, {
            type: "content_block_start",
            index: 0,
            content_block: {
              type: "tool_use",
              id: "tool-2",
              name: "Write",
              input: {},
            },
          }),
        ),
      );

      // Should have called execute for both insert and has_file_changes update
      expect(mockExecute.mock.calls.length).toBeGreaterThanOrEqual(2);
      const updateCall = mockExecute.mock.calls.find(
        ([sql]) =>
          typeof sql === "string" && sql.includes("has_file_changes"),
      );
      expect(updateCall).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // persistStreamEvent — tool_result
  // ---------------------------------------------------------------------------

  describe("persistStreamEvent — tool_result", () => {
    it("inserts a tool_result row with is_error=false", async () => {
      await runSP(
        Effect.flatMap(SessionPersistence, (svc) =>
          svc.persistStreamEvent(1, {
            type: "tool_result",
            tool_use_id: "tool-abc",
            content: "result text",
            is_error: false,
          }),
        ),
      );

      const [sql, ...params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO agent_messages");
      expect(params).toContain("tool_result");
    });

    it("inserts a tool_error row when is_error=true", async () => {
      await runSP(
        Effect.flatMap(SessionPersistence, (svc) =>
          svc.persistStreamEvent(1, {
            type: "tool_result",
            tool_use_id: "tool-xyz",
            content: "error occurred",
            is_error: true,
          }),
        ),
      );

      const [sql, ...params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO agent_messages");
      expect(params).toContain("tool_error");
    });
  });

  // ---------------------------------------------------------------------------
  // persistStreamEvent — error
  // ---------------------------------------------------------------------------

  describe("persistStreamEvent — error", () => {
    it("inserts an error row", async () => {
      await runSP(
        Effect.flatMap(SessionPersistence, (svc) =>
          svc.persistStreamEvent(1, {
            type: "error",
            error: { type: "sdk_error", message: "something went wrong" },
          }),
        ),
      );

      const [sql, ...params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO agent_messages");
      expect(params).toContain("error");
      expect(params).toContain("something went wrong");
    });
  });

  // ---------------------------------------------------------------------------
  // persistSessionStatus
  // ---------------------------------------------------------------------------

  describe("persistSessionStatus", () => {
    it("does nothing if managedId is not in session map", async () => {
      await runSP(
        Effect.flatMap(SessionPersistence, (svc) =>
          svc.persistSessionStatus("unknown-id", "completed"),
        ),
      );
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("updates status and ended_at when managedId is registered", async () => {
      await runSP(
        Effect.gen(function* () {
          const svc = yield* SessionPersistence;
          yield* svc.registerSession("proc-10", 10);
          yield* svc.persistSessionStatus("proc-10", "completed");
        }),
      );

      expect(mockExecute).toHaveBeenCalledOnce();
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).toContain("UPDATE agent_sessions SET");
      expect(sql).toContain("status = ?");
      expect(sql).toContain("ended_at = ?");
    });

    it("clears subprocess_id when status is 'error'", async () => {
      await runSP(
        Effect.gen(function* () {
          const svc = yield* SessionPersistence;
          yield* svc.registerSession("proc-11", 11);
          yield* svc.persistSessionStatus("proc-11", "error");
        }),
      );

      const [sql, ...params] = mockExecute.mock.calls[0];
      expect(sql).toContain("subprocess_id = ?");
      expect(params).toContain(null); // subprocess_id set to null
    });

    it("also persists sdkSessionId when provided", async () => {
      await runSP(
        Effect.gen(function* () {
          const svc = yield* SessionPersistence;
          yield* svc.registerSession("proc-12", 12);
          yield* svc.persistSessionStatus(
            "proc-12",
            "completed",
            "sdk-session-xyz",
          );
        }),
      );

      // Should have 2 execute calls: status update + claude_session_id update
      expect(mockExecute).toHaveBeenCalledTimes(2);
      const secondCall = mockExecute.mock.calls[1];
      expect(secondCall[0]).toContain("claude_session_id");
      expect(secondCall[1]).toBe("sdk-session-xyz");
    });
  });

  // ---------------------------------------------------------------------------
  // saveAllSessionStates
  // ---------------------------------------------------------------------------

  describe("saveAllSessionStates", () => {
    it("executes 3 UPDATE statements", async () => {
      await runSP(
        Effect.flatMap(SessionPersistence, (svc) =>
          svc.saveAllSessionStates(),
        ),
      );
      expect(mockExecute).toHaveBeenCalledTimes(3);

      const sqls = mockExecute.mock.calls.map((args: unknown[]) => args[0] as string);
      expect(sqls.some((s) => s.includes("status = 'paused'"))).toBe(true);
      expect(sqls.some((s) => s.includes("phases"))).toBe(true);
      expect(sqls.some((s) => s.includes("subprocess_id = NULL"))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // restoreSessionMap
  // ---------------------------------------------------------------------------

  describe("restoreSessionMap", () => {
    it("marks stale sessions and populates session map from DB", async () => {
      mockQueryAll.mockReturnValue(
        Effect.succeed([
          { id: 1, subprocess_id: "old-proc-1" },
          { id: 2, subprocess_id: "old-proc-2" },
        ]),
      );

      // Run restoreSessionMap AND the lookups in the SAME effect so they share
      // the same service instance (and therefore the same internal sessionMap).
      const [id1, id2] = await runSP(
        Effect.gen(function* () {
          const svc = yield* SessionPersistence;
          yield* svc.restoreSessionMap();
          return yield* Effect.all([
            svc.getSessionDbId("old-proc-1"),
            svc.getSessionDbId("old-proc-2"),
          ]);
        }),
      );

      // Should have executed 2 UPDATE statements (stale orchestrators + running→paused)
      expect(mockExecute.mock.calls.length).toBeGreaterThanOrEqual(2);

      // Session map should be populated from the DB rows
      expect(id1).toBe(1);
      expect(id2).toBe(2);
    });
  });
});
