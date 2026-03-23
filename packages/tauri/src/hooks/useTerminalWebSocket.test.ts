import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { useTerminalWebSocket } from "./useTerminalWebSocket";
import type { UseTerminalWebSocketOptions } from "./useTerminalWebSocket";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Mock WebSocket — supports onXxx property-style handlers used by the hook
// ---------------------------------------------------------------------------

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];

  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, _reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: code ?? 1000 });
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({});
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose(code = 1006) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code });
  }

  simulateError() {
    this.onerror?.({});
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const origWebSocket = globalThis.WebSocket;

function lastWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
}

function defaultOptions(overrides?: Partial<UseTerminalWebSocketOptions>): UseTerminalWebSocketOptions {
  return {
    featureId: 1,
    projectId: 2,
    onData: vi.fn(),
    onExit: vi.fn(),
    onReady: vi.fn(),
    onReconnected: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  MockWebSocket.instances = [];
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.WebSocket = origWebSocket;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useTerminalWebSocket", () => {
  it("builds WS URL with featureId and projectId", () => {
    renderHook(() => useTerminalWebSocket(defaultOptions()));
    expect(lastWs().url).toContain("feature_id=1");
    expect(lastWs().url).toContain("project_id=2");
  });

  it("builds WS URL with ptyId for reconnection", () => {
    renderHook(() => useTerminalWebSocket(defaultOptions({ ptyId: "abc-123", featureId: undefined, projectId: undefined })));
    expect(lastWs().url).toContain("pty_id=abc-123");
    expect(lastWs().url).not.toContain("feature_id");
  });

  it("sets isConnected to true on open", () => {
    const { result } = renderHook(() => useTerminalWebSocket(defaultOptions()));
    expect(result.current.isConnected).toBe(false);
    act(() => lastWs().simulateOpen());
    expect(result.current.isConnected).toBe(true);
  });

  it("dispatches data messages to onData callback", () => {
    const onData = vi.fn();
    renderHook(() => useTerminalWebSocket(defaultOptions({ onData })));
    act(() => lastWs().simulateOpen());
    act(() => lastWs().simulateMessage({ type: "data", data: "hello" }));
    expect(onData).toHaveBeenCalledWith("hello");
  });

  it("dispatches ready messages to onReady callback", () => {
    const onReady = vi.fn();
    renderHook(() => useTerminalWebSocket(defaultOptions({ onReady })));
    act(() => lastWs().simulateOpen());
    act(() => lastWs().simulateMessage({ type: "ready", pty_id: "pty-1" }));
    expect(onReady).toHaveBeenCalledWith("pty-1");
  });

  it("dispatches exit messages to onExit callback", () => {
    const onExit = vi.fn();
    renderHook(() => useTerminalWebSocket(defaultOptions({ onExit })));
    act(() => lastWs().simulateOpen());
    act(() => lastWs().simulateMessage({ type: "exit", code: 0 }));
    expect(onExit).toHaveBeenCalledWith(0);
  });

  it("dispatches reconnected messages to onReconnected callback", () => {
    const onReconnected = vi.fn();
    renderHook(() => useTerminalWebSocket(defaultOptions({ onReconnected })));
    act(() => lastWs().simulateOpen());
    act(() => lastWs().simulateMessage({ type: "reconnected", scrollback: "old data", alive: true }));
    expect(onReconnected).toHaveBeenCalledWith("old data", true);
  });

  it("dispatches error messages to onError callback", () => {
    const onError = vi.fn();
    renderHook(() => useTerminalWebSocket(defaultOptions({ onError })));
    act(() => lastWs().simulateOpen());
    act(() => lastWs().simulateMessage({ type: "error", message: "bad" }));
    expect(onError).toHaveBeenCalledWith("bad");
  });

  it("sends write/resize/kill JSON when WS is open", () => {
    const { result } = renderHook(() => useTerminalWebSocket(defaultOptions()));
    act(() => lastWs().simulateOpen());

    act(() => result.current.write("ls\n"));
    act(() => result.current.resize(80, 24));
    act(() => result.current.kill());

    const sent = lastWs().sent.map((s) => JSON.parse(s));
    expect(sent).toEqual([
      { type: "write", data: "ls\n" },
      { type: "resize", cols: 80, rows: 24 },
      { type: "kill" },
    ]);
  });

  it("does not send when WS is not open", () => {
    const { result } = renderHook(() => useTerminalWebSocket(defaultOptions()));
    // WS is still CONNECTING, not OPEN
    act(() => result.current.write("hello"));
    expect(lastWs().sent).toHaveLength(0);
  });

  describe("intentional close suppression", () => {
    it("does not fire onError when WS closes due to unmount", () => {
      const onError = vi.fn();
      const { unmount } = renderHook(() => useTerminalWebSocket(defaultOptions({ onError })));
      act(() => lastWs().simulateOpen());

      unmount();

      expect(onError).not.toHaveBeenCalled();
    });

    it("does not fire toast.error when WS errors due to unmount", () => {
      const { unmount } = renderHook(() => useTerminalWebSocket(defaultOptions()));
      const ws = lastWs();
      // Simulate the strict-mode pattern: unmount triggers cleanup which closes WS,
      // then the browser fires onerror
      unmount();
      // onerror fires after cleanup set intentionalClose = true
      act(() => ws.onerror?.({}));

      expect(toast.error).not.toHaveBeenCalled();
    });

    it("fires onError for unexpected close (server disconnect)", () => {
      const onError = vi.fn();
      renderHook(() => useTerminalWebSocket(defaultOptions({ onError })));
      act(() => lastWs().simulateOpen());
      act(() => lastWs().simulateClose(1006));
      expect(onError).toHaveBeenCalledWith(
        "Connection lost. Terminal may still be running — reopen to reconnect.",
      );
    });

    it("fires toast.error for unexpected WS error", () => {
      renderHook(() => useTerminalWebSocket(defaultOptions()));
      act(() => lastWs().simulateError());
      expect(toast.error).toHaveBeenCalledWith("Terminal WebSocket connection failed");
    });
  });

  describe("connection stability", () => {
    it("does not reconnect when options change after mount (ptyId assigned from onReady)", () => {
      const opts = defaultOptions();
      const { rerender } = renderHook(
        (props) => useTerminalWebSocket(props),
        { initialProps: opts },
      );

      expect(MockWebSocket.instances).toHaveLength(1);

      // Simulate parent storing ptyId after onReady — changes options
      rerender({ ...opts, ptyId: "new-pty", featureId: undefined, projectId: undefined });

      // Should still be only 1 WebSocket — no reconnection
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it("uses initial options for URL, not updated options", () => {
      const opts = defaultOptions();
      renderHook(
        (props) => useTerminalWebSocket(props),
        { initialProps: opts },
      );

      expect(lastWs().url).toContain("feature_id=1");
      expect(lastWs().url).toContain("project_id=2");
      // Only one WS created, using the initial params
      expect(MockWebSocket.instances).toHaveLength(1);
    });
  });

  it("uses latest callbacks via optionsRef (no stale closures)", () => {
    const onData1 = vi.fn();
    const onData2 = vi.fn();
    const opts = defaultOptions({ onData: onData1 });
    const { rerender } = renderHook(
      (props) => useTerminalWebSocket(props),
      { initialProps: opts },
    );
    act(() => lastWs().simulateOpen());

    // Update callback
    rerender({ ...opts, onData: onData2 });

    act(() => lastWs().simulateMessage({ type: "data", data: "hello" }));
    expect(onData1).not.toHaveBeenCalled();
    expect(onData2).toHaveBeenCalledWith("hello");
  });

  it("calls onError for unparseable messages", () => {
    const onError = vi.fn();
    renderHook(() => useTerminalWebSocket(defaultOptions({ onError })));
    act(() => lastWs().simulateOpen());
    // Send raw invalid JSON via onmessage
    act(() => lastWs().onmessage?.({ data: "not json" }));
    expect(onError).toHaveBeenCalledWith("Failed to parse terminal message");
  });

  it("closes WS on unmount", () => {
    const { unmount } = renderHook(() => useTerminalWebSocket(defaultOptions()));
    const ws = lastWs();
    act(() => ws.simulateOpen());
    unmount();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });
});
