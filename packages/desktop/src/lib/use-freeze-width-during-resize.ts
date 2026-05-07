import { useEffect, useRef, type MutableRefObject } from "react";
import { subscribeResize } from "./resize-coordinator";

/**
 * Freeze an element's width to its pre-drag value while a panel-resize drag
 * is in flight, then release on pointerup so the content reflows once.
 *
 * Why this exists
 * ---------------
 * Heavy pane content — terminals (xterm), code editors (CodeMirror), diff
 * viewers (dozens of CM instances), agent streams — re-flows on every
 * pointer-move during a panel-resize drag. With a few of those visible at
 * once, each pointer-move triggers an O(N) layout pass: text wrap recompute
 * across thousands of nodes, code-block remeasurement, diff table relayout.
 * The drag jitters at sub-30 fps no matter how cheap the panel chrome is.
 *
 * The fix is the standard "freeze-then-snap": pin the heavy subtree's width
 * to its current `clientWidth` for the duration of the drag, so the surrounding
 * panel can grow/shrink (instant pointer-tracking) but the locked subtree
 * skips the cascading layout. On release we clear the lock and the content
 * reflows once.
 *
 * Visual trade-off
 * ----------------
 * - Growing the pane mid-drag: locked content stays at its old width, leaving
 *   a transient gutter of empty space until release.
 * - Shrinking the pane mid-drag: locked content overflows and is clipped by
 *   the surrounding scroller's `overflow-x-hidden` until release.
 * Both snap to the new layout in a single reflow on pointerup. Acceptable in
 * exchange for buttery 60 fps drags that scale independent of pane content.
 *
 * Wiring
 * ------
 * The caller stores the target element in the returned `MutableRefObject`.
 * Typically that's a callback ref on the actual DOM node:
 *
 *   const freezeRef = useFreezeWidthDuringResize();
 *   const setRef = useCallback((el: HTMLElement | null) => {
 *     freezeRef.current = el;
 *     // …other ref consumers
 *   }, [freezeRef]);
 *
 * On each `pushResize()` the hook reads `clientWidth` and pins it via inline
 * style. On the final `popResize()` (count→0) the inline style is cleared.
 * Idempotent for repeated `notify(true)` calls (the resize-coordinator may
 * fire several true notifications during a single drag if the global refcount
 * has drifted): re-locking at the already-locked width is a DOM no-op.
 *
 * Skips the lock when `clientWidth` is 0 (hidden tab, display:none ancestor,
 * not yet laid out): pinning to 0px would collapse the pane when the user
 * finally surfaces it, and there's nothing to gain by freezing an invisible
 * subtree.
 */
export function useFreezeWidthDuringResize<
  T extends HTMLElement = HTMLDivElement,
>(): MutableRefObject<T | null> {
  const elRef = useRef<T | null>(null);
  useEffect(() => {
    // Track whether we've already pinned the width for the current drag.
    // The coordinator fires `notify(true)` on every push (drift recovery —
    // see `resize-coordinator.ts`); without this guard each repeat would
    // re-read `clientWidth` (forced layout) and rewrite the same value.
    let locked = false;
    return subscribeResize((active) => {
      const el = elRef.current;
      if (!el) return;
      if (active) {
        if (locked) return;
        const w = el.clientWidth;
        if (w === 0) return;
        el.style.width = `${w}px`;
        locked = true;
      } else if (locked) {
        el.style.width = "";
        locked = false;
      }
    });
  }, []);
  return elRef;
}
