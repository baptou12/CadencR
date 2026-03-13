/**
 * Tests for subprocess-manager.ts — spawning, event handling, lifecycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockSdkClient } from "./__mocks__/sdk-client.mock";

vi.mock("../db/database", () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn().mockImplementation(() => ({
      get: vi.fn().mockReturnValue(undefined),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
    })),
    exec: vi.fn(),
    pragma: vi.fn().mockReturnValue([]),
    transaction: vi.fn().mockImplementation((fn: () => void) => fn),
    close: vi.fn(),
  })),
}));

vi.mock("./broadcast", () => ({
  broadcast: vi.fn(),
  AGENT_EVENT_CHANNEL: "agent:event",
  DB_UPDATED_CHANNEL: "db:updated",
  ASK_USER_QUESTION_CHANNEL: "ask:question",
  ASK_USER_ANSWER_CHANNEL: "ask:answer",
  TOOL_PERMISSION_CHANNEL: "tool:permission",
}));

vi.mock("./cli-discovery", () => {
  const { Effect } = require("effect");
  return {
    discoverClaudeCli: vi.fn().mockReturnValue(Effect.succeed({ path: "/usr/bin/claude", source: "process-path" })),
  };
});

vi.mock("./session-persistence", () => ({
  getSessionDbId: vi.fn().mockReturnValue(undefined),
  persistStreamEvent: vi.fn(),
  persistClaudeSessionId: vi.fn(),
  notifyDbUpdated: vi.fn(),
  DB_UPDATED_CHANNEL: "db:updated",
}));

vi.mock("./state-transitions", () => ({
  transitionAgentSession: vi.fn(),
}));

vi.mock("./permissions", () => ({
  loadAllowedPatterns: vi.fn().mockResolvedValue([]),
}));

vi.mock("./tool-permissions", () => ({
  createCanUseToolHandler: vi.fn().mockReturnValue(async () => ({ behavior: "allow" })),
  submitToolPermission: vi.fn(),
  submitUserAnswers: vi.fn(),
}));

vi.mock("./slash-commands", () => ({
  getSupportedCommands: vi.fn().mockReturnValue([]),
}));

vi.mock("./models", () => ({
  DEFAULT_MODEL: "claude-opus-4-5",
}));

import { setSdkClient } from "./sdk-client";

import {
  startSubprocess,
  stopSubprocess,
  listSubprocesses,
  killAllSubprocesses,
  hasRunningSubprocesses,
  generateSubprocessId,
  getActiveProcess,
} from "./subprocess-manager";

async function wait(ms = 20): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe("subprocess-manager", () => {
  let mockSdk: ReturnType<typeof createMockSdkClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSdk = createMockSdkClient();
    setSdkClient(mockSdk.client);
  });

  afterEach(async () => {
    try { mockSdk.complete(); } catch {}
    await wait(20);
    killAllSubprocesses();
    await wait(20);
    setSdkClient(null);
  });

  describe("generateSubprocessId", () => {
    it("generates unique IDs matching agent- pattern", () => {
      const id1 = generateSubprocessId();
      const id2 = generateSubprocessId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^agent-/);
    });
  });

  describe("startSubprocess", () => {
    it("creates a managed subprocess with correct properties", () => {
      const managed = startSubprocess({
        cwd: "/project",
        agentType: "plan",
        prompt: "Plan this feature",
        id: "test-id-1",
      });

      expect(managed.id).toBe("test-id-1");
      expect(managed.agentType).toBe("plan");
      expect(managed.status).toBe("running");
      expect(managed.eventListeners).toEqual([]);
      expect(managed.completionListeners).toEqual([]);
      expect(managed.cachedPermissions).toBeInstanceOf(Set);
      expect(managed.cachedPermissions.size).toBe(0);
    });

    it("calls event and completion listeners on SDK messages", async () => {
      const managed = startSubprocess({
        cwd: "/project",
        agentType: "plan",
        prompt: "Plan",
        id: "test-id-2",
      });

      const eventListener = vi.fn();
      const completionListener = vi.fn();
      managed.eventListeners.push(eventListener);
      managed.completionListeners.push(completionListener);

      // Wait for SDK query to be created (runSdkQuery is async)
      await wait(10);

      mockSdk.emitMessage({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "Hello" },
        },
      });
      mockSdk.complete();
      await wait(100);

      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "content_block_start" }),
      );
      expect(completionListener).toHaveBeenCalledWith(0);
    });
  });

  describe("listSubprocesses", () => {
    it("returns running subprocesses", () => {
      startSubprocess({ cwd: "/project", agentType: "plan", prompt: "test", id: "test-id-3" });
      const list = listSubprocesses();
      const found = list.find((p) => p.id === "test-id-3");
      expect(found).toBeDefined();
      expect(found?.agentType).toBe("plan");
      expect(found?.status).toBe("running");
    });
  });

  describe("stopSubprocess", () => {
    it("returns false for unknown ID", async () => {
      expect(await stopSubprocess("nonexistent-id")).toBe(false);
    });

    it("pauses a running subprocess", async () => {
      const managed = startSubprocess({
        cwd: "/project", agentType: "plan", prompt: "Plan", id: "test-id-4",
      });
      const result = await stopSubprocess(managed.id);
      expect(result).toBe(true);
      expect(managed.status).toBe("paused");
    });
  });

  describe("hasRunningSubprocesses", () => {
    it("returns false when no subprocesses started", () => {
      expect(hasRunningSubprocesses()).toBe(false);
    });
  });

  describe("killAllSubprocesses", () => {
    it("marks running subprocesses as stopped", () => {
      const managed = startSubprocess({
        cwd: "/project", agentType: "plan", prompt: "test", id: "test-id-5",
      });

      killAllSubprocesses();
      expect(managed.status).toBe("stopped");
    });
  });

  describe("getActiveProcess", () => {
    it("returns undefined for unknown ID and found process for known ID", () => {
      expect(getActiveProcess("unknown")).toBeUndefined();

      const managed = startSubprocess({
        cwd: "/project", agentType: "plan", prompt: "test", id: "test-id-6",
      });
      expect(getActiveProcess("test-id-6")).toBe(managed);
    });
  });

  describe("compact_boundary system event", () => {
    it("processes compact_boundary system event without error", async () => {
      // NOTE: compact_boundary persistence and broadcasting is now handled
      // by SdkQueryRunner (Effect service). This test verifies the subprocess
      // lifecycle still works correctly when a compact_boundary event is received.
      // Detailed assertions are in SdkQueryRunner.test.ts.

      const managed = startSubprocess({
        cwd: "/project",
        agentType: "session",
        prompt: "Do something",
        id: "test-compact",
      });

      await wait(10);

      // Emit a system message with compact_boundary subtype
      mockSdk.emitMessage({
        type: "system",
        subtype: "compact_boundary",
      });

      mockSdk.complete();
      await wait(100);

      // Subprocess should have completed normally
      expect(managed.status).toBe("completed");
    });
  });

  describe("SDK message handling", () => {
    it("fires event listeners for stream_event messages", async () => {
      // NOTE: stream event persistence is now handled by SdkQueryRunner (Effect service).
      // This test verifies that managed.eventListeners are called, which is still
      // subprocess-manager's responsibility (via SdkQueryRunner calling them).
      // Detailed persistence assertions are in SdkQueryRunner.test.ts.

      const managed = startSubprocess({
        cwd: "/project",
        agentType: "plan",
        prompt: "Plan",
        id: "test-id-7",
      });

      const eventListener = vi.fn();
      managed.eventListeners.push(eventListener);

      await wait(10);

      // Test stream_event — event listener should be called
      mockSdk.emitMessage({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "Hello" },
        },
      });

      // Test assistant message with content blocks
      mockSdk.emitMessage({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Response text" }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      });
      mockSdk.complete();
      await wait(100);

      // eventListener should be called for stream_event messages
      expect(eventListener).toHaveBeenCalled();
    });
  });
});
