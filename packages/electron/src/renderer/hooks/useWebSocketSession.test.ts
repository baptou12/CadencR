import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { DEFAULT_MODEL } from "../../shared/models";

vi.mock("@/api/generated", () => ({
  useGetFeatureAgentState: vi.fn(() => ({ data: undefined, isLoading: false })),
  getGetFeatureQueryKey: (id: number) => ["features", "detail", id],
  getGetFeaturePrdQueryKey: (id: number) => ["features", "prd", id],
  getGetFeaturePlanQueryKey: (id: number) => ["features", "plan", id],
  getGetFeaturePlanProgressQueryKey: (id: number) => ["features", "planProgress", id],
  getGetFeatureSettingsQueryKey: (id: number) => ["features", "settings", id],
}));

import { useWebSocketSession } from "./useWebSocketSession";
import { useWsSessionStore } from "@/stores/ws-session-store";

// --- Mock WebSocket ---

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  private listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
    // Auto-fire open
    setTimeout(() => this.fireEvent("open"), 0);
  }

  addEventListener(event: string, cb: (...args: unknown[]) => void) {
    (this.listeners[event] ??= []).push(cb);
  }

  removeEventListener() {}

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  // Test helpers
  fireEvent(event: string, data?: unknown) {
    for (const cb of this.listeners[event] ?? []) {
      cb(data ?? {});
    }
  }

  simulateMessage(envelope: { domain: string; action: string; payload: unknown }) {
    const raw = JSON.stringify({ id: "srv-1", ...envelope });
    this.fireEvent("message", { data: raw });
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}

// Assign static constants to prototype for WebSocket.OPEN etc
Object.assign(MockWebSocket, { OPEN: 1, CONNECTING: 0, CLOSED: 3 });

