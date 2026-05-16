import { useEffect, useState, type RefObject } from "react";

/**
 * Returns `true` while the observed element is narrower than `threshold` px.
 *
 * Used by the agent session bottom area to relocate secondary chips
 * (auto-scroll, todos, info) below the prompt when the meta bar can't fit
 * them on a single row.
 *
 * The hook reads the *current* container width on mount and updates via a
 * single shared `ResizeObserver` per ref. Hysteresis isn't needed because the
 * threshold compares against the container width — not against the meta bar's
 * own scroll width — so toggling layout doesn't change the measurement.
 *
 * The RO callback is coalesced to one `requestAnimationFrame` tick and skips
 * `setState` when the narrow/wide result is unchanged. Without that gating,
 * the synchronous `setState` from inside the observer reschedules layout in
 * the same frame, which fires the observer again — that is the classic
 * "ResizeObserver loop completed with undelivered notifications" path and
 * compounds badly when a heavy sibling (agent stream rendering a large
 * tool-result chunk) is also remeasuring on the same surface.
 */
export function useNarrowContainer(ref: RefObject<HTMLElement | null>, threshold: number): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let rafId: number | null = null;
    let lastNarrow: boolean | null = null;
    const flush = (): void => {
      rafId = null;
      const w = el.clientWidth;
      if (w === 0) return; // element detached or hidden — keep last state
      const next = w < threshold;
      if (next === lastNarrow) return;
      lastNarrow = next;
      setNarrow(next);
    };
    const measure = (): void => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(flush);
    };
    // Initial measurement runs synchronously so first paint reflects the
    // correct layout — same behaviour as before the rAF wrapping.
    const w = el.clientWidth;
    if (w > 0) {
      lastNarrow = w < threshold;
      setNarrow(lastNarrow);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return (): void => {
      ro.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [ref, threshold]);

  return narrow;
}
