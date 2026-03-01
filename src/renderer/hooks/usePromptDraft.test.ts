import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { usePromptDraft } from "./usePromptDraft";

const mockSaveDraftMutate = vi.fn();

vi.mock("@/trpc", () => ({
  trpc: {
    sessions: {
      saveDraft: {
        useMutation: vi.fn(() => ({ mutate: mockSaveDraftMutate })),
      },
    },
  },
}));

describe("usePromptDraft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSaveDraftMutate.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the initialDraft unchanged", () => {
    const { result } = renderHook(() =>
      usePromptDraft({ sessionId: 1, initialDraft: "hello world" }),
    );
    expect(result.current.initialDraft).toBe("hello world");
  });

  it("returns null initialDraft when not provided", () => {
    const { result } = renderHook(() =>
      usePromptDraft({ sessionId: 1, initialDraft: null }),
    );
    expect(result.current.initialDraft).toBeNull();
  });

  it("does not save draft immediately on saveDraft call", () => {
    const { result } = renderHook(() =>
      usePromptDraft({ sessionId: 1, initialDraft: null }),
    );
    act(() => {
      result.current.saveDraft("typing...");
    });
    expect(mockSaveDraftMutate).not.toHaveBeenCalled();
  });

  it("saves draft after 500ms debounce", () => {
    const { result } = renderHook(() =>
      usePromptDraft({ sessionId: 1, initialDraft: null }),
    );
    act(() => {
      result.current.saveDraft("final text");
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(mockSaveDraftMutate).toHaveBeenCalledWith({ sessionId: 1, draft: "final text" });
  });

  it("debounces multiple saves — only persists the last one", () => {
    const { result } = renderHook(() =>
      usePromptDraft({ sessionId: 1, initialDraft: null }),
    );
    act(() => {
      result.current.saveDraft("a");
      result.current.saveDraft("ab");
      result.current.saveDraft("abc");
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(mockSaveDraftMutate).toHaveBeenCalledTimes(1);
    expect(mockSaveDraftMutate).toHaveBeenCalledWith({ sessionId: 1, draft: "abc" });
  });

  it("does not call mutate when sessionId is undefined", () => {
    const { result } = renderHook(() =>
      usePromptDraft({ sessionId: undefined, initialDraft: null }),
    );
    act(() => {
      result.current.saveDraft("some text");
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(mockSaveDraftMutate).not.toHaveBeenCalled();
  });

  it("flushes pending draft on unmount", () => {
    const { result, unmount } = renderHook(() =>
      usePromptDraft({ sessionId: 1, initialDraft: null }),
    );
    act(() => {
      result.current.saveDraft("pending on unmount");
    });
    // Don't advance timer — unmount should flush
    unmount();
    expect(mockSaveDraftMutate).toHaveBeenCalledWith({ sessionId: 1, draft: "pending on unmount" });
  });

  it("saves null draft (clearing draft)", () => {
    const { result } = renderHook(() =>
      usePromptDraft({ sessionId: 1, initialDraft: "old" }),
    );
    act(() => {
      result.current.saveDraft(null);
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(mockSaveDraftMutate).toHaveBeenCalledWith({ sessionId: 1, draft: null });
  });
});
