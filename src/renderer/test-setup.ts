import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

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
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}

Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  value: MockIntersectionObserver,
});

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
