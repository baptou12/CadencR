import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearDesktopBridgeOverrideForTests,
  desktopBridge,
  setDesktopBridgeOverrideForTests,
} from "@/lib/desktop-bridge";

const showBrowserError = vi.hoisted(() => vi.fn());

vi.mock("@/api/generated", () => ({
  useListFeatureActivity: () => ({ data: [], error: null }),
}));
vi.mock("@/components/browser/browser-errors", () => ({ showBrowserError }));

const { useFeatureActivityCounts } = await import("./useFeatureActivityCounts");

afterEach(() => {
  clearDesktopBridgeOverrideForTests();
  showBrowserError.mockReset();
});

describe("useFeatureActivityCounts", () => {
  it("does not surface a stale hydration error after a live download count", async () => {
    const initial = deferred<Record<number, number>>();
    let listener: ((counts: Record<number, number>) => void) | null = null;
    setDesktopBridgeOverrideForTests({
      ...desktopBridge,
      listBrowserTabCountsByScope: vi.fn(async () => ({})),
      onBrowserTabCounts: vi.fn(() => () => undefined),
      listBrowserDownloadCountsByScope: vi.fn(() => initial.promise),
      onBrowserDownloadCounts: vi.fn((callback) => {
        listener = callback;
        return () => undefined;
      }),
    });
    renderHook(() => useFeatureActivityCounts(1));
    await waitFor(() => expect(listener).not.toBeNull());

    act(() => listener?.({ 4: 1 }));
    await act(async () => initial.reject(new Error("stale download hydration failed")));

    expect(showBrowserError).not.toHaveBeenCalled();
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  reject: (error: unknown) => void;
} {
  let rejectPromise = (_error: unknown): void => undefined;
  const promise = new Promise<T>((_resolve, reject) => {
    rejectPromise = reject;
  });
  return { promise, reject: rejectPromise };
}
