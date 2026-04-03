import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useGlobalShortcut } from "./useGlobalShortcut";

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  window.dispatchEvent(event);
  return event;
}

describe("useGlobalShortcut", () => {
  let callback: ReturnType<typeof vi.fn<(e: KeyboardEvent) => void>>;

  beforeEach(() => {
    callback = vi.fn<(e: KeyboardEvent) => void>();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires callback on matching meta+key shortcut", () => {
    renderHook(() => useGlobalShortcut("meta+p", callback));
    fireKey("p", { metaKey: true, code: "KeyP" });
    expect(callback).toHaveBeenCalledOnce();
  });

  it("does not fire when modifier is missing", () => {
    renderHook(() => useGlobalShortcut("meta+p", callback));
    fireKey("p", { code: "KeyP" });
    expect(callback).not.toHaveBeenCalled();
  });

  it("does not fire when wrong modifier is pressed", () => {
    renderHook(() => useGlobalShortcut("meta+p", callback));
    fireKey("p", { ctrlKey: true, code: "KeyP" });
    expect(callback).not.toHaveBeenCalled();
  });

  it("does not fire when extra modifier is pressed", () => {
    renderHook(() => useGlobalShortcut("meta+p", callback));
    fireKey("p", { metaKey: true, shiftKey: true, code: "KeyP" });
    expect(callback).not.toHaveBeenCalled();
  });

  it("handles meta+shift+key", () => {
    renderHook(() => useGlobalShortcut("meta+shift+m", callback));
    fireKey("M", { metaKey: true, shiftKey: true, code: "KeyM" });
    expect(callback).toHaveBeenCalledOnce();
  });

  it("handles ctrl+key using e.code for letters", () => {
    // ctrl+j produces a control character for e.key, but e.code stays KeyJ
    renderHook(() => useGlobalShortcut("ctrl+j", callback));
    fireKey("\n", { ctrlKey: true, code: "KeyJ" });
    expect(callback).toHaveBeenCalledOnce();
  });

  it("handles meta+enter (non-letter key)", () => {
    renderHook(() => useGlobalShortcut("meta+enter", callback));
    fireKey("Enter", { metaKey: true, code: "Enter" });
    expect(callback).toHaveBeenCalledOnce();
  });

  it("handles meta+shift+? (symbol key)", () => {
    renderHook(() => useGlobalShortcut("meta+shift+?", callback));
    fireKey("?", { metaKey: true, shiftKey: true, code: "Slash" });
    expect(callback).toHaveBeenCalledOnce();
  });

  it("handles digit keys", () => {
    renderHook(() => useGlobalShortcut("meta+1", callback));
    fireKey("1", { metaKey: true, code: "Digit1" });
    expect(callback).toHaveBeenCalledOnce();
  });

  it("does not fire when enabled is false", () => {
    renderHook(() => useGlobalShortcut("meta+p", callback, { enabled: false }));
    fireKey("p", { metaKey: true, code: "KeyP" });
    expect(callback).not.toHaveBeenCalled();
  });

  it("re-attaches listener when enabled changes to true", () => {
    const { rerender } = renderHook(
      ({ enabled }) => useGlobalShortcut("meta+p", callback, { enabled }),
      { initialProps: { enabled: false } },
    );
    fireKey("p", { metaKey: true, code: "KeyP" });
    expect(callback).not.toHaveBeenCalled();

    rerender({ enabled: true });
    fireKey("p", { metaKey: true, code: "KeyP" });
    expect(callback).toHaveBeenCalledOnce();
  });

  it("cleans up listener on unmount", () => {
    const { unmount } = renderHook(() => useGlobalShortcut("meta+p", callback));
    unmount();
    fireKey("p", { metaKey: true, code: "KeyP" });
    expect(callback).not.toHaveBeenCalled();
  });

  it("uses latest callback without re-attaching listener", () => {
    const cb1 = vi.fn<(e: KeyboardEvent) => void>();
    const cb2 = vi.fn<(e: KeyboardEvent) => void>();
    const { rerender } = renderHook(
      ({ cb }) => useGlobalShortcut("meta+p", cb),
      { initialProps: { cb: cb1 } },
    );
    rerender({ cb: cb2 });
    fireKey("p", { metaKey: true, code: "KeyP" });
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it("passes the KeyboardEvent to callback", () => {
    renderHook(() => useGlobalShortcut("meta+s", callback));
    fireKey("s", { metaKey: true, code: "KeyS" });
    expect(callback).toHaveBeenCalledWith(expect.any(KeyboardEvent));
  });
});
