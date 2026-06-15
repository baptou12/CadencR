import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserShortcut } from "@/lib/desktop-bridge";
import { useBrowserShortcutRelay } from "./useBrowserShortcutRelay";

const onBrowserShortcut = vi.hoisted(() => vi.fn());

vi.mock("@/lib/desktop-bridge", () => ({
  desktopBridge: { onBrowserShortcut },
}));

describe("useBrowserShortcutRelay", () => {
  beforeEach(() => {
    onBrowserShortcut.mockReset();
  });

  it("subscribes once, forwards shortcuts, and unsubscribes on unmount", () => {
    const unsubscribe = vi.fn();
    let emit: ((shortcut: BrowserShortcut) => void) | undefined;
    onBrowserShortcut.mockImplementation((cb: (shortcut: BrowserShortcut) => void) => {
      emit = cb;
      return unsubscribe;
    });

    const handler = vi.fn();
    const { unmount } = renderHook(() => useBrowserShortcutRelay(handler));

    expect(onBrowserShortcut).toHaveBeenCalledTimes(1);
    emit?.("pane-agent");
    expect(handler).toHaveBeenCalledWith("pane-agent");

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("invokes the latest handler without re-subscribing on re-render", () => {
    let emit: ((shortcut: BrowserShortcut) => void) | undefined;
    onBrowserShortcut.mockImplementation((cb: (shortcut: BrowserShortcut) => void) => {
      emit = cb;
      return () => undefined;
    });

    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ handler }) => useBrowserShortcutRelay(handler), {
      initialProps: { handler: first },
    });

    rerender({ handler: second });
    emit?.("reload");

    expect(onBrowserShortcut).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("reload");
  });
});
