import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePromptHistory } from "./usePromptHistory";

const mockAddEntryMutate = vi.fn();
const mockInvalidateQueries = vi.fn();
const mockHistoryQuery = vi.fn((): { data: string[] } => ({ data: [] }));

vi.mock("../api/generated", () => ({
  useGetWorkspacePromptHistory: () => mockHistoryQuery(),
  useAddWorkspacePromptEntry: vi.fn(() => ({
    mutate: (data: unknown, opts?: { onSuccess?: () => void }) => {
      mockAddEntryMutate(data);
      opts?.onSuccess?.();
    },
  })),
  getGetWorkspacePromptHistoryQueryKey: vi.fn((projectId: number) => ["workspace", "prompt-history", projectId]),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: vi.fn(() => ({ invalidateQueries: mockInvalidateQueries })),
  };
});

describe("usePromptHistory", () => {
  beforeEach(() => {
    mockAddEntryMutate.mockClear();
    mockInvalidateQueries.mockClear();
    mockHistoryQuery.mockReturnValue({ data: [] });
  });

  it("starts with historyIndex -1 (not browsing)", () => {
    const { result } = renderHook(() => usePromptHistory(1));
    expect(result.current.historyIndex).toBe(-1);
  });

  it("navigateUp returns null when no history", () => {
    const { result } = renderHook(() => usePromptHistory(1));
    let res: string | null = null;
    act(() => {
      res = result.current.navigateUp("current text");
    });
    expect(res).toBeNull();
    expect(result.current.historyIndex).toBe(-1);
  });

  it("navigateDown returns null when not browsing", () => {
    const { result } = renderHook(() => usePromptHistory(1));
    let res: string | null = null;
    act(() => {
      res = result.current.navigateDown();
    });
    expect(res).toBeNull();
  });

  it("navigateUp returns first history entry and sets index to 0", () => {
    mockHistoryQuery.mockReturnValue({ data: ["first", "second", "third"] });
    const { result } = renderHook(() => usePromptHistory(1));
    let res: string | null = null;
    act(() => {
      res = result.current.navigateUp("draft text");
    });
    expect(res).toBe("first");
    expect(result.current.historyIndex).toBe(0);
  });

  it("navigateUp goes to older entries", () => {
    mockHistoryQuery.mockReturnValue({ data: ["first", "second", "third"] });
    const { result } = renderHook(() => usePromptHistory(1));
    act(() => {
      result.current.navigateUp("draft");
    });
    let res: string | null = null;
    act(() => {
      res = result.current.navigateUp("first");
    });
    expect(res).toBe("second");
    expect(result.current.historyIndex).toBe(1);
  });

  it("navigateDown returns previous entry when browsing", () => {
    mockHistoryQuery.mockReturnValue({ data: ["first", "second"] });
    const { result } = renderHook(() => usePromptHistory(1));
    act(() => {
      result.current.navigateUp("draft");
    });
    act(() => {
      result.current.navigateUp("first");
    });
    let res: string | null = null;
    act(() => {
      res = result.current.navigateDown();
    });
    expect(res).toBe("first");
    expect(result.current.historyIndex).toBe(0);
  });

  it("navigateDown at index 0 returns to draft text", () => {
    mockHistoryQuery.mockReturnValue({ data: ["first"] });
    const { result } = renderHook(() => usePromptHistory(1));
    act(() => {
      result.current.navigateUp("my draft");
    });
    let res: string | null = null;
    act(() => {
      res = result.current.navigateDown();
    });
    expect(res).toBe("my draft");
    expect(result.current.historyIndex).toBe(-1);
  });

  it("navigateUp at oldest entry returns null", () => {
    mockHistoryQuery.mockReturnValue({ data: ["only"] });
    const { result } = renderHook(() => usePromptHistory(1));
    act(() => {
      result.current.navigateUp("draft");
    });
    let res: string | null = null;
    act(() => {
      res = result.current.navigateUp("only");
    });
    expect(res).toBeNull();
    expect(result.current.historyIndex).toBe(0); // stays at oldest
  });

  it("addEntry calls mutation and resets navigation", () => {
    const { result } = renderHook(() => usePromptHistory(1));
    act(() => {
      result.current.addEntry("my command");
    });
    expect(mockAddEntryMutate).toHaveBeenCalledWith({ projectId: 1, content: "my command" });
    expect(result.current.historyIndex).toBe(-1);
  });

  it("addEntry ignores empty strings", () => {
    const { result } = renderHook(() => usePromptHistory(1));
    act(() => {
      result.current.addEntry("   ");
    });
    expect(mockAddEntryMutate).not.toHaveBeenCalled();
  });

  it("addEntry invalidates cache on success", () => {
    const { result } = renderHook(() => usePromptHistory(1));
    act(() => {
      result.current.addEntry("my command");
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["workspace", "prompt-history", 1],
    });
  });

  it("resetNavigation resets historyIndex to -1", () => {
    mockHistoryQuery.mockReturnValue({ data: ["first"] });
    const { result } = renderHook(() => usePromptHistory(1));
    act(() => {
      result.current.navigateUp("draft");
    });
    expect(result.current.historyIndex).toBe(0);
    act(() => {
      result.current.resetNavigation();
    });
    expect(result.current.historyIndex).toBe(-1);
  });

  it("resetNavigation is no-op when not browsing", () => {
    const { result } = renderHook(() => usePromptHistory(1));
    // Should not throw
    act(() => {
      result.current.resetNavigation();
    });
    expect(result.current.historyIndex).toBe(-1);
  });
});
