import React from "react";
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDbUpdated } from "./useDbUpdated";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient();
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

type DbUpdateListener = (data: { entity: string; featureId: number }) => void;

describe("useDbUpdated", () => {
  let _onDbUpdatedListener: DbUpdateListener | null = null;
  let mockOnDbUpdated: ReturnType<typeof vi.fn>;
  let mockOffDbUpdated: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _onDbUpdatedListener = null;
    mockOnDbUpdated = vi.fn((cb: DbUpdateListener) => {
      _onDbUpdatedListener = cb;
      return cb;
    });
    mockOffDbUpdated = vi.fn();

    Object.defineProperty(window, "api", {
      value: {
        onDbUpdated: mockOnDbUpdated,
        offDbUpdated: mockOffDbUpdated,
      },
      writable: true,
      configurable: true,
    });
  });

  it("registers onDbUpdated listener on mount", () => {
    renderHook(() => useDbUpdated(), { wrapper });
    expect(mockOnDbUpdated).toHaveBeenCalledTimes(1);
  });

  it("unregisters listener on unmount", () => {
    const { unmount } = renderHook(() => useDbUpdated(), { wrapper });
    unmount();
    expect(mockOffDbUpdated).toHaveBeenCalledTimes(1);
  });

  it("does nothing when window.api is not available", () => {
    Object.defineProperty(window, "api", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    // Should not throw
    expect(() => renderHook(() => useDbUpdated(), { wrapper })).not.toThrow();
  });

  it("handles missing window.api gracefully", () => {
    Object.defineProperty(window, "api", {
      value: null,
      writable: true,
      configurable: true,
    });
    expect(() => renderHook(() => useDbUpdated(), { wrapper })).not.toThrow();
  });
});
