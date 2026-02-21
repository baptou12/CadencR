import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useDebouncedSetting } from "./useDebouncedSetting";

const mockMutate = vi.fn();
const mockUseQuery = vi.fn(() => ({ data: "stored-value", isLoading: false }));

vi.mock("@/trpc", () => ({
  trpc: {
    settings: {
      get: {
        useQuery: () => mockUseQuery(),
      },
      set: {
        useMutation: vi.fn(() => ({ mutate: mockMutate })),
      },
    },
  },
}));

describe("useDebouncedSetting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockMutate.mockClear();
    mockUseQuery.mockReturnValue({ data: "stored-value", isLoading: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the stored value from the query", () => {
    const { result } = renderHook(() => useDebouncedSetting("my-key"));
    expect(result.current.value).toBe("stored-value");
  });

  it("does not call mutate immediately on setValue", () => {
    const { result } = renderHook(() => useDebouncedSetting("my-key"));
    act(() => {
      result.current.setValue("new-value");
    });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("calls mutate after debounce delay", () => {
    const { result } = renderHook(() => useDebouncedSetting("my-key", 300));
    act(() => {
      result.current.setValue("new-value");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mockMutate).toHaveBeenCalledWith({ key: "my-key", value: "new-value" });
  });

  it("debounces multiple rapid calls — only calls mutate once", () => {
    const { result } = renderHook(() => useDebouncedSetting("my-key", 300));
    act(() => {
      result.current.setValue("val1");
      result.current.setValue("val2");
      result.current.setValue("val3");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate).toHaveBeenCalledWith({ key: "my-key", value: "val3" });
  });

  it("uses custom debounce interval", () => {
    const { result } = renderHook(() => useDebouncedSetting("my-key", 1000));
    act(() => {
      result.current.setValue("hello");
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(mockMutate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it("returns null when query returns no data", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseQuery.mockReturnValueOnce({ data: null as any, isLoading: false });
    const { result } = renderHook(() => useDebouncedSetting("missing-key"));
    expect(result.current.value).toBeNull();
  });

  it("isLoading reflects query loading state", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseQuery.mockReturnValueOnce({ data: null as any, isLoading: true });
    const { result } = renderHook(() => useDebouncedSetting("loading-key"));
    expect(result.current.isLoading).toBe(true);
  });
});
