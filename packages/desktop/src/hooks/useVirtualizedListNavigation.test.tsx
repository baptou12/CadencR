import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VirtuosoHandle } from "react-virtuoso";
import { useVirtualizedListNavigation } from "./useVirtualizedListNavigation";

describe("useVirtualizedListNavigation", () => {
  it("shares one selection source for movement and opening", () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useVirtualizedListNavigation(["first", "second"], onOpen));

    act(() => expect(result.current.navigation.moveSelection(1)).toBe("second"));
    expect(result.current.navigation.getActiveItem()).toBe("second");
    act(() => expect(result.current.navigation.openActive()).toBe(true));
    expect(onOpen).toHaveBeenCalledWith("second");
  });

  it("selects a mouse-activated index before opening it", () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useVirtualizedListNavigation(["first", "second"], onOpen));

    act(() => expect(result.current.navigation.openIndex(1)).toBe(true));

    expect(result.current.activeIndex).toBe(1);
    expect(result.current.navigation.getActiveItem()).toBe("second");
    expect(onOpen).toHaveBeenCalledWith("second");
  });

  it("does not ask Virtuoso to scroll when selection clamps to the active boundary", () => {
    const { result } = renderHook(() => useVirtualizedListNavigation(["first"], vi.fn()));
    const scrollIntoView = vi.fn();
    result.current.virtuosoRef.current = { scrollIntoView } as unknown as VirtuosoHandle;

    act(() => expect(result.current.navigation.moveSelection(-1)).toBe("first"));
    act(() => expect(result.current.navigation.moveSelection(1)).toBe("first"));

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolls exactly half the active virtualized viewport", () => {
    const { result } = renderHook(() => useVirtualizedListNavigation(["first"], vi.fn()));
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", { value: 600 });
    const scrollBy = vi.fn();
    result.current.viewportRef.current = viewport;
    result.current.virtuosoRef.current = { scrollBy } as unknown as VirtuosoHandle;

    expect(result.current.navigation.scrollHalfPage(1)).toBe(true);
    expect(result.current.navigation.scrollHalfPage(-1)).toBe(true);

    expect(scrollBy).toHaveBeenNthCalledWith(1, { top: 300, behavior: "smooth" });
    expect(scrollBy).toHaveBeenNthCalledWith(2, { top: -300, behavior: "smooth" });
  });

  it("leaves the key unhandled when no measurable viewport owns scrolling", () => {
    const { result } = renderHook(() => useVirtualizedListNavigation(["first"], vi.fn()));

    expect(result.current.navigation.scrollHalfPage(1)).toBe(false);
  });
});
