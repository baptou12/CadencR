import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useScrollParentOffsetSync } from "./useScrollParentOffsetSync";

const observed: Element[] = [];
const resizeCallbacks: Array<() => void> = [];
class CapturingResizeObserver {
  constructor(callback: () => void) {
    resizeCallbacks.push(callback);
  }
  observe(element: Element): void {
    observed.push(element);
  }
  disconnect(): void {}
}

const frames: Array<() => void> = [];

function boxed<T extends HTMLElement>(element: T, box: Partial<DOMRect>): T {
  element.getBoundingClientRect = () => ({ ...box }) as DOMRect;
  return element;
}

/** viewport > content > lists, each with a mutable box. */
function sidebar(listCount = 1) {
  const viewport = boxed(document.createElement("div"), { top: 100 });
  const content = viewport.appendChild(document.createElement("div"));
  const lists = Array.from({ length: listCount }, (_, index) => {
    const box = { top: 300 + index * 500 };
    return {
      ref: { current: content.appendChild(boxed(document.createElement("div"), box)) },
      box,
    };
  });
  const scrolls = vi.fn();
  viewport.addEventListener("scroll", scrolls);
  return { viewport, content, lists, scrolls };
}

describe("useScrollParentOffsetSync", () => {
  beforeEach(() => {
    observed.length = 0;
    resizeCallbacks.length = 0;
    frames.length = 0;
    vi.stubGlobal("ResizeObserver", CapturingResizeObserver);
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replays a scroll when content above moves the list", () => {
    const { viewport, content, lists, scrolls } = sidebar();
    renderHook(() => useScrollParentOffsetSync(lists[0].ref, viewport));
    expect(observed).toEqual([content]);

    // A block above the list shrinks: the list moves up without any scroll.
    lists[0].box.top = 220;
    resizeCallbacks[0]();
    expect(scrolls).toHaveBeenCalledTimes(1);
  });

  it("measures the offset within the content, so a real scroll is not replayed", () => {
    const { viewport, lists, scrolls } = sidebar();
    renderHook(() => useScrollParentOffsetSync(lists[0].ref, viewport));

    viewport.scrollTop = 50;
    lists[0].box.top = 250;
    resizeCallbacks[0]();
    expect(scrolls).not.toHaveBeenCalled();
  });

  it("replays one scroll per frame for every list in the scroll parent", () => {
    const { viewport, lists, scrolls } = sidebar(2);
    for (const list of lists) renderHook(() => useScrollParentOffsetSync(list.ref, viewport));

    for (const list of lists) list.box.top -= 80;
    resizeCallbacks.forEach((callback) => callback());
    expect(scrolls).toHaveBeenCalledTimes(1);

    frames.forEach((frame) => frame());
    for (const list of lists) list.box.top -= 80;
    resizeCallbacks.forEach((callback) => callback());
    expect(scrolls).toHaveBeenCalledTimes(2);
  });
});
