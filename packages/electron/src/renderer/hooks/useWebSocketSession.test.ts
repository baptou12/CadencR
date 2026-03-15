import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWebSocketSession } from "./useWebSocketSession";

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
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal("window", {
    ...globalThis.window,
    api: { rustBackendUrl: "http://localhost:5005" },
  });
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
    expect(sent.payload.granted).toBe(true);
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

  it("unmount sends destroy and closes WebSocket", async () => {
    const { unmount } = renderHook(() => useWebSocketSession("test-id"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = getWs();
    // Simulate server assigning a session_id via initialized message
    act(() => {
      ws.simulateMessage({
        domain: "session",
        action: "initialized",
        payload: { session_id: "srv-session-1" },
      });
    });
    unmount();
    expect(ws.sent.length).toBeGreaterThan(0);
    const destroyMsg = JSON.parse(ws.sent[ws.sent.length - 1]);
    expect(destroyMsg.action).toBe("destroy");
    expect(destroyMsg.payload.session_id).toBe("srv-session-1");
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });
});
