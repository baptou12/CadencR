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
    act(() => {
      getWs().simulateMessage({
        domain: "session",
        action: "message",
        payload: { blocks: [{ id: "b1", type: "text", content: "hi" }] },
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
    expect(result.current.status).toBe("completed");
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
