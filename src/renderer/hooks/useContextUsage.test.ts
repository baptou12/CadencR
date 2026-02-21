import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useContextUsage } from "./useContextUsage";

type AgentEventListener = (data: unknown) => void;

describe("useContextUsage", () => {
  let onAgentEventListener: AgentEventListener | null = null;
  let mockOnAgentEvent: ReturnType<typeof vi.fn>;
  let mockOffAgentEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onAgentEventListener = null;
    mockOnAgentEvent = vi.fn((cb: AgentEventListener) => {
      onAgentEventListener = cb;
      return cb;
    });
    mockOffAgentEvent = vi.fn();

    Object.defineProperty(window, "api", {
      value: { onAgentEvent: mockOnAgentEvent, offAgentEvent: mockOffAgentEvent },
      writable: true,
      configurable: true,
    });
  });

  it("returns an empty map with no sessions", () => {
    const { result } = renderHook(() => useContextUsage(1, []));
    expect(result.current.size).toBe(0);
  });

  it("seeds from session data", () => {
    const sessions = [
      {
        sessionDbId: 10,
        inputTokens: 1000,
        outputTokens: 500,
        contextWindow: 200000,
        wasCompacted: false,
        subprocessId: null,
      },
    ];
    const { result } = renderHook(() => useContextUsage(1, sessions));
    const usage = result.current.get(10);
    expect(usage).toBeDefined();
    expect(usage!.inputTokens).toBe(1000);
    expect(usage!.outputTokens).toBe(500);
    expect(usage!.totalTokens).toBe(1500);
    expect(usage!.contextWindow).toBe(200000);
    expect(usage!.usageRatio).toBeCloseTo(1500 / 200000);
    expect(usage!.wasCompacted).toBe(false);
  });

  it("calculates usageRatio clamped to 1", () => {
    const sessions = [
      {
        sessionDbId: 10,
        inputTokens: 200000,
        outputTokens: 100000,
        contextWindow: 200000,
        wasCompacted: false,
        subprocessId: null,
      },
    ];
    const { result } = renderHook(() => useContextUsage(1, sessions));
    expect(result.current.get(10)!.usageRatio).toBe(1);
  });

  it("handles contextWindow of 0 gracefully (usageRatio = 0)", () => {
    const sessions = [
      {
        sessionDbId: 10,
        inputTokens: 100,
        outputTokens: 50,
        contextWindow: 0,
        wasCompacted: false,
        subprocessId: null,
      },
    ];
    const { result } = renderHook(() => useContextUsage(1, sessions));
    expect(result.current.get(10)!.usageRatio).toBe(0);
  });

  it("registers onAgentEvent listener on mount", () => {
    renderHook(() => useContextUsage(1, []));
    expect(mockOnAgentEvent).toHaveBeenCalledTimes(1);
  });

  it("unregisters listener on unmount", () => {
    const { unmount } = renderHook(() => useContextUsage(1, []));
    unmount();
    expect(mockOffAgentEvent).toHaveBeenCalledTimes(1);
  });

  it("handles missing window.api gracefully", () => {
    Object.defineProperty(window, "api", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(() => renderHook(() => useContextUsage(1, []))).not.toThrow();
  });

  it("registers IPC listener that handles usage_update events", () => {
    const sessions = [
      {
        sessionDbId: 10,
        inputTokens: 0,
        outputTokens: 0,
        contextWindow: 200000,
        wasCompacted: false,
        subprocessId: "sub-1",
      },
    ];
    renderHook(() => useContextUsage(1, sessions));
    // The listener should be registered and callable without throwing
    expect(() => {
      onAgentEventListener?.({
        sessionDbId: 10,
        subprocessId: "sub-1",
        event: { type: "system", subtype: "usage_update", input_tokens: 5000, output_tokens: 2000 },
      });
    }).not.toThrow();
  });

  it("seeds multiple sessions", () => {
    const sessions = [
      { sessionDbId: 1, inputTokens: 100, outputTokens: 50, contextWindow: 10000, wasCompacted: false, subprocessId: null },
      { sessionDbId: 2, inputTokens: 200, outputTokens: 100, contextWindow: 10000, wasCompacted: true, subprocessId: null },
    ];
    const { result } = renderHook(() => useContextUsage(1, sessions));
    expect(result.current.size).toBe(2);
    expect(result.current.get(1)!.wasCompacted).toBe(false);
    expect(result.current.get(2)!.wasCompacted).toBe(true);
  });
});
