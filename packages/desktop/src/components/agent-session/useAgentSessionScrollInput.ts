import { useCallback, useRef } from "react";
import {
  canScroll,
  isVerticalScrollbarPointer,
  HISTORY_SCROLL_TOP_PX,
  type ScrollRef,
} from "./agent-session-scroll-utils";

interface ScrollInputParams {
  scrollerElRef: React.MutableRefObject<HTMLElement | null>;
  historyLoadArmedRef: React.MutableRefObject<boolean>;
  lastScrollTopRef: React.MutableRefObject<number>;
  userScrollIntentRef: React.MutableRefObject<boolean>;
  suppressScrollIntentRef: React.MutableRefObject<boolean>;
  armUserScrollIntent: () => void;
  setAutoScrollEnabled: (enabled: boolean) => void;
  requestOlderHistory: () => void;
}

/**
 * Owns the raw DOM input listeners that disengage bottom-stick and arm
 * history loading. Split out of `useAgentSessionScroll` to keep that file
 * under the 400-line cap; the handler bodies and their `scrollContainerRef`
 * callback are unchanged. Synchronous `wheel`/`touchmove`-up disengage fires
 * before the browser repaints, so a streaming-token re-anchor in the same
 * commit can't undo the user's scroll. We only disengage when the viewport
 * can actually scroll — wheel-up on a short session is idle intent, not a
 * request to leave the bottom.
 */
export function useAgentSessionScrollInput({
  scrollerElRef,
  historyLoadArmedRef,
  lastScrollTopRef,
  userScrollIntentRef,
  suppressScrollIntentRef,
  armUserScrollIntent,
  setAutoScrollEnabled,
  requestOlderHistory,
}: ScrollInputParams): ScrollRef {
  const touchStartYRef = useRef(0);

  const onWheel = useCallback(
    (e: WheelEvent): void => {
      if (e.deltaY >= 0) return;
      const el = scrollerElRef.current;
      if (!el || !canScroll(el)) return;
      armUserScrollIntent();
      historyLoadArmedRef.current = true;
      setAutoScrollEnabled(false);
    },
    [scrollerElRef, historyLoadArmedRef, armUserScrollIntent, setAutoScrollEnabled],
  );
  const onPointerDown = useCallback(
    (e: PointerEvent): void => {
      const el = scrollerElRef.current;
      if (!el || !canScroll(el) || !isVerticalScrollbarPointer(el, e)) return;
      historyLoadArmedRef.current = true;
      armUserScrollIntent();
    },
    [scrollerElRef, historyLoadArmedRef, armUserScrollIntent],
  );
  const onKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      if (!["ArrowUp", "PageUp", "Home"].includes(e.key)) return;
      armUserScrollIntent();
    },
    [armUserScrollIntent],
  );
  const onTouchStart = useCallback((e: TouchEvent): void => {
    touchStartYRef.current = e.touches[0]?.clientY ?? 0;
  }, []);
  const onTouchMove = useCallback(
    (e: TouchEvent): void => {
      const y = e.touches[0]?.clientY ?? 0;
      if (y <= touchStartYRef.current + 5) return;
      const el = scrollerElRef.current;
      if (!el || !canScroll(el)) return;
      armUserScrollIntent();
      historyLoadArmedRef.current = true;
      setAutoScrollEnabled(false);
    },
    [scrollerElRef, historyLoadArmedRef, armUserScrollIntent, setAutoScrollEnabled],
  );
  const onScroll = useCallback((): void => {
    const el = scrollerElRef.current;
    if (!el) return;
    const currentScrollTop = el.scrollTop;
    const previousScrollTop = lastScrollTopRef.current;
    lastScrollTopRef.current = currentScrollTop;

    if (suppressScrollIntentRef.current || !canScroll(el)) return;
    if (!userScrollIntentRef.current) return;
    const isScrollingUp = currentScrollTop < previousScrollTop - 1;
    if (!isScrollingUp) return;

    historyLoadArmedRef.current = true;
    setAutoScrollEnabled(false);
    if (currentScrollTop <= HISTORY_SCROLL_TOP_PX) requestOlderHistory();
  }, [
    scrollerElRef,
    lastScrollTopRef,
    suppressScrollIntentRef,
    userScrollIntentRef,
    historyLoadArmedRef,
    requestOlderHistory,
    setAutoScrollEnabled,
  ]);

  return useCallback<ScrollRef>(
    (el) => {
      const prev = scrollerElRef.current;
      if (prev === el) return;
      if (prev) {
        prev.removeEventListener("keydown", onKeyDown);
        prev.removeEventListener("pointerdown", onPointerDown);
        prev.removeEventListener("wheel", onWheel);
        prev.removeEventListener("scroll", onScroll);
        prev.removeEventListener("touchstart", onTouchStart);
        prev.removeEventListener("touchmove", onTouchMove);
      }
      scrollerElRef.current = el;
      if (el) {
        lastScrollTopRef.current = el.scrollTop;
        el.addEventListener("keydown", onKeyDown);
        el.addEventListener("pointerdown", onPointerDown, { passive: true });
        el.addEventListener("wheel", onWheel, { passive: true });
        el.addEventListener("scroll", onScroll, { passive: true });
        el.addEventListener("touchstart", onTouchStart, { passive: true });
        el.addEventListener("touchmove", onTouchMove, { passive: true });
      }
    },
    [
      scrollerElRef,
      lastScrollTopRef,
      onKeyDown,
      onPointerDown,
      onWheel,
      onScroll,
      onTouchStart,
      onTouchMove,
    ],
  );
}