beforeEach(() => {
  MockWebSocket.reset();
  // Reset Zustand store between tests
  useWsSessionStore.setState({ sessions: {} });
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal("window", { ...globalThis.window });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

describe("useWebSocketSession", () => {
  it("connects to WebSocket on mount", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(MockWebSocket.instances.length).toBe(1);
    expect(result.current.isConnected).toBe(true);
  });

  it("currentModelId defaults to DEFAULT_MODEL", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(result.current.currentModelId).toBe(DEFAULT_MODEL);
  });

  it("initSession sends correct envelope", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    act(() => {
      result.current.initSession({ model: "opus" });
    });
    const ws = getWs();
    const sent = JSON.parse(ws.sent[0]);
    expect(sent.domain).toBe("session");
    expect(sent.action).toBe("init");
    expect(sent.payload.model).toBe("opus");
  });

  it("sendPrompt sends correct envelope", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    act(() => {
      result.current.sendPrompt("hello");
    });
    const ws = getWs();
    const sent = JSON.parse(ws.sent[0]);
    expect(sent.domain).toBe("session");
    expect(sent.action).toBe("prompt.send");
    expect(sent.payload.text).toBe("hello");
  });

  it("incoming session.message updates blocks", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    // Send a full assistant message (fallback path when no stream events)
    act(() => {
      getWs().simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "assistant",
            uuid: "u1",
            session_id: "s1",
            parent_tool_use_id: null,
            error: null,
            message: {
              id: "msg1",
              model: "claude-opus-4-6",
              content: [{ type: "text", text: "hi" }],
              stop_reason: null,
            },
          }],
        },
      });
    });
    expect(result.current.blocks).toHaveLength(1);
    expect(result.current.blocks[0].content).toBe("hi");
    expect(result.current.status).toBe("running");
  });

  it("incoming permission.request sets pendingPermission", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    act(() => {
      getWs().simulateMessage({
        domain: "session",
        action: "permission.request",
        payload: {
          request_id: "r1",
          tool_name: "bash",
          tool_input: { command: "ls" },
          description: "run ls",
        },
      });
    });
    expect(result.current.pendingPermission).toEqual({
      toolName: "bash",
      input: { command: "ls" },
      description: "run ls",
      pattern: "",
    });
    expect(result.current.status).toBe("paused");
  });

  it("permission.request stores request_id in pendingRequestId", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    act(() => {
      getWs().simulateMessage({
        domain: "session",
        action: "permission.request",
        payload: { request_id: "req_42", tool_name: "Write", tool_input: {}, description: "" },
      });
    });
    expect(result.current.pendingRequestId).toBe("req_42");
  });

  it("respondToPermission sends request_id in envelope and clears state", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    // Simulate server assigning session
    act(() => {
      getWs().simulateMessage({
        domain: "session",
        action: "initialized",
        payload: { session_id: "srv-1" },
      });
    });
    act(() => {
      getWs().simulateMessage({
        domain: "session",
        action: "permission.request",
        payload: { request_id: "r1", tool_name: "bash", tool_input: {}, description: "" },
      });
    });
    act(() => {
      result.current.respondToPermission("r1", true);
    });
    expect(result.current.pendingPermission).toBeNull();
    expect(result.current.pendingRequestId).toBe("");
    const sent = JSON.parse(getWs().sent[0]);
    expect(sent.domain).toBe("session");
    expect(sent.action).toBe("permission.respond");
    expect(sent.payload.request_id).toBe("r1");
    expect(sent.payload.decision).toBe("allow_once");
  });

  it("session.error sets error status", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    act(() => {
      getWs().simulateMessage({
        domain: "session",
        action: "error",
        payload: { code: "ERR", message: "something broke" },
      });
    });
    expect(result.current.status).toBe("error");
  });

  it("session.ended sets completed status", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    act(() => {
      getWs().simulateMessage({
        domain: "session",
        action: "ended",
        payload: { reason: "done" },
      });
    });
    expect(result.current.status).toBe("idle");
  });

  it("multi-turn conversation accumulates blocks across turns", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    // 1. init
    act(() => {
      result.current.initSession({ model: "opus" });
    });

    // 2. initialized
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "initialized",
        payload: { session_id: "srv-multi" },
      });
    });
    expect(result.current.status).toBe("idle");

    // 3. First prompt
    act(() => {
      result.current.sendPrompt("hello");
    });
    expect(result.current.status).toBe("running");
    // User message block added locally
    expect(result.current.blocks).toHaveLength(1);
    expect(result.current.blocks[0].type).toBe("user_message");

    // 4. Stream events for first turn: message_start, content_block_start, content_block_delta
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [
            {
              type: "stream_event",
              uuid: "se1",
              session_id: "srv-multi",
              parent_tool_use_id: null,
              event: { type: "message_start", message: { model: "claude-opus-4-6" } },
            },
            {
              type: "stream_event",
              uuid: "se2",
              session_id: "srv-multi",
              parent_tool_use_id: null,
              event: { type: "content_block_start", index: 0, content_block: { type: "text" } },
            },
            {
              type: "stream_event",
              uuid: "se3",
              session_id: "srv-multi",
              parent_tool_use_id: null,
              event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi there" } },
            },
          ],
        },
      });
    });
    // user_message + text block = 2
    expect(result.current.blocks).toHaveLength(2);
    expect(result.current.blocks[1].type).toBe("text");
    expect(result.current.blocks[1].content).toBe("Hi there");

    // 5. First turn ends
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "ended",
        payload: { reason: "done" },
      });
    });
    expect(result.current.status).toBe("idle");

    // 6. Second prompt
    act(() => {
      result.current.sendPrompt("thanks");
    });
    expect(result.current.status).toBe("running");
    // Now: user_message + text + user_message = 3
    expect(result.current.blocks).toHaveLength(3);
    expect(result.current.blocks[2].type).toBe("user_message");
    expect(result.current.blocks[2].content).toBe("thanks");

    // 7. Stream events for second turn
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [
            {
              type: "stream_event",
              uuid: "se4",
              session_id: "srv-multi",
              parent_tool_use_id: null,
              event: { type: "message_start", message: { model: "claude-opus-4-6" } },
            },
            {
              type: "stream_event",
              uuid: "se5",
              session_id: "srv-multi",
              parent_tool_use_id: null,
              event: { type: "content_block_start", index: 0, content_block: { type: "text" } },
            },
            {
              type: "stream_event",
              uuid: "se6",
              session_id: "srv-multi",
              parent_tool_use_id: null,
              event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "You're welcome" } },
            },
          ],
        },
      });
    });
    // user_message + text + user_message + text = 4
    expect(result.current.blocks).toHaveLength(4);
    expect(result.current.blocks[3].type).toBe("text");
    expect(result.current.blocks[3].content).toBe("You're welcome");

    // 8. Second turn ends
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "ended",
        payload: { reason: "done" },
      });
    });
    expect(result.current.status).toBe("idle");

    // Verify all blocks accumulated correctly
    expect(result.current.blocks.map((b) => b.type)).toEqual([
      "user_message",
      "text",
      "user_message",
      "text",
    ]);
    expect(result.current.blocks[0].content).toBe("hello");
    expect(result.current.blocks[1].content).toBe("Hi there");
    expect(result.current.blocks[2].content).toBe("thanks");
    expect(result.current.blocks[3].content).toBe("You're welcome");
  });

  // ---------------------------------------------------------------------------
  // Plan approval flow
  // ---------------------------------------------------------------------------

  it("ExitPlanMode in stream triggers plan approval on turn_complete", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    // Stream an ExitPlanMode tool_use
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [
            {
              type: "stream_event",
              uuid: "se1",
              session_id: "s1",
              parent_tool_use_id: null,
              event: { type: "message_start", message: { model: "claude-opus-4-6" } },
            },
            {
              type: "stream_event",
              uuid: "se2",
              session_id: "s1",
              parent_tool_use_id: null,
              event: {
                type: "content_block_start",
                index: 0,
                content_block: { type: "tool_use", id: "toolu_1", name: "ExitPlanMode", input: {} },
              },
            },
          ],
        },
      });
    });

    // Status should be running (approval bar not shown yet)
    expect(result.current.status).toBe("running");
    expect(result.current.pendingPlanApproval).toBeNull();

    // turn_complete triggers the approval bar
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "turn_complete",
        payload: {},
      });
    });

    expect(result.current.pendingPlanApproval).toEqual({});
    expect(result.current.status).toBe("paused");
  });

  it("turn_complete without ExitPlanMode goes idle normally", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    // Stream a normal text block (no ExitPlanMode)
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [
            {
              type: "stream_event",
              uuid: "se1",
              session_id: "s1",
              parent_tool_use_id: null,
              event: { type: "message_start", message: { model: "claude-opus-4-6" } },
            },
            {
              type: "stream_event",
              uuid: "se2",
              session_id: "s1",
              parent_tool_use_id: null,
              event: { type: "content_block_start", index: 0, content_block: { type: "text" } },
            },
          ],
        },
      });
    });

    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "turn_complete",
        payload: {},
      });
    });

    expect(result.current.pendingPlanApproval).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("approvePlan clears approval, sends mode.set + prompt, sets running", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    // Initialize session
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "initialized",
        payload: { session_id: "srv-1" },
      });
    });

    // Trigger plan approval
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "stream_event",
            uuid: "se1",
            session_id: "s1",
            parent_tool_use_id: null,
            event: {
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "toolu_1", name: "ExitPlanMode", input: {} },
            },
          }],
        },
      });
    });
    act(() => {
      ws.simulateMessage({ domain: "session", action: "turn_complete", payload: {} });
    });
    expect(result.current.pendingPlanApproval).toEqual({});

    // Approve
    act(() => {
      result.current.approvePlan();
    });

    expect(result.current.pendingPlanApproval).toBeNull();
    expect(result.current.permissionMode).toBe("acceptEdits");
    expect(result.current.status).toBe("running");

    // Should have sent mode.set and prompt.send
    const sentMessages = ws.sent.map((s) => JSON.parse(s));
    const modeSet = sentMessages.find((m) => m.action === "mode.set");
    expect(modeSet).toBeDefined();
    expect(modeSet.payload.mode).toBe("acceptEdits");

    const promptSend = sentMessages.find((m) => m.action === "prompt.send");
    expect(promptSend).toBeDefined();
    expect(promptSend.payload.text).toContain("Plan approved");
  });

  it("requestPlanChanges clears approval, echoes feedback, sends prompt", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "initialized",
        payload: { session_id: "srv-1" },
      });
    });

    // Trigger plan approval
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "stream_event",
            uuid: "se1",
            session_id: "s1",
            parent_tool_use_id: null,
            event: {
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "toolu_1", name: "ExitPlanMode", input: {} },
            },
          }],
        },
      });
    });
    act(() => {
      ws.simulateMessage({ domain: "session", action: "turn_complete", payload: {} });
    });

    // Request changes
    act(() => {
      result.current.requestPlanChanges("Use a different approach");
    });

    expect(result.current.pendingPlanApproval).toBeNull();
    expect(result.current.status).toBe("running");

    // Feedback should appear as user message in blocks
    const userMessages = result.current.blocks.filter((b) => b.type === "user_message");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toBe("Use a different approach");

    // Should have sent prompt.send with feedback
    const sentMessages = ws.sent.map((s) => JSON.parse(s));
    const promptSend = sentMessages.find((m) => m.action === "prompt.send");
    expect(promptSend).toBeDefined();
    expect(promptSend.payload.text).toBe("Use a different approach");
  });

  it("setPermissionMode sends mode.set envelope and updates state", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "initialized",
        payload: { session_id: "srv-1" },
      });
    });

    act(() => {
      result.current.setPermissionMode("plan");
    });

    expect(result.current.permissionMode).toBe("plan");
    const sent = JSON.parse(ws.sent[0]);
    expect(sent.action).toBe("mode.set");
    expect(sent.payload.mode).toBe("plan");
  });

  it("mode.changed envelope updates permissionMode state", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      getWs().simulateMessage({
        domain: "session",
        action: "mode.changed",
        payload: { mode: "plan" },
      });
    });

    expect(result.current.permissionMode).toBe("plan");
  });

  it("assistant message backfills ExitPlanMode tool args", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    // Stream ExitPlanMode with empty delta, then full assistant message
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [
            {
              type: "stream_event",
              uuid: "se1",
              session_id: "s1",
              parent_tool_use_id: null,
              event: { type: "message_start", message: { model: "claude-opus-4-6" } },
            },
            {
              type: "stream_event",
              uuid: "se2",
              session_id: "s1",
              parent_tool_use_id: null,
              event: {
                type: "content_block_start",
                index: 0,
                content_block: { type: "tool_use", id: "toolu_1", name: "ExitPlanMode", input: {} },
              },
            },
            {
              type: "stream_event",
              uuid: "se3",
              session_id: "s1",
              parent_tool_use_id: null,
              event: {
                type: "content_block_delta",
                index: 0,
                delta: { type: "input_json_delta", partial_json: "" },
              },
            },
            // Full assistant message with complete input
            {
              type: "assistant",
              uuid: "a1",
              session_id: "s1",
              parent_tool_use_id: null,
              error: null,
              message: {
                id: "msg1",
                model: "claude-opus-4-6",
                content: [{
                  type: "tool_use",
                  id: "toolu_1",
                  name: "ExitPlanMode",
                  input: { plan: "# My Plan\nDo stuff", planFilePath: "/tmp/plan.md" },
                }],
                stop_reason: null,
              },
            },
          ],
        },
      });
    });

    // The tool_call block should have the full args from the assistant message
    const toolBlock = result.current.blocks.find((b) => b.type === "tool_call");
    expect(toolBlock).toBeDefined();
    expect(toolBlock!.toolName).toBe("ExitPlanMode");
    const args = JSON.parse(toolBlock!.toolArgs!);
    expect(args.plan).toBe("# My Plan\nDo stuff");
    expect(args.planFilePath).toBe("/tmp/plan.md");
  });

  // ---------------------------------------------------------------------------
  // Subagent / nested block nesting
  // ---------------------------------------------------------------------------

  it("subagent tool calls are nested into parent Agent block's childBlocks", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    // 1. Stream the parent Agent tool_call
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [
            {
              type: "stream_event", uuid: "se1", session_id: "s1", parent_tool_use_id: null,
              event: { type: "message_start", message: { model: "claude-opus-4-6" } },
            },
            {
              type: "stream_event", uuid: "se2", session_id: "s1", parent_tool_use_id: null,
              event: {
                type: "content_block_start", index: 0,
                content_block: { type: "tool_use", id: "toolu_agent", name: "Agent" },
              },
            },
          ],
        },
      });
    });

    // Parent block should exist at root with empty childBlocks
    expect(result.current.blocks).toHaveLength(1);
    expect(result.current.blocks[0].toolName).toBe("Agent");
    expect(result.current.blocks[0].childBlocks).toEqual([]);

    // 2. Subagent sends tool calls as assistant messages with parent_tool_use_id
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "assistant", uuid: "a1", session_id: "s1",
            parent_tool_use_id: "toolu_agent", error: null,
            message: {
              id: "msg2", model: "claude-haiku-4-5-20251001", stop_reason: null,
              content: [{ type: "tool_use", id: "toolu_bash1", name: "Bash", input: { command: "ls" } }],
            },
          }],
        },
      });
    });

    // Root should still have 1 block (Agent), child nested inside
    expect(result.current.blocks).toHaveLength(1);
    const agentBlock = result.current.blocks[0];
    expect(agentBlock.childBlocks).toHaveLength(1);
    expect(agentBlock.childBlocks![0].toolName).toBe("Bash");
    expect(agentBlock.childBlocks![0].parentToolUseId).toBe("toolu_agent");
  });

  it("subagent childBlocks only shows tool_call types (text/thinking filtered by UI)", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    // Create parent Agent block
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "stream_event", uuid: "se1", session_id: "s1", parent_tool_use_id: null,
            event: {
              type: "content_block_start", index: 0,
              content_block: { type: "tool_use", id: "toolu_agent", name: "Agent" },
            },
          }],
        },
      });
    });

    // Send assistant message with text + tool_use from subagent
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "assistant", uuid: "a1", session_id: "s1",
            parent_tool_use_id: "toolu_agent", error: null,
            message: {
              id: "msg2", model: "claude-haiku-4-5-20251001", stop_reason: null,
              content: [
                { type: "text", text: "Let me search" },
                { type: "tool_use", id: "toolu_grep", name: "Grep", input: { pattern: "foo" } },
              ],
            },
          }],
        },
      });
    });

    const agentBlock = result.current.blocks[0];
    // Both text and tool_call are in childBlocks
    expect(agentBlock.childBlocks).toHaveLength(2);
    expect(agentBlock.childBlocks![0].type).toBe("text");
    expect(agentBlock.childBlocks![1].type).toBe("tool_call");
    expect(agentBlock.childBlocks![1].toolName).toBe("Grep");
  });

  it("multiple subagent tool calls accumulate in childBlocks without duplicates", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    // Create parent Agent block
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "stream_event", uuid: "se1", session_id: "s1", parent_tool_use_id: null,
            event: {
              type: "content_block_start", index: 0,
              content_block: { type: "tool_use", id: "toolu_agent", name: "Agent" },
            },
          }],
        },
      });
    });

    // Send 7 tool calls one at a time
    for (let i = 1; i <= 7; i++) {
      act(() => {
        ws.simulateMessage({
          domain: "session",
          action: "message",
          payload: {
            blocks: [{
              type: "assistant", uuid: `a${i}`, session_id: "s1",
              parent_tool_use_id: "toolu_agent", error: null,
              message: {
                id: `msg${i}`, model: "claude-haiku-4-5-20251001", stop_reason: null,
                content: [{ type: "tool_use", id: `toolu_${i}`, name: "Bash", input: { command: `cmd${i}` } }],
              },
            }],
          },
        });
      });
    }

    // All 7 should be nested, no duplicates
    expect(result.current.blocks).toHaveLength(1);
    const agentBlock = result.current.blocks[0];
    expect(agentBlock.childBlocks).toHaveLength(7);

    // Verify unique IDs (no duplicates)
    const ids = agentBlock.childBlocks!.map((b) => b.id);
    expect(new Set(ids).size).toBe(7);

    // Verify unique toolUseIds
    const toolUseIds = agentBlock.childBlocks!.map((b) => b.toolUseId);
    expect(new Set(toolUseIds).size).toBe(7);
  });

  it("subagent assistant messages skip backfill path (different parentToolUseId)", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    // Stream parent Agent via stream events (populates contentBlockIds)
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [
            {
              type: "stream_event", uuid: "se1", session_id: "s1", parent_tool_use_id: null,
              event: { type: "message_start", message: { model: "claude-opus-4-6" } },
            },
            {
              type: "stream_event", uuid: "se2", session_id: "s1", parent_tool_use_id: null,
              event: {
                type: "content_block_start", index: 0,
                content_block: { type: "tool_use", id: "toolu_agent", name: "Agent" },
              },
            },
            {
              type: "stream_event", uuid: "se3", session_id: "s1", parent_tool_use_id: null,
              event: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"desc' } },
            },
            // Backfill from parent's assistant message (same parent context)
            {
              type: "assistant", uuid: "a0", session_id: "s1",
              parent_tool_use_id: null, error: null,
              message: {
                id: "msg0", model: "claude-opus-4-6", stop_reason: null,
                content: [{ type: "tool_use", id: "toolu_agent", name: "Agent", input: { description: "explore" } }],
              },
            },
          ],
        },
      });
    });

    // Now subagent sends assistant message with different parent_tool_use_id
    // This should NOT hit the backfill path — it should create a new block
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "assistant", uuid: "a1", session_id: "s1",
            parent_tool_use_id: "toolu_agent", error: null,
            message: {
              id: "msg1", model: "claude-haiku-4-5-20251001", stop_reason: null,
              content: [{ type: "tool_use", id: "toolu_read", name: "Read", input: { file_path: "/tmp/a" } }],
            },
          }],
        },
      });
    });

    expect(result.current.blocks).toHaveLength(1);
    const agentBlock = result.current.blocks[0];
    expect(agentBlock.childBlocks).toHaveLength(1);
    expect(agentBlock.childBlocks![0].toolName).toBe("Read");
  });

  it("taskComplete is set when parentToolUseId changes", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    // Create parent Agent block via stream event
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [
            {
              type: "stream_event", uuid: "se1", session_id: "s1", parent_tool_use_id: null,
              event: { type: "message_start", message: { model: "claude-opus-4-6" } },
            },
            {
              type: "stream_event", uuid: "se2", session_id: "s1", parent_tool_use_id: null,
              event: {
                type: "content_block_start", index: 0,
                content_block: { type: "tool_use", id: "toolu_agent", name: "Agent" },
              },
            },
          ],
        },
      });
    });

    // Subagent sends a tool call (sets parentToolUseId on streaming state)
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "stream_event", uuid: "se3", session_id: "s1",
            parent_tool_use_id: "toolu_agent",
            event: { type: "message_start", message: { model: "claude-haiku-4-5-20251001" } },
          }],
        },
      });
    });

    // Now a stream event comes back with parent_tool_use_id: null (subagent done)
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "stream_event", uuid: "se4", session_id: "s1",
            parent_tool_use_id: null,
            event: { type: "message_start", message: { model: "claude-opus-4-6" } },
          }],
        },
      });
    });

    const agentBlock = result.current.blocks[0];
    expect(agentBlock.taskComplete).toBe(true);
  });

  it("taskComplete is set on turn end if subagent was active", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    // Create parent Agent block
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "stream_event", uuid: "se1", session_id: "s1", parent_tool_use_id: null,
            event: {
              type: "content_block_start", index: 0,
              content_block: { type: "tool_use", id: "toolu_agent", name: "Agent" },
            },
          }],
        },
      });
    });

    // Subagent starts
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "stream_event", uuid: "se2", session_id: "s1",
            parent_tool_use_id: "toolu_agent",
            event: { type: "message_start", message: { model: "claude-haiku-4-5-20251001" } },
          }],
        },
      });
    });

    // Turn ends while subagent is active
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "turn_complete",
        payload: {},
      });
    });

    // The Agent block should be marked complete via the dirty parent replacement
    // Find the Agent block (may have been replaced with new reference)
    const agentBlock = result.current.blocks.find((b) => b.toolName === "Agent");
    expect(agentBlock?.taskComplete).toBe(true);
  });

  it("Task tool_call blocks also get childBlocks initialized", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "assistant", uuid: "a1", session_id: "s1",
            parent_tool_use_id: null, error: null,
            message: {
              id: "msg1", model: "claude-opus-4-6", stop_reason: null,
              content: [{ type: "tool_use", id: "toolu_task", name: "Task", input: { description: "do thing" } }],
            },
          }],
        },
      });
    });

    expect(result.current.blocks).toHaveLength(1);
    expect(result.current.blocks[0].toolName).toBe("Task");
    expect(result.current.blocks[0].childBlocks).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // User message (tool_result) handling
  // ---------------------------------------------------------------------------

  it("user message with tool_result creates tool_result block", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    // First create a Bash tool_call so toolUseIdToBlock has an entry
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "stream_event", uuid: "se1", session_id: "s1", parent_tool_use_id: null,
            event: {
              type: "content_block_start", index: 0,
              content_block: { type: "tool_use", id: "toolu_bash1", name: "Bash" },
            },
          }],
        },
      });
    });

    // Now send the user message with tool_result
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "user",
            uuid: "u1",
            session_id: "s1",
            parent_tool_use_id: null,
            message: {
              role: "user",
              content: [
                { tool_use_id: "toolu_bash1", type: "tool_result", content: "hello world", is_error: false },
              ],
            },
          }],
        },
      });
    });

    // Should have tool_call + tool_result
    expect(result.current.blocks).toHaveLength(2);
    const resultBlock = result.current.blocks[1];
    expect(resultBlock.type).toBe("tool_result");
    expect(resultBlock.content).toBe("hello world");
    expect(resultBlock.isError).toBe(false);
    expect(resultBlock.sourceToolName).toBe("Bash");
    expect(resultBlock.toolUseId).toBe("toolu_bash1");
  });

  it("user message with is_error=true sets isError on result block", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    // Create tool_call
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "stream_event", uuid: "se1", session_id: "s1", parent_tool_use_id: null,
            event: {
              type: "content_block_start", index: 0,
              content_block: { type: "tool_use", id: "toolu_bash2", name: "Bash" },
            },
          }],
        },
      });
    });

    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "user", uuid: "u1", session_id: "s1", parent_tool_use_id: null,
            message: {
              role: "user",
              content: [
                { tool_use_id: "toolu_bash2", type: "tool_result", content: "command failed", is_error: true },
              ],
            },
          }],
        },
      });
    });

    const resultBlock = result.current.blocks[1];
    expect(resultBlock.isError).toBe(true);
    expect(resultBlock.content).toBe("command failed");
  });

  it("user message without matching tool_call uses 'unknown' sourceToolName", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "user", uuid: "u1", session_id: "s1", parent_tool_use_id: null,
            message: {
              role: "user",
              content: [
                { tool_use_id: "toolu_unknown", type: "tool_result", content: "output", is_error: false },
              ],
            },
          }],
        },
      });
    });

    expect(result.current.blocks).toHaveLength(1);
    expect(result.current.blocks[0].sourceToolName).toBe("unknown");
  });

  it("user message with non-string content JSON-stringifies it", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "user", uuid: "u1", session_id: "s1", parent_tool_use_id: null,
            message: {
              role: "user",
              content: [
                { tool_use_id: "toolu_x", type: "tool_result", content: [{ type: "text", text: "hi" }], is_error: false },
              ],
            },
          }],
        },
      });
    });

    expect(result.current.blocks[0].content).toBe(JSON.stringify([{ type: "text", text: "hi" }]));
  });

  it("user message with no content array is ignored", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "user", uuid: "u1", session_id: "s1", parent_tool_use_id: null,
            message: { role: "user" },
          }],
        },
      });
    });

    expect(result.current.blocks).toHaveLength(0);
  });

  it("user message tool_result nests under parent Agent block", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    // Create parent Agent block
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "stream_event", uuid: "se1", session_id: "s1", parent_tool_use_id: null,
            event: {
              type: "content_block_start", index: 0,
              content_block: { type: "tool_use", id: "toolu_agent", name: "Agent" },
            },
          }],
        },
      });
    });

    // Subagent Bash tool_call
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "assistant", uuid: "a1", session_id: "s1",
            parent_tool_use_id: "toolu_agent", error: null,
            message: {
              id: "msg1", model: "claude-haiku-4-5-20251001", stop_reason: null,
              content: [{ type: "tool_use", id: "toolu_bash_sub", name: "Bash", input: { command: "ls" } }],
            },
          }],
        },
      });
    });

    // Tool result for subagent Bash
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "user", uuid: "u1", session_id: "s1",
            parent_tool_use_id: "toolu_agent",
            message: {
              role: "user",
              content: [
                { tool_use_id: "toolu_bash_sub", type: "tool_result", content: "file1.txt\nfile2.txt", is_error: false },
              ],
            },
          }],
        },
      });
    });

    // Root should only have Agent block
    expect(result.current.blocks).toHaveLength(1);
    const agentBlock = result.current.blocks[0];
    // Bash tool_call + tool_result nested
    expect(agentBlock.childBlocks).toHaveLength(2);
    expect(agentBlock.childBlocks![0].type).toBe("tool_call");
    expect(agentBlock.childBlocks![0].toolName).toBe("Bash");
    expect(agentBlock.childBlocks![1].type).toBe("tool_result");
    expect(agentBlock.childBlocks![1].content).toBe("file1.txt\nfile2.txt");
    expect(agentBlock.childBlocks![1].sourceToolName).toBe("Bash");
  });

  it("user message with multiple tool_results creates multiple blocks", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();

    // Create two tool_calls
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "assistant", uuid: "a1", session_id: "s1",
            parent_tool_use_id: null, error: null,
            message: {
              id: "msg1", model: "claude-opus-4-6", stop_reason: null,
              content: [
                { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "echo a" } },
                { type: "tool_use", id: "toolu_2", name: "Bash", input: { command: "echo b" } },
              ],
            },
          }],
        },
      });
    });

    // Single user message with two tool_results
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "user", uuid: "u1", session_id: "s1", parent_tool_use_id: null,
            message: {
              role: "user",
              content: [
                { tool_use_id: "toolu_1", type: "tool_result", content: "a", is_error: false },
                { tool_use_id: "toolu_2", type: "tool_result", content: "b", is_error: false },
              ],
            },
          }],
        },
      });
    });

    // 2 tool_calls + 2 tool_results = 4
    expect(result.current.blocks).toHaveLength(4);
    expect(result.current.blocks[2].type).toBe("tool_result");
    expect(result.current.blocks[2].content).toBe("a");
    expect(result.current.blocks[3].type).toBe("tool_result");
    expect(result.current.blocks[3].content).toBe("b");
  });

  it("restores persisted 'running' status as 'idle' after app restart", async () => {
    // Simulate persisted state with status "running" (stale from previous app run)
    const { useGetFeatureAgentState } = await import("@/api/generated");
    (useGetFeatureAgentState as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        sessions: [
          {
            status: "running",
            blocks: [
              { id: "b1", type: "user_message", content: "old prompt" },
              { id: "b2", type: "text", content: "old response" },
            ],
          },
        ],
      },
      isLoading: false,
    });

    const { result } = renderHook(() => useWebSocketSession("test-id", 42));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Status should be reset to idle, not stuck on running
    expect(result.current.status).toBe("idle");
    // History should still be restored
    expect(result.current.blocks).toHaveLength(2);
    expect(result.current.blocks[0].type).toBe("user_message");

    // Restore default mock
    (useGetFeatureAgentState as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: false,
    });
  });

  it("restores persisted 'completed' status as-is", async () => {
    const { useGetFeatureAgentState } = await import("@/api/generated");
    (useGetFeatureAgentState as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        sessions: [{ status: "completed", blocks: [] }],
      },
      isLoading: false,
    });

    const { result } = renderHook(() => useWebSocketSession("test-id", 43));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.status).toBe("completed");

    (useGetFeatureAgentState as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: false,
    });
  });

  it("unmount does NOT close WebSocket (connection is cached)", async () => {
    const { unmount } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "initialized",
        payload: { session_id: "srv-session-1" },
      });
    });
    unmount();
    // Connection should still be open — cached in the store
    expect(ws.readyState).toBe(MockWebSocket.OPEN);
  });

  it("explicit destroy sends destroy and closes WebSocket", async () => {
    const { result } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "initialized",
        payload: { session_id: "srv-session-1" },
      });
    });
    act(() => {
      result.current.destroy();
    });
    expect(ws.sent.length).toBeGreaterThan(0);
    const destroyMsg = JSON.parse(ws.sent[ws.sent.length - 1]);
    expect(destroyMsg.action).toBe("destroy");
    expect(destroyMsg.payload.session_id).toBe("srv-session-1");
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("reuses existing WebSocket connection across unmount/remount", async () => {
    const { unmount } = renderHook(() => useWebSocketSession("reuse-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(MockWebSocket.instances.length).toBe(1);

    // Unmount and remount — should NOT create a new connection
    unmount();
    const { result } = renderHook(() => useWebSocketSession("reuse-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(MockWebSocket.instances.length).toBe(1);
    expect(result.current.isConnected).toBe(true);
  });

  it("creates separate connections for different sessionIds", async () => {
    const { result: r1 } = renderHook(() => useWebSocketSession("session-a"));
    const { result: r2 } = renderHook(() => useWebSocketSession("session-b"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(MockWebSocket.instances.length).toBe(2);
    expect(r1.current.isConnected).toBe(true);
    expect(r2.current.isConnected).toBe(true);
  });

  it("preserves blocks across unmount/remount", async () => {
    const { result, unmount } = renderHook(() => useWebSocketSession("persist-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Simulate a message that adds a block
    const ws = getWs();
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [
            {
              type: "stream_event",
              event: {
                type: "content_block_start",
                index: 0,
                content_block: { type: "text" },
              },
            },
            {
              type: "stream_event",
              event: {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: "hello" },
              },
            },
          ],
        },
      });
    });
    expect(result.current.blocks.length).toBe(1);

    // Unmount and remount — blocks should still be there
    unmount();
    const { result: r2 } = renderHook(() => useWebSocketSession("persist-id"));
    expect(r2.current.blocks.length).toBe(1);
    expect(r2.current.blocks[0].content).toBe("hello");
  });
});
