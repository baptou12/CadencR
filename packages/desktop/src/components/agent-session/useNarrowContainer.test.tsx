import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useRef, type ReactElement } from "react";
import { act, render } from "@/test-utils";
import { useNarrowContainer } from "./useNarrowContainer";

// Capture the latest ResizeObserver callback installed by the hook so tests
// can drive it directly. JSDOM provides a stub `ResizeObserver` (see
// test-setup.ts) but never fires it on real layout changes.
let lastObserverCallback: ResizeObserverCallback | null = null;
class MockResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    lastObserverCallback = cb;
  }
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

function Harness({ width, threshold }: { width: number; threshold: number }): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const narrow = useNarrowContainer(ref, threshold);
  // Pin `clientWidth` to the current prop via inline style so the hook reads
  // a deterministic value from `el.clientWidth` after our manual flushes.
  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (el) Object.defineProperty(el, "clientWidth", { value: width, configurable: true });
      }}
      data-testid="probe"
      data-narrow={narrow ? "yes" : "no"}
    />
  );
}

describe("useNarrowContainer", () => {
  let originalRO: typeof ResizeObserver;
  beforeEach(() => {
    originalRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    lastObserverCallback = null;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    globalThis.ResizeObserver = originalRO;
  });

  it("coalesces multiple RO callbacks within the same frame into a single setState", () => {
    const { getByTestId } = render(<Harness width={500} threshold={300} />);
    // Initial sync measurement: 500 ≥ 300 → not narrow.
    expect(getByTestId("probe").dataset.narrow).toBe("no");

    // Fire the observer multiple times back-to-back (mimics a streaming chunk
    // triggering several remeasures before the next frame).
    act(() => {
      lastObserverCallback?.([], {} as ResizeObserver);
      lastObserverCallback?.([], {} as ResizeObserver);
      lastObserverCallback?.([], {} as ResizeObserver);
    });
    // No rAF flushed yet → still showing the initial result.
    expect(getByTestId("probe").dataset.narrow).toBe("no");

    // Width hasn't crossed the threshold; even after the rAF flush the state
    // must not change (dedupe path).
    act(() => {
      vi.advanceTimersByTime(20); // flush rAF (jsdom polyfills via setTimeout)
    });
    expect(getByTestId("probe").dataset.narrow).toBe("no");
  });

  it("flips narrow state once after the next animation frame when width crosses the threshold", () => {
    const { getByTestId, rerender } = render(<Harness width={500} threshold={300} />);
    expect(getByTestId("probe").dataset.narrow).toBe("no");

    rerender(<Harness width={200} threshold={300} />);
    // Width changed via prop — fire the observer to simulate the browser
    // notification, then flush the rAF.
    act(() => {
      lastObserverCallback?.([], {} as ResizeObserver);
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(getByTestId("probe").dataset.narrow).toBe("yes");
  });
});
