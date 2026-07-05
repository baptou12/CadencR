import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStreamingMarkdownThrottle } from "./useStreamingMarkdownThrottle";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useStreamingMarkdownThrottle", () => {
  it("passes content through immediately when not streaming", () => {
    const { result, rerender } = renderHook(({ c, a }) => useStreamingMarkdownThrottle(c, a), {
      initialProps: { c: "a", a: false },
    });
    expect(result.current).toBe("a");
    rerender({ c: "abc", a: false });
    expect(result.current).toBe("abc");
  });

  it("throttles rapid updates while streaming, then catches up on the trailing edge", () => {
    const { result, rerender } = renderHook(({ c, a }) => useStreamingMarkdownThrottle(c, a), {
      initialProps: { c: "a", a: true },
    });
    // Leading edge emits immediately.
    expect(result.current).toBe("a");

    // Bursts within the 100ms window do not advance the parsed content.
    rerender({ c: "ab", a: true });
    rerender({ c: "abc", a: true });
    rerender({ c: "abcd", a: true });
    expect(result.current).toBe("a");

    // The trailing timer flushes the latest content once the window elapses.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe("abcd");
  });

  it("flushes to the latest content immediately when streaming stops", () => {
    const { result, rerender } = renderHook(({ c, a }) => useStreamingMarkdownThrottle(c, a), {
      initialProps: { c: "a", a: true },
    });
    rerender({ c: "ab", a: true }); // buffered, not yet shown
    expect(result.current).toBe("a");

    // Turn stops: the final content must appear without waiting for the timer.
    rerender({ c: "abcdef", a: false });
    expect(result.current).toBe("abcdef");
  });
});
