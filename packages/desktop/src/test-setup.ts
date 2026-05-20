import "@testing-library/jest-dom/vitest";
import { vi, afterEach, afterAll, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./test/msw-server";

// Automatically cleanup DOM after each test
afterEach(cleanup);

// ---------------------------------------------------------------------------
// MSW — intercept HTTP so unmocked React Query hooks resolve cleanly
// ---------------------------------------------------------------------------
//
// Many component tests mount real components whose React Query hooks fire
// axios requests against `http://127.0.0.1:5005`. There is no backend in
// jsdom, so without MSW every unmocked hook would emit a full `AxiosError:
// Network Error` stack via React Query's default `onError` — dozens of lines
// per test. MSW's catch-all handler (see `./test/msw-server.ts`) returns an
// empty JSON body for any request, so hooks resolve to an empty payload and
// stay silent. Tests that need a real response shape mock at the hook layer
// (`vi.mock("@/api/generated", …)`), which short-circuits before the request
// reaches MSW.
//
// `onUnhandledRequest: "bypass"` keeps non-API fetches (asset URLs, etc.)
// silent — unmatched requests just fall through to the (absent) network.
beforeAll(() => {
  server.listen({ onUnhandledRequest: "bypass" });
  // MSW's interceptor installs `globalThis.WebSocket` as a non-writable
  // property. WebSocket-focused tests (`ws-connection.test.ts`,
  // `useTerminalWebSocket.test.ts`) swap `globalThis.WebSocket` for a
  // `MockWebSocket` class and would otherwise throw on assignment. Flip the
  // descriptor to writable; the value is left untouched.
  Object.defineProperty(globalThis, "WebSocket", {
    writable: true,
    configurable: true,
  });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// navigator.platform — pretend tests run on macOS
// ---------------------------------------------------------------------------
//
// jsdom reports an empty `navigator.platform`, which shortcut display and
// TanStack's `Mod` resolver use to decide whether the primary modifier is
// Command (macOS) or Control (Windows/Linux). Forcing the platform to mac here
// keeps tests aligned with the desktop default; cross-platform resolver and
// matcher coverage lives in the shortcut unit tests.
Object.defineProperty(navigator, "platform", {
  configurable: true,
  value: "MacIntel",
});

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
  type ItemContent = (index: number, data?: unknown, context?: unknown) => unknown;
  type FollowOutputScalar = "auto" | "smooth" | boolean;
  type FollowOutputCallback = (isAtBottom: boolean) => FollowOutputScalar;
  type FollowOutputProp = FollowOutputCallback | FollowOutputScalar;
  interface VirtuosoHandleMock {
    scrollToIndex: (location: { index: "LAST" | number } | number) => void;
  }
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
    followOutput?: FollowOutputProp;
    atBottomStateChange?: (atBottom: boolean) => void;
    totalListHeightChanged?: (height: number) => void;
    style?: React.CSSProperties;
    className?: string;
    "data-testid"?: string;
  }
  const Virtuoso = React.forwardRef<VirtuosoHandleMock, VirtuosoProps>(function VirtuosoMock(
    {
      totalCount,
      data,
      itemContent,
      components,
      context,
      scrollerRef,
      startReached,
      followOutput,
      atBottomStateChange,
      totalListHeightChanged,
      style,
      className,
      "data-testid": testId,
    },
    ref,
  ) {
    const rootRef = React.useRef<HTMLDivElement | null>(null);
    const followOutputRef = React.useRef(followOutput);
    const atBottomChangeRef = React.useRef(atBottomStateChange);
    const totalListHeightChangedRef = React.useRef(totalListHeightChanged);
    followOutputRef.current = followOutput;
    atBottomChangeRef.current = atBottomStateChange;
    totalListHeightChangedRef.current = totalListHeightChanged;

    // Mimic Virtuoso's bottom-pin: set scrollTop = scrollHeight and fire
    // atBottomStateChange(true). Tests that stub `scrollHeight` see the
    // expected scrollTop value after a programmatic scroll-to-end.
    const pinToBottom = React.useCallback((): void => {
      const root = rootRef.current;
      if (!root) return;
      root.scrollTop = root.scrollHeight;
      atBottomChangeRef.current?.(true);
    }, []);

    React.useImperativeHandle(
      ref,
      () => ({
        scrollToIndex: (location) => {
          const index = typeof location === "number" ? location : location.index;
          if (index === "LAST") pinToBottom();
        },
      }),
      [pinToBottom],
    );

    React.useEffect(() => {
      const root = rootRef.current;
      scrollerRef?.(root);
      if (!root) return () => scrollerRef?.(null);
      const handleStart = (): void => startReached?.();
      const handleDataChange = (): void => {
        const out = followOutputRef.current;
        const result = typeof out === "function" ? out(true) : out;
        if (result) pinToBottom();
      };
      const handleAtBottomChange = (e: Event): void => {
        const detail = (e as CustomEvent<{ atBottom: boolean }>).detail;
        atBottomChangeRef.current?.(detail?.atBottom ?? false);
      };
      const handleTotalHeightChange = (e: Event): void => {
        const detail = (e as CustomEvent<{ height: number }>).detail;
        totalListHeightChangedRef.current?.(detail?.height ?? 0);
      };
      root.addEventListener("virtuoso-start-reached", handleStart);
      root.addEventListener("virtuoso-data-changed", handleDataChange);
      root.addEventListener("virtuoso-at-bottom-change", handleAtBottomChange);
      root.addEventListener("virtuoso-total-height-change", handleTotalHeightChange);
      return () => {
        root.removeEventListener("virtuoso-start-reached", handleStart);
        root.removeEventListener("virtuoso-data-changed", handleDataChange);
        root.removeEventListener("virtuoso-at-bottom-change", handleAtBottomChange);
        root.removeEventListener("virtuoso-total-height-change", handleTotalHeightChange);
        scrollerRef?.(null);
      };
    }, [scrollerRef, startReached, pinToBottom]);

    // Replay `followOutput` whenever the `data` prop reference changes —
    // Virtuoso re-evaluates the callback on each data update AND after async
    // measurement settles. The mock has no async measurement; firing on data
    // reference change is a close-enough proxy (covers both length changes
    // and in-place content growth, since AgentStream rebuilds `displayBlocks`
    // every render where `rootBlocks` changes).
    const prevDataRef = React.useRef<unknown[] | undefined>(undefined);
    const currentLength = data?.length ?? totalCount ?? 0;
    React.useEffect(() => {
      if (prevDataRef.current === data) return;
      prevDataRef.current = data;
      const out = followOutputRef.current;
      const result = typeof out === "function" ? out(true) : out;
      if (result) pinToBottom();
    }, [data, pinToBottom]);

    const count = currentLength;
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
          itemContent ? (itemContent(i, data?.[i], context) as React.ReactNode) : null,
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
