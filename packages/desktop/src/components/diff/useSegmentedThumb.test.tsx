import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSegmentedThumb } from "./useSegmentedThumb";

/**
 * jsdom reports every rect as zero, so the geometry has to be staged by hand.
 *
 * The shape matters more than the numbers: each tab sits inside its own
 * `position: relative` tooltip wrapper, which is exactly what makes
 * `offsetLeft` useless here — it resolves against the wrapper, not the strip.
 * Every button in this fixture therefore reports `offsetLeft = 0`, so a
 * measurement that trusts it can only ever return the left edge.
 */
function stageStrip(activeIndex: number, widths = [90, 120, 70]): HTMLElement {
  const list = document.createElement("div");
  list.getBoundingClientRect = () => rect(200, 300);
  // 1px border on the strip: an absolutely positioned thumb is placed against
  // the padding box, so the border has to come out of the offset.
  Object.defineProperty(list, "clientLeft", { value: 1 });

  let cursor = 200 + 1 + 4; // strip left + border + p-1
  widths.forEach((width, index) => {
    const wrapper = document.createElement("div");
    const button = document.createElement("button");
    button.dataset.active = String(index === activeIndex);
    const left = cursor;
    button.getBoundingClientRect = () => rect(left, left + width);
    Object.defineProperty(button, "offsetLeft", { value: 0 });
    wrapper.append(button);
    list.append(wrapper);
    cursor += width + 2;
  });
  document.body.append(list);
  return list;
}

function rect(left: number, right: number): DOMRect {
  return {
    left,
    right,
    width: right - left,
    top: 0,
    bottom: 24,
    height: 24,
    x: left,
    y: 0,
  } as DOMRect;
}

function measure(activeIndex: number) {
  const list = stageStrip(activeIndex);
  const { result } = renderHook(({ key }: { key: string }) => useSegmentedThumb(key, "sig"), {
    initialProps: { key: String(activeIndex) },
  });
  // Attaching the strip is a state change, so it has to flush before the
  // effect's measurement is readable.
  act(() => result.current.listRef(list));
  return result;
}

describe("useSegmentedThumb", () => {
  it("measures the active tab against the strip, not its positioned wrapper", () => {
    // Second tab: 1px border + 4px padding + 90px first tab + 2px gap = 96.
    expect(measure(1).current.thumb).toMatchObject({ left: 96, width: 120 });
  });

  it("lands on the first tab's own edge, not a hardcoded zero", () => {
    // 4px of strip padding — the border is already out via `clientLeft`.
    expect(measure(0).current.thumb).toMatchObject({ left: 4, width: 90 });
  });

  it("tracks the last tab rather than parking at the left edge", () => {
    expect(measure(2).current.thumb).toMatchObject({ left: 218, width: 70 });
  });

  it("does not animate into place on the first measurement", () => {
    expect(measure(1).current.thumb?.animate).toBe(false);
  });

  it("reports nothing while the strip is unmeasurable, so the thumb stays hidden", () => {
    const list = document.createElement("div");
    list.getBoundingClientRect = () => rect(0, 0);
    const button = document.createElement("button");
    button.dataset.active = "true";
    button.getBoundingClientRect = () => rect(0, 0);
    list.append(button);
    document.body.append(list);

    const { result } = renderHook(() => useSegmentedThumb("a", "sig"));
    act(() => result.current.listRef(list));

    // A hidden pane reports zero widths; parking the thumb at 0×0 would make
    // it fly across the strip when the pane came back.
    expect(result.current.thumb).toBeNull();
  });
});
