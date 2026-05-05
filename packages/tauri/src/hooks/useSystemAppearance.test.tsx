import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSystemAppearance } from "./useSystemAppearance";

const tauriMocks = vi.hoisted(() => {
  let handler: ((event: { payload: "light" | "dark" }) => void) | null = null;
  let shouldThrow = false;
  const theme = vi.fn<() => Promise<"light" | "dark" | null>>();
  const unlisten = vi.fn();
  const onThemeChanged = vi.fn((nextHandler: (event: { payload: "light" | "dark" }) => void) => {
    handler = nextHandler;
    return Promise.resolve(unlisten);
  });

  return {
    emitThemeChanged: (payload: "light" | "dark") => handler?.({ payload }),
    setShouldThrow: (next: boolean) => {
      shouldThrow = next;
    },
    shouldThrow: () => shouldThrow,
    onThemeChanged,
    theme,
    unlisten,
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    if (tauriMocks.shouldThrow()) throw new Error("Tauri unavailable");
    return {
      theme: tauriMocks.theme,
      onThemeChanged: tauriMocks.onThemeChanged,
    };
  },
}));

describe("useSystemAppearance", () => {
  beforeEach(() => {
    tauriMocks.setShouldThrow(false);
    tauriMocks.theme.mockReset();
    tauriMocks.onThemeChanged.mockClear();
    tauriMocks.unlisten.mockClear();
    tauriMocks.theme.mockResolvedValue("dark");
  });

  it("reads the initial Tauri theme and updates when the system theme changes", async () => {
    const { result, unmount } = renderHook(() => useSystemAppearance());

    await waitFor(() => expect(result.current.appearance).toBe("dark"));

    act(() => tauriMocks.emitThemeChanged("light"));

    expect(result.current.appearance).toBe("light");
    expect(result.current.error).toBeNull();

    unmount();

    expect(tauriMocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("falls back to matchMedia updates when Tauri theme APIs are unavailable", () => {
    tauriMocks.setShouldThrow(true);
    let matches = false;
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((_event: string, listener: EventListenerOrEventListenerObject) => {
        listeners.push(listener as (event: MediaQueryListEvent) => void);
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useSystemAppearance());

    expect(result.current.appearance).toBe("light");

    act(() => {
      matches = true;
      for (const listener of listeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });

    expect(result.current.appearance).toBe("dark");
  });
});
