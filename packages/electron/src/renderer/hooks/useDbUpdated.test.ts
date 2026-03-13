import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useDbUpdated } from "./useDbUpdated";

// Mock trpc
vi.mock("@/trpc", () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      features: {
        getById: { invalidate: vi.fn() },
        listByProject: { invalidate: vi.fn() },
        getProgress: { invalidate: vi.fn() },
        getPlanWithPhases: { invalidate: vi.fn() },
      },
      agents: {
        getActiveFeatureIds: { invalidate: vi.fn() },
        getSessions: { invalidate: vi.fn() },
        getFeatureAgentState: { invalidate: vi.fn() },
      },
    })),
  },
}));

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
    renderHook(() => useDbUpdated());
    expect(mockOnDbUpdated).toHaveBeenCalledTimes(1);
  });

  it("unregisters listener on unmount", () => {
    const { unmount } = renderHook(() => useDbUpdated());
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
    expect(() => renderHook(() => useDbUpdated())).not.toThrow();
  });

  it("handles missing window.api gracefully", () => {
    Object.defineProperty(window, "api", {
      value: null,
      writable: true,
      configurable: true,
    });
    expect(() => renderHook(() => useDbUpdated())).not.toThrow();
  });
});
