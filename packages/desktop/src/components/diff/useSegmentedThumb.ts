import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface SegmentedThumb {
  left: number;
  width: number;
  /** True only when the selection moved, so the thumb slides between tabs and snaps everywhere else. */
  animate: boolean;
}

export interface SegmentedThumbResult {
  listRef: (element: HTMLElement | null) => void;
  thumb: SegmentedThumb | null;
}

/**
 * Tracks the active segment of a segmented control so one shared element can
 * slide between tabs instead of six backgrounds cross-fading.
 *
 * Layout reads are the expensive part, so they are gated to the only two things
 * that can move the target: `activeKey` changing, and the strip resizing (a
 * longer target-branch label, or the pane itself). Returns `null` while nothing
 * is measurable — a hidden pane reports zero widths, and parking the thumb at
 * 0×0 would make it fly across the strip when the pane came back.
 */
export function useSegmentedThumb(activeKey: string, signature: string): SegmentedThumbResult {
  const [list, setList] = useState<HTMLElement | null>(null);
  const [thumb, setThumb] = useState<SegmentedThumb | null>(null);
  const measuredKey = useRef<string | null>(null);
  const listRef = useCallback((element: HTMLElement | null) => setList(element), []);

  // Held in a ref so the observer below can stay bound to the element alone.
  const measure = useRef<(animate: boolean) => void>(() => {});
  measure.current = (animate: boolean): void => {
    if (!list) return;
    const active = list.querySelector<HTMLElement>("[data-active='true']");
    const bounds = active?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) {
      measuredKey.current = null;
      setThumb(null);
      return;
    }
    // Rects, not `offsetLeft`: every tab is wrapped in a positioned tooltip
    // element, so each button's `offsetParent` is its own wrapper and
    // `offsetLeft` reads ~0 for all of them — which parked the thumb at the
    // left edge instead of following the selection. `clientLeft` takes the
    // strip's border off, because an absolutely positioned child is placed
    // against the padding box while `getBoundingClientRect` reports borders.
    const listBounds = list.getBoundingClientRect();
    const next = {
      left: bounds.left - listBounds.left - list.clientLeft,
      width: bounds.width,
      animate,
    };
    measuredKey.current = activeKey;
    setThumb((previous) =>
      previous?.left === next.left &&
      previous.width === next.width &&
      previous.animate === next.animate
        ? previous
        : next,
    );
  };

  // A selection change is the only thing that should slide. The first
  // measurement must not — the thumb would fly in from the left edge — and
  // neither should a resize: while a pane is being dragged the strip relays out
  // continuously, and a 200ms ease turns that into the thumb visibly chasing
  // the tab it is supposed to be under.
  useLayoutEffect(() => {
    measure.current(measuredKey.current !== null && measuredKey.current !== activeKey);
  }, [activeKey, list, signature]);

  useEffect(() => {
    if (!list) return;
    const observer = new ResizeObserver(() => measure.current(false));
    observer.observe(list);
    return () => observer.disconnect();
  }, [list]);

  return { listRef, thumb };
}
