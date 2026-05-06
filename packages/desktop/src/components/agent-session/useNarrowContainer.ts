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
 */
export function useNarrowContainer(ref: RefObject<HTMLElement | null>, threshold: number): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => {
      setNarrow(el.clientWidth > 0 && el.clientWidth < threshold);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return (): void => ro.disconnect();
  }, [ref, threshold]);

  return narrow;
}
