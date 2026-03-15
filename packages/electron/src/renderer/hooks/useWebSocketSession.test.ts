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
