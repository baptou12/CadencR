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
// window.api (Electron preload bridge) — default stub
// ---------------------------------------------------------------------------

Object.defineProperty(window, "api", {
  writable: true,
  configurable: true,
  value: {
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
    invoke: vi.fn().mockResolvedValue(undefined),
  },
});
