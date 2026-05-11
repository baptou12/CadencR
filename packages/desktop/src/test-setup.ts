import "@testing-library/jest-dom/vitest";
import { vi, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Automatically cleanup DOM after each test
afterEach(cleanup);

// ---------------------------------------------------------------------------
// window.matchMedia
// ---------------------------------------------------------------------------

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ---------------------------------------------------------------------------
// ResizeObserver
// ---------------------------------------------------------------------------

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  value: MockResizeObserver,
});

// ---------------------------------------------------------------------------
// IntersectionObserver
// ---------------------------------------------------------------------------

class MockIntersectionObserver {
  root = null;
  rootMargin = "";
  thresholds = [];
  private callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe = vi.fn((el: Element) => {
    // Immediately fire the callback with isIntersecting: true so that
    // useNearViewport resolves to true in tests, causing all DiffFileBlocks
    // to render their full content as before.
    this.callback(
      [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  });
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}

Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  value: MockIntersectionObserver,
});

// ---------------------------------------------------------------------------
// scrollIntoView (not implemented in jsdom)
// ---------------------------------------------------------------------------

window.HTMLElement.prototype.scrollIntoView = vi.fn();

// ---------------------------------------------------------------------------
// Canvas (for components that use canvas text measurement)
// ---------------------------------------------------------------------------

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  font: "",
  measureText: vi.fn(() => ({ width: 100 })),
  fillText: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// ---------------------------------------------------------------------------
// react-virtuoso
// ---------------------------------------------------------------------------
// Virtuoso relies on real layout (ResizeObserver size + viewport math) which
// jsdom doesn't provide, so it renders zero rows out of the box. We replace
// it with a flat render of every item so tests can `findByText` content
// inside virtualized lists. Tests that need to drive Virtuoso-specific
// callbacks (atBottomStateChange, startReached, etc.) can still call
// `vi.mock("react-virtuoso", ...)` locally — the local mock wins.
vi.mock("react-virtuoso", async () => {
  const React = await import("react");
  type ItemContent = (index: number, data?: unknown) => unknown;
  interface VirtuosoProps {
    totalCount?: number;
    data?: unknown[];
    itemContent?: ItemContent;
    components?: {
      Header?: (props: { context?: unknown }) => React.ReactNode;
      Footer?: (props: { context?: unknown }) => React.ReactNode;
    };
    context?: unknown;
    scrollerRef?: (ref: HTMLElement | null) => void;
    startReached?: () => void;
    style?: React.CSSProperties;
    className?: string;
    "data-testid"?: string;
  }
  const Virtuoso = React.forwardRef<unknown, VirtuosoProps>(function VirtuosoMock(
    {
      totalCount,
      data,
      itemContent,
      components,
      context,
      scrollerRef,
      startReached,
      style,
      className,
      "data-testid": testId,
    },
    _ref,
  ) {
    const rootRef = React.useRef<HTMLDivElement | null>(null);
    React.useEffect(() => {
      const root = rootRef.current;
      scrollerRef?.(root);
      if (!root || !startReached) return () => scrollerRef?.(null);
      root.addEventListener("virtuoso-start-reached", startReached);
      return () => {
        root.removeEventListener("virtuoso-start-reached", startReached);
        scrollerRef?.(null);
      };
    }, [scrollerRef, startReached]);
    const count = data?.length ?? totalCount ?? 0;
    const headerEl = components?.Header
      ? React.createElement(components.Header, { context } as { context?: unknown })
      : null;
    const footerEl = components?.Footer
      ? React.createElement(components.Footer, { context } as { context?: unknown })
      : null;
    const rowEls: React.ReactNode[] = [];
    for (let i = 0; i < count; i++) {
      rowEls.push(
        React.createElement(
          "div",
          { key: i, "data-virtuoso-row-index": i },
          itemContent ? (itemContent(i, data?.[i]) as React.ReactNode) : null,
        ),
      );
    }
    return React.createElement(
      "div",
      {
        ref: rootRef,
        "data-testid": testId ?? "virtuoso-mock",
        className,
        style,
      },
      headerEl,
      ...rowEls,
      footerEl,
    );
  });
  return { Virtuoso };
});
