/**
 * Tests for session-persistence.ts — subprocess ID to DB session mapping,
 * stream event serialization, and DB notification.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "../test-utils";

// Mock dependencies
const mockDb = createMockDb();
vi.mock("../db/database", () => ({
  getDatabase: vi.fn(() => mockDb),
}));
vi.mock("./broadcast", () => ({
  broadcast: vi.fn(),
  DB_UPDATED_CHANNEL: "db:updated",
}));

import {
  registerSessionPersistence,
  getSessionDbId,
  getSubprocessIdForSession,
  persistStreamEvent,
  persistClaudeSessionId,
  notifyDbUpdated,
  getSubprocessIdsForSessionDbIds,
  restoreSessionMap,
  setSessionModel,
} from "./session-persistence";
import { broadcast } from "./broadcast";
import { getDatabase } from "../db/database";

describe("session-persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock return values
    mockDb.prepare.mockImplementation(() => ({
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
    }));
  });

  describe("registerSessionPersistence / getSessionDbId", () => {
    it("registers a subprocess and retrieves its session DB ID", () => {
      registerSessionPersistence("proc-1", 100);
      expect(getSessionDbId("proc-1")).toBe(100);
    });

    it("returns undefined for unknown subprocess ID", () => {
      expect(getSessionDbId("unknown-proc")).toBeUndefined();
    });

    it("overwrites existing registration", () => {
      registerSessionPersistence("proc-2", 200);
      registerSessionPersistence("proc-2", 300);
      expect(getSessionDbId("proc-2")).toBe(300);
    });
  });

  describe("getSubprocessIdForSession", () => {
    it("finds subprocess ID for a registered session DB ID", () => {
      registerSessionPersistence("proc-3", 400);
      expect(getSubprocessIdForSession(400)).toBe("proc-3");
    });

    it("returns undefined for unknown session DB ID", () => {
      expect(getSubprocessIdForSession(99999)).toBeUndefined();
    });
  });

  describe("getSubprocessIdsForSessionDbIds", () => {
    it("returns subprocess IDs for matching session DB IDs", () => {
      registerSessionPersistence("proc-a", 501);
      registerSessionPersistence("proc-b", 502);
      registerSessionPersistence("proc-c", 503);
      const result = getSubprocessIdsForSessionDbIds([501, 503]);
      expect(result).toContain("proc-a");
      expect(result).toContain("proc-c");
      expect(result).not.toContain("proc-b");
    });

    it("returns empty array for no matches", () => {
      expect(getSubprocessIdsForSessionDbIds([99998])).toEqual([]);
    });
  });

  describe("persistStreamEvent", () => {
    it("persists text content_block_start event with null model by default", () => {
      const mockRun = vi.fn().mockReturnValue({ lastInsertRowid: 10 });
      mockDb.prepare.mockReturnValue({ run: mockRun });

      const id = persistStreamEvent(1, {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "Hello world" },
      });

      expect(id).toBe(10);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO agent_messages"),
      );
      expect(mockRun).toHaveBeenCalledWith(1, "assistant", "Hello world", "text", null, null, null, null);
    });

    it("persists tool_use content_block_start event", () => {
      const mockRun = vi.fn().mockReturnValue({ lastInsertRowid: 11 });
      mockDb.prepare.mockReturnValue({ run: mockRun });

      const id = persistStreamEvent(1, {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "tool-id-1",
          name: "Bash",
          input: { command: "ls" },
        },
      });

      expect(id).toBe(11);
      expect(mockRun).toHaveBeenCalledWith(
        1, "assistant", JSON.stringify({ command: "ls" }), "tool_call", "Bash", "tool-id-1", null, null,
      );
    });

    it("persists text_delta event", () => {
      const mockRun = vi.fn().mockReturnValue({ lastInsertRowid: 12 });
      mockDb.prepare.mockReturnValue({ run: mockRun });

      persistStreamEvent(1, {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "delta text" },
      });

      expect(mockRun).toHaveBeenCalledWith(1, "assistant", "delta text", "text_delta", null, null, null, null);
    });

    it("persists tool_result event", () => {
      const mockRun = vi.fn().mockReturnValue({ lastInsertRowid: 13 });
      mockDb.prepare.mockReturnValue({ run: mockRun });

      persistStreamEvent(1, {
        type: "tool_result",
        tool_use_id: "tool-id-1",
        content: "command output",
        is_error: false,
      });

      expect(mockRun).toHaveBeenCalledWith(
        1, "tool", "command output", "tool_result", null, "tool-id-1", null, null,
      );
    });

    it("persists error event", () => {
      const mockRun = vi.fn().mockReturnValue({ lastInsertRowid: 14 });
      mockDb.prepare.mockReturnValue({ run: mockRun });

      persistStreamEvent(1, {
        type: "error",
        error: { type: "api_error", message: "Something went wrong" },
      });

      expect(mockRun).toHaveBeenCalledWith(
        1, "system", "Something went wrong", "error", null, null, null, null,
      );
    });

    it("captures model from message_start and includes it in subsequent events", () => {
      const mockRun = vi.fn().mockReturnValue({ lastInsertRowid: 15 });
      mockDb.prepare.mockReturnValue({ run: mockRun });

      // message_start sets the model for this session
      persistStreamEvent(42, {
        type: "message_start",
        message: { id: "msg-1", type: "message", role: "assistant", model: "claude-sonnet-4-6" },
      } as any);

      // No INSERT for message_start itself
      expect(mockRun).not.toHaveBeenCalled();

      // Subsequent text block should carry the model
      persistStreamEvent(42, {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "Hello" },
      });

      expect(mockRun).toHaveBeenCalledWith(42, "assistant", "Hello", "text", null, null, null, "claude-sonnet-4-6");
    });

    it("setSessionModel sets model for subsequent events", () => {
      const mockRun = vi.fn().mockReturnValue({ lastInsertRowid: 16 });
      mockDb.prepare.mockReturnValue({ run: mockRun });

      setSessionModel(99, "claude-opus-4-6");

      persistStreamEvent(99, {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "Hi" },
      });

      expect(mockRun).toHaveBeenCalledWith(99, "assistant", "Hi", "text", null, null, null, "claude-opus-4-6");
    });

    it("skips message_stop events (no INSERT)", () => {
      const mockRun = vi.fn();
      mockDb.prepare.mockReturnValue({ run: mockRun });

      persistStreamEvent(1, { type: "message_stop" } as any);

      expect(mockRun).not.toHaveBeenCalled();
    });

    it("returns null on DB error (best-effort)", () => {
      mockDb.prepare.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = persistStreamEvent(1, {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "test" },
      });
      expect(result).toBeNull();
    });

    it("uses parentToolUseId when provided", () => {
      const mockRun = vi.fn().mockReturnValue({ lastInsertRowid: 20 });
      mockDb.prepare.mockReturnValue({ run: mockRun });

      persistStreamEvent(
        1,
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "nested" },
        },
        "parent-tool-123",
      );

      expect(mockRun).toHaveBeenCalledWith(1, "assistant", "nested", "text", null, null, "parent-tool-123", null);
    });
  });

  describe("persistClaudeSessionId", () => {
    it("updates agent_sessions with claude session ID", () => {
      const mockRun = vi.fn();
      mockDb.prepare.mockReturnValue({ run: mockRun });

      persistClaudeSessionId(5, "claude-session-abc");

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE agent_sessions SET claude_session_id"),
      );
      expect(mockRun).toHaveBeenCalledWith("claude-session-abc", 5);
    });

    it("silently ignores DB errors (best-effort)", () => {
      mockDb.prepare.mockImplementation(() => {
        throw new Error("DB error");
      });

      expect(() => persistClaudeSessionId(5, "session-id")).not.toThrow();
    });
  });

  describe("notifyDbUpdated", () => {
    it("broadcasts DB_UPDATED_CHANNEL with entity and featureId", () => {
      notifyDbUpdated("agent_session", 42);

      expect(broadcast).toHaveBeenCalledWith("db:updated", {
        entity: "agent_session",
        featureId: 42,
      });
    });

    it("supports all entity types", () => {
      notifyDbUpdated("feature", 1);
      notifyDbUpdated("phase", 2);
      notifyDbUpdated("plan", 3);

      expect(broadcast).toHaveBeenCalledTimes(3);
    });
  });

  describe("restoreSessionMap", () => {
    it("marks stale orchestrator sessions as error on startup", () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        // Return a stale orchestrator from the SELECT so the UPDATE branch fires
        if (sql.includes("SELECT id, feature_id FROM agent_sessions") && sql.includes("subprocess_id IS NULL")) {
          return { all: vi.fn().mockReturnValue([{ id: 672, feature_id: 1 }]) };
        }
        return { run: vi.fn(), all: vi.fn().mockReturnValue([]), get: vi.fn() };
      });

      restoreSessionMap();

      const allSqls = mockDb.prepare.mock.calls.map((c: unknown[]) => c[0] as string);
      const orchestratorUpdate = allSqls.find((s) =>
        s.includes("status = 'error'") && s.includes("subprocess_id IS NULL") && s.includes("phase_id IS NULL") && s.includes("UPDATE"),
      );
      expect(orchestratorUpdate).toBeDefined();
    });

    it("marks running sessions as paused on startup", () => {
      const mockRun = vi.fn();
      const mockAll = vi.fn().mockReturnValue([]);
      mockDb.prepare.mockReturnValue({ run: mockRun, all: mockAll, get: vi.fn() });

      restoreSessionMap();

      // Should call UPDATE to set running->paused
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE agent_sessions SET status = 'paused'"),
      );
    });

    it("clears pending_plan_approval alongside subprocess_id on startup", () => {
      const mockRun = vi.fn();
      const mockAll = vi.fn().mockReturnValue([]);
      mockDb.prepare.mockReturnValue({ run: mockRun, all: mockAll, get: vi.fn() });

      restoreSessionMap();

      const allSqls = mockDb.prepare.mock.calls.map((c) => c[0] as string);
      const updateSql = allSqls.find((s) => s.includes("UPDATE agent_sessions SET status = 'paused'"));
      expect(updateSql).toBeDefined();
      expect(updateSql).toContain("pending_plan_approval = NULL");
    });

    it("repopulates session map from paused sessions with subprocess IDs", () => {
      const mockRun = vi.fn();
      const mockAll = vi.fn()
        .mockReturnValueOnce([]) // stale orchestrator sessions
        .mockReturnValueOnce([]) // stale running sessions
        .mockReturnValueOnce([
          { id: 99, subprocess_id: "proc-restored" },
        ]);
      mockDb.prepare.mockReturnValue({ run: mockRun, all: mockAll, get: vi.fn() });

      restoreSessionMap();

      expect(getSessionDbId("proc-restored")).toBe(99);
    });

    it("does not throw if DB is unavailable", () => {
      (getDatabase as any).mockImplementation(() => {
        throw new Error("DB not ready");
      });

      expect(() => restoreSessionMap()).not.toThrow();
    });
  });
});
