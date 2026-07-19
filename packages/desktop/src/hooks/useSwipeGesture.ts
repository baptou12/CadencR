import { useEffect, useRef, type RefObject } from "react";

/** Horizontal travel (px) before a drag counts as a swipe. */
const SWIPE_THRESHOLD_PX = 48;
/** Vertical drift (px) that reclassifies the drag as a scroll and aborts it. */
const MAX_VERTICAL_DRIFT_PX = 40;

export type SwipeDirection = "left" | "right";

interface SwipeGestureOptions {
  /** Attach the listeners. Pass `false` to leave the element inert. */
  enabled: boolean;
  /** Which way the finger must travel to fire `onSwipe`. */
  direction: SwipeDirection;
  onSwipe: () => void;
  /**
   * Cancel the browser's own gesture for this touch by calling
   * `preventDefault()` on `touchstart` (which requires a non-passive listener).
   *
   * This is what stops iOS Safari's left-edge swipe-back — and Chrome's
   * equivalent history navigation — from claiming a drag that starts at the
   * screen edge. Only set it on a narrow, non-interactive strip: preventing
   * the default also suppresses scrolling and the synthesized click for
   * anything underneath.
   */
  blockNativeGesture?: boolean;
}

/**
 * Recognizes a one-finger horizontal swipe on the returned element.
 *
 * Deliberately a threshold-and-fire recognizer rather than a finger-tracking
 * drag: the drawer it drives is a CSS transition, so there is no partial
 * position to interpolate and no animation frame work per touchmove.
 */
export function useSwipeGesture({
  enabled,
  direction,
  onSwipe,
  blockNativeGesture = false,
}: SwipeGestureOptions): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  // Kept in a ref so a caller passing an inline arrow doesn't re-bind the
  // listeners (and drop an in-flight gesture) on every render.
  const onSwipeRef = useRef(onSwipe);
  useEffect(() => {
    onSwipeRef.current = onSwipe;
  }, [onSwipe]);

  useEffect((): (() => void) | void => {
    const el = ref.current;
    if (!el || !enabled) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    const handleStart = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1) {
        tracking = false;
        return;
      }
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
      if (blockNativeGesture) event.preventDefault();
    };

    const handleMove = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (!tracking || !touch) return;
      if (Math.abs(touch.clientY - startY) > MAX_VERTICAL_DRIFT_PX) {
        tracking = false;
        return;
      }
      const dx = touch.clientX - startX;
      const travelled = direction === "right" ? dx : -dx;
      if (travelled >= SWIPE_THRESHOLD_PX) {
        tracking = false;
        onSwipeRef.current();
      }
    };

    const handleEnd = (): void => {
      tracking = false;
    };

    el.addEventListener("touchstart", handleStart, { passive: !blockNativeGesture });
    el.addEventListener("touchmove", handleMove, { passive: true });
    el.addEventListener("touchend", handleEnd, { passive: true });
    el.addEventListener("touchcancel", handleEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", handleStart);
      el.removeEventListener("touchmove", handleMove);
      el.removeEventListener("touchend", handleEnd);
      el.removeEventListener("touchcancel", handleEnd);
    };
  }, [enabled, direction, blockNativeGesture]);

  return ref;
}
