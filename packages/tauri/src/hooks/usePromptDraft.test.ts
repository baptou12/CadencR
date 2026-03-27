import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { usePromptDraft } from "./usePromptDraft";

const mockSaveDraftMutate = vi.fn();
const mockSendRaw = vi.fn();
const mockSendRequest = vi.fn((): Promise<{ draft: string | null }> => Promise.resolve({ draft: null }));
const mockDraftQueryData = vi.fn((): { draftPrompt: string | null } | undefined => undefined);

vi.mock("../api/generated", () => ({
  useSaveSessionDraft: vi.fn(() => ({ mutate: mockSaveDraftMutate })),
  useGetSessionDraft: vi.fn(() => ({ data: mockDraftQueryData() })),
}));

vi.mock("@/stores/ws-session-store", () => ({
  useWsSessionStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      send: mockSendRaw,
      sendRequest: mockSendRequest,
      sessions: {
        "ws-test-1": { isConnected: true, serverSessionId: "42" },
      },
    }),
}));

describe("usePromptDraft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSaveDraftMutate.mockClear();
    mockSendRaw.mockClear();
    mockSendRequest.mockClear();
    mockSendRequest.mockResolvedValue({ draft: null });
    mockDraftQueryData.mockReturnValue(undefined);
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

  it("saves via HTTP when no wsSessionId", () => {
    const { result } = renderHook(() =>
      usePromptDraft({ sessionId: 1, initialDraft: null }),
    );
    act(() => { result.current.saveDraft("final text"); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(mockSaveDraftMutate).toHaveBeenCalledWith({ sessionId: 1, draft: "final text" });
    expect(mockSendRaw).not.toHaveBeenCalled();
  });

  it("saves via WS when wsSessionId is provided", () => {
    const { result } = renderHook(() =>
      usePromptDraft({ sessionId: undefined, wsSessionId: "ws-test-1", initialDraft: null }),
    );
    act(() => { result.current.saveDraft("ws draft"); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(mockSendRaw).toHaveBeenCalledTimes(1);
    expect(mockSaveDraftMutate).not.toHaveBeenCalled();
  });

  it("fetches draft from DB via WS when no initialDraft", async () => {
    mockSendRequest.mockResolvedValue({ draft: "restored text" });
    const { result } = renderHook(() =>
      usePromptDraft({ sessionId: undefined, wsSessionId: "ws-test-1", initialDraft: null }),
    );
    await act(async () => { await Promise.resolve(); });
    expect(result.current.initialDraft).toBe("restored text");
  });

  it("restores draft from HTTP query for workflow agents", () => {
    mockDraftQueryData.mockReturnValue({ draftPrompt: "workflow draft" });
    const { result } = renderHook(() =>
      usePromptDraft({ sessionId: 1, initialDraft: null }),
    );
    expect(result.current.initialDraft).toBe("workflow draft");
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
    act(() => { vi.advanceTimersByTime(500); });
    expect(mockSaveDraftMutate).toHaveBeenCalledTimes(1);
    expect(mockSaveDraftMutate).toHaveBeenCalledWith({ sessionId: 1, draft: "abc" });
  });

  it("does not save when no sessionId and no wsSessionId", () => {
    const { result } = renderHook(() =>
      usePromptDraft({ sessionId: undefined, initialDraft: null }),
    );
    act(() => { result.current.saveDraft("some text"); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(mockSaveDraftMutate).not.toHaveBeenCalled();
  });

  it("flushes pending draft on unmount", () => {
    const { result, unmount } = renderHook(() =>
      usePromptDraft({ sessionId: 1, initialDraft: null }),
    );
    act(() => { result.current.saveDraft("pending on unmount"); });
    unmount();
    expect(mockSaveDraftMutate).toHaveBeenCalledWith({ sessionId: 1, draft: "pending on unmount" });
  });

  it("saves null draft (clearing draft)", () => {
    const { result } = renderHook(() =>
      usePromptDraft({ sessionId: 1, initialDraft: "old" }),
    );
    act(() => { result.current.saveDraft(null); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(mockSaveDraftMutate).toHaveBeenCalledWith({ sessionId: 1, draft: null });
  });
});
