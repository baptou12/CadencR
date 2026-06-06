import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVisualViewportHeight } from "./useVisualViewportHeight";

/** Minimal stand-in for `window.visualViewport` — jsdom doesn't provide one. */
function installViewport(height: number, offsetTop = 0): { resize: (h: number) => void } {
  const target = new EventTarget();
  const vv = {
    height,
    offsetTop,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  };
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  return {
    resize: (h: number) => {
      vv.height = h;
      target.dispatchEvent(new Event("resize"));
    },
  };
}

function vh(): string {
  return document.documentElement.style.getPropertyValue("--app-vh");
}

describe("useVisualViewportHeight", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--app-vh");
    Reflect.deleteProperty(window, "visualViewport");
    vi.restoreAllMocks();
  });

  it("pins --app-vh to the visible height once the keyboard inset clears the threshold", () => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    const { resize } = installViewport(800);

    renderHook(() => useVisualViewportHeight(true));
    // No keyboard yet → no override, CSS unit still owns the height.
    expect(vh()).toBe("");

    act(() => resize(450)); // keyboard opens: 350px inset > threshold
    expect(vh()).toBe("450px");

    act(() => resize(800)); // keyboard closes: override dropped
    expect(vh()).toBe("");
  });

  it("ignores sub-threshold shrink like URL-bar show/hide", () => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    const { resize } = installViewport(800);

    renderHook(() => useVisualViewportHeight(true));
    act(() => resize(720)); // 80px inset < 120px threshold

    expect(vh()).toBe("");
  });

  it("does nothing when disabled or when the API is unavailable", () => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    const { resize } = installViewport(800);

    renderHook(() => useVisualViewportHeight(false));
    act(() => resize(450));
    expect(vh()).toBe("");

    Reflect.deleteProperty(window, "visualViewport");
    expect(() => renderHook(() => useVisualViewportHeight(true))).not.toThrow();
  });

  it("clears the override and detaches its listener on unmount", () => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    const { resize } = installViewport(800);

    const { unmount } = renderHook(() => useVisualViewportHeight(true));
    act(() => resize(450));
    expect(vh()).toBe("450px");

    unmount();
    expect(vh()).toBe(""); // cleanup restores the CSS fallback
    act(() => resize(400)); // stale events no longer mutate the var
    expect(vh()).toBe("");
  });
});
