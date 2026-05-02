import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import { toast } from "sonner";
import type { VirtuosoHandle } from "react-virtuoso";

/**
 * Initial value for `firstItemIndex`. Virtuoso uses item indices to track
 * scroll position; when older history is prepended we *decrement* this so
 * existing items keep their conceptual indices.
 */
const PREPEND_START_INDEX = 1_000_000;

/**
 * Auto-scroll, in three rules:
 *
 *   1. At the bottom → auto-scroll, always.
 *   2. User scrolls up → stop auto-scrolling.
 *   3. User clicks the chip → scroll to bottom (lands at bottom, rule 1
 *      re-engages).
 *
 * `atBottom=false` from Virtuoso is *ignored* (it wobbles whenever content
 * height changes mid-stream); the only disable path is real user input on
 * the scroller — wheel-up or touch-drag-down.
 */

interface UseAgentSessionScrollOptions {
  hasMore?: boolean;
  /**
   * Resolves with the number of blocks that were prepended. The hook uses
   * this delta to decrement `firstItemIndex` synchronously. Implementations
   * that don't report a count may resolve with `void`.
   */
  onLoadOlder?: () => Promise<number | void>;
}

interface UseAgentSessionScrollResult {
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  firstItemIndex: number;
  handleAtBottomChange: (atBottom: boolean) => void;
  handleStartReached: () => void;
  autoScrollEnabled: boolean;
  /** `followOutput` and the imperative re-anchor read `.current` to decide whether to follow. */
  autoScrollEnabledRef: MutableRefObject<boolean>;
  /** Pass to `<AgentStream scrollerRef={...} />`. */
  handleScrollerRef: (el: HTMLElement | null | Window) => void;
  isLoadingOlder: boolean;
  scrollToBottom: () => void;
}

export function useAgentSessionScroll({
  hasMore,
  onLoadOlder,
}: UseAgentSessionScrollOptions): UseAgentSessionScrollResult {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const loadingOlderRef = useRef(false);
  const [autoScrollEnabled, setAutoScrollEnabledState] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [firstItemIndex, setFirstItemIndex] = useState(PREPEND_START_INDEX);
  const autoScrollEnabledRef = useRef(autoScrollEnabled);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  const touchStartYRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  const setAutoScrollEnabled = useCallback((enabled: boolean): void => {
    if (autoScrollEnabledRef.current === enabled) return;
    autoScrollEnabledRef.current = enabled;
    setAutoScrollEnabledState(enabled);
  }, []);

  const scrollToBottom = useCallback((): void => {
    setAutoScrollEnabled(true);
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      align: "end",
      behavior: "auto",
    });
  }, [setAutoScrollEnabled]);

  const handleAtBottomChange = useCallback(
    (atBottom: boolean): void => {
      if (atBottom) setAutoScrollEnabled(true);
    },
    [setAutoScrollEnabled],
  );

  // Stable handlers so add/removeEventListener pair correctly across
  // scroller swaps (callback ref may fire with a new element).
  const onWheel = useCallback(
    (e: WheelEvent): void => {
      if (e.deltaY < 0) setAutoScrollEnabled(false);
    },
    [setAutoScrollEnabled],
  );
  const onTouchStart = useCallback((e: TouchEvent): void => {
    touchStartYRef.current = e.touches[0]?.clientY ?? 0;
  }, []);
  const onTouchMove = useCallback(
    (e: TouchEvent): void => {
      const y = e.touches[0]?.clientY ?? 0;
      if (y > touchStartYRef.current + 5) setAutoScrollEnabled(false);
    },
    [setAutoScrollEnabled],
  );

  // Virtuoso's `scrollerRef` is a callback ref. Attach listeners inline so
  // the scroller doesn't need to live in component state (no extra render
  // on mount/unmount). Virtuoso's own `scrollToIndex` doesn't synthesize
  // wheel/touch events, so these listeners only fire on real user input.
  const handleScrollerRef = useCallback(
    (el: HTMLElement | null | Window): void => {
      const next = el instanceof HTMLElement ? el : null;
      const prev = scrollerElRef.current;
      if (prev === next) return;

      if (prev) {
        prev.removeEventListener("wheel", onWheel);
        prev.removeEventListener("touchstart", onTouchStart);
        prev.removeEventListener("touchmove", onTouchMove);
      }
      scrollerElRef.current = next;
      if (next) {
        next.addEventListener("wheel", onWheel, { passive: true });
        next.addEventListener("touchstart", onTouchStart, { passive: true });
        next.addEventListener("touchmove", onTouchMove, { passive: true });
      }
    },
    [onWheel, onTouchStart, onTouchMove],
  );

  // Detach on unmount in case Virtuoso never calls scrollerRef(null).
  useEffect(
    () => () => {
      const el = scrollerElRef.current;
      if (!el) return;
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      scrollerElRef.current = null;
    },
    [onWheel, onTouchStart, onTouchMove],
  );

  const handleStartReached = useCallback((): void => {
    if (!hasMore || !onLoadOlder || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setIsLoadingOlder(true);

    void onLoadOlder()
      .then((prepended) => {
        if (!isMountedRef.current) return;
        const delta = typeof prepended === "number" ? prepended : 0;
        if (delta > 0) setFirstItemIndex((idx) => idx - delta);
        loadingOlderRef.current = false;
        setIsLoadingOlder(false);
      })
      .catch(() => {
        if (!isMountedRef.current) return;
        loadingOlderRef.current = false;
        setIsLoadingOlder(false);
        toast.error("Failed to load older messages");
      });
  }, [hasMore, onLoadOlder]);

  return {
    virtuosoRef,
    firstItemIndex,
    handleAtBottomChange,
    handleStartReached,
    autoScrollEnabled,
    autoScrollEnabledRef,
    handleScrollerRef,
    isLoadingOlder,
    scrollToBottom,
  };
}
