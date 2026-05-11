import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AgentBlockData } from "../AgentBlock";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import { isResizing, subscribeResize } from "@/lib/resize-coordinator";

/**
 * Auto-scroll for the chat, in three rules:
 *
 *   1. At the bottom → auto-scroll, always.
 *   2. User scrolls up → stop auto-scrolling.
 *   3. User clicks the chip → scroll to bottom (rule 1 re-engages).
 *
 * Disengage triggers:
 *   - `wheel` / `touchmove` up — synchronous, before the browser updates
 *     `scrollTop`, so a streaming-token re-anchor in the same commit can't
 *     undo the user's scroll.
 *   - `scroll` events where `scrollTop` actually *decreased* (scrollbar
 *     drag up, PageUp, Home, keyboard ArrowUp). We compare against the
 *     previous `scrollTop` and only disengage when the user moved upward.
 *
 * We do NOT disengage just because `distanceFromBottom > threshold`: with
 * virtualization (Virtuoso `customScrollParent`), item measurement settles
 * asynchronously. A programmatic `scrollTop = scrollHeight` fires its scroll
 * event after Virtuoso has expanded the content, so the stale `scrollTop`
 * reads as "scrolled away" against the new `scrollHeight`. A direction-aware
 * check ignores those echoes because `scrollTop` only ever increased.
 *
 * Prepend-restore: when older history is loaded, we capture
 * `scrollHeight` / `scrollTop` synchronously *before* invoking the loader,
 * then in a layout effect — gated on the first block changing — restore via
 * `scrollTop = newScrollHeight - prevScrollHeight + prevScrollTop`. Standard
 * chat-app pattern; runs before paint, no flash.
 */

const STICK_THRESHOLD_PX = 16;
// After a conversation switch the new content lays out asynchronously
// (Virtuoso measures items lazily, markdown / code highlighting settles).
// `scrollHeight` can shrink relative to the previous conversation, the
// browser clamps `scrollTop` downward, and the direction-aware `onScroll`
// would otherwise misread that as the user scrolling up. The swap window
// suppresses that disengage and is re-armed on every layout shift, closing
// only after this many ms of stable layout.
const SWAP_SETTLE_MS = 400;

interface UseAgentSessionScrollOptions {
  /**
   * Conversation contents. The hook reads `length`, the last block's
   * `content.length`, and the first block's `id` to drive its layout-effect
   * deps. Pass the same array `<AgentStream>` renders so prepend-restore
   * sees the same `firstBlockId` change React does.
   */
  blocks: AgentBlockData[];
  /**
   * Identifier for the active conversation. When this changes, the hook
   * resets stick state to `true` and re-anchors to the bottom — the
   * `AgentSession` instance is reused across session switches, so without an
   * explicit reset, a "scrolled up" state from the previous conversation
   * would leak into the next one and the user would land mid-history.
   */
  conversationKey: string | null;
  hasMore?: boolean;
  /** Resolves with the number of prepended blocks (or `void`). */
  onLoadOlder?: () => Promise<number | void>;
}

type DivRef = (el: HTMLDivElement | null) => void;

interface UseAgentSessionScrollResult {
  scrollContainerRef: DivRef;
  topSentinelRef: DivRef;
  /**
   * Pass to `<AgentStream scrollContentRef={...} />`. A `ResizeObserver`
   * attached here re-anchors to the bottom whenever the content's height
   * changes — markdown rendering, syntax highlighting, image decoding etc.
   * settle asynchronously after first paint, and without this we land above
   * the bottom on the initial render of a long session.
   */
  scrollContentRef: DivRef;
  autoScrollEnabled: boolean;
  isLoadingOlder: boolean;
  scrollToBottom: () => void;
}

export function useAgentSessionScroll({
  blocks,
  conversationKey,
  hasMore,
  onLoadOlder,
}: UseAgentSessionScrollOptions): UseAgentSessionScrollResult {
  const blocksLength = blocks.length;
  const lastBlockContentLength = blocks[blocksLength - 1]?.content.length ?? 0;
  const firstBlockId = blocks[0]?.id ?? null;

  const scrollerElRef = useRef<HTMLDivElement | null>(null);
  const sentinelElRef = useRef<HTMLDivElement | null>(null);
  const contentElRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const contentObserverRef = useRef<ResizeObserver | null>(null);
  const stickRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const touchStartYRef = useRef(0);
  // Last `scrollTop` we saw on the scroller — used by `onScroll` to detect
  // an actual user-driven upward scroll vs. a programmatic re-anchor echo.
  const lastScrollTopRef = useRef(0);
  const pendingPrependRef = useRef<{ prevH: number; prevT: number } | null>(null);
  const prevFirstBlockIdRef = useRef<string | null>(firstBlockId);
  const prevConversationKeyRef = useRef<string | null>(conversationKey);
  // Open during a conversation-switch settle window — suppresses the
  // direction-aware `onScroll` disengage so a `scrollHeight` shrink in the
  // new conversation's async layout isn't misread as the user scrolling up.
  const swapInProgressRef = useRef(false);
  const [autoScrollEnabled, setAutoScrollEnabledState] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  // Latest-callbacks pattern so the IntersectionObserver doesn't need to be
  // re-created when `hasMore` / `onLoadOlder` change.
  const hasMoreRef = useRef(hasMore);
  const onLoadOlderRef = useRef(onLoadOlder);
  hasMoreRef.current = hasMore;
  onLoadOlderRef.current = onLoadOlder;

  const setAutoScrollEnabled = useCallback((enabled: boolean): void => {
    if (stickRef.current === enabled) return;
    stickRef.current = enabled;
    setAutoScrollEnabledState(enabled);
  }, []);

  const stickToBottom = useCallback((): void => {
    const el = scrollerElRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const scrollToBottom = useCallback((): void => {
    setAutoScrollEnabled(true);
    stickToBottom();
  }, [setAutoScrollEnabled, stickToBottom]);

  // Close the swap window once layout has been stable for `SWAP_SETTLE_MS`.
  // The debounced callback resets on every call, so every content-size change
  // during the swap pushes the close-out further. We don't pin to bottom on
  // close: while stick is engaged the content `ResizeObserver` already pins
  // on every shift, and a stable layout means we're already at the bottom.
  const closeSwapWindow = useDebouncedCallback((): void => {
    swapInProgressRef.current = false;
  }, SWAP_SETTLE_MS);

  // Conversation switch: the parent reuses this hook instance across
  // sessionId changes, so a "scrolled up" stick state would otherwise leak
  // into the next conversation. Reset to bottom + stick before the
  // bottom-anchor layout effect below runs in the same commit.
  useLayoutEffect(() => {
    if (prevConversationKeyRef.current === conversationKey) return;
    prevConversationKeyRef.current = conversationKey;
    pendingPrependRef.current = null;
    prevFirstBlockIdRef.current = firstBlockId;
    lastScrollTopRef.current = 0;
    stickRef.current = true;
    setAutoScrollEnabledState(true);
    swapInProgressRef.current = true;
    closeSwapWindow();
    const el = scrollerElRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversationKey, firstBlockId, closeSwapWindow]);

  useLayoutEffect(() => {
    const el = scrollerElRef.current;
    const prevId = prevFirstBlockIdRef.current;
    prevFirstBlockIdRef.current = firstBlockId;
    if (!el) return;

    const restore = pendingPrependRef.current;
    if (restore !== null && firstBlockId !== prevId) {
      pendingPrependRef.current = null;
      el.scrollTop = el.scrollHeight - restore.prevH + restore.prevT;
      return;
    }
    if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [blocksLength, lastBlockContentLength, firstBlockId]);

  // Catch up after a panel-resize drag ends. The RO callback skips work
  // while `isResizing()` is true (per the global rule in
  // `lib/resize-coordinator.ts`), so the moment the drag ends we run a
  // single re-anchor pass.
  useEffect(
    () =>
      subscribeResize((active) => {
        if (active || !stickRef.current || pendingPrependRef.current !== null) return;
        stickToBottom();
      }),
    [stickToBottom],
  );

  const onScroll = useCallback((): void => {
    const el = scrollerElRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const wentUp = el.scrollTop < lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
    if (distanceFromBottom < STICK_THRESHOLD_PX) {
      setAutoScrollEnabled(true);
      return;
    }
    // Disengage only on a genuine upward scroll (scrollbar drag, PageUp,
    // Home). Programmatic-anchor echoes only ever increase `scrollTop`, so
    // they fall through. During a conversation swap a `scrollHeight` shrink
    // can clamp `scrollTop` downward — `swapInProgressRef` suppresses the
    // disengage in that window; wheel / touchmove still react to real input.
    if (wentUp && !swapInProgressRef.current) setAutoScrollEnabled(false);
  }, [setAutoScrollEnabled]);
  const onWheel = useCallback(
    (e: WheelEvent): void => {
      if (e.deltaY >= 0) return;
      const el = scrollerElRef.current;
      // Only disengage stick when the viewport can actually scroll. Wheel-up
      // on an empty / short session would otherwise silently kill auto-scroll
      // before the conversation overflows.
      if (!el || el.scrollHeight <= el.clientHeight) return;
      setAutoScrollEnabled(false);
    },
    [setAutoScrollEnabled],
  );
  const onTouchStart = useCallback((e: TouchEvent): void => {
    touchStartYRef.current = e.touches[0]?.clientY ?? 0;
  }, []);
  const onTouchMove = useCallback(
    (e: TouchEvent): void => {
      const y = e.touches[0]?.clientY ?? 0;
      if (y <= touchStartYRef.current + 5) return;
      const el = scrollerElRef.current;
      if (!el || el.scrollHeight <= el.clientHeight) return;
      setAutoScrollEnabled(false);
    },
    [setAutoScrollEnabled],
  );

  const scrollContainerRef = useCallback<DivRef>(
    (el) => {
      const prev = scrollerElRef.current;
      if (prev === el) return;
      if (prev) {
        prev.removeEventListener("scroll", onScroll);
        prev.removeEventListener("wheel", onWheel);
        prev.removeEventListener("touchstart", onTouchStart);
        prev.removeEventListener("touchmove", onTouchMove);
      }
      scrollerElRef.current = el;
      if (el) {
        el.addEventListener("scroll", onScroll, { passive: true });
        el.addEventListener("wheel", onWheel, { passive: true });
        el.addEventListener("touchstart", onTouchStart, { passive: true });
        el.addEventListener("touchmove", onTouchMove, { passive: true });
      }
    },
    [onScroll, onWheel, onTouchStart, onTouchMove],
  );

  const scrollContentRef = useCallback<DivRef>(
    (el) => {
      if (contentElRef.current === el) return;
      contentObserverRef.current?.disconnect();
      contentObserverRef.current = null;
      contentElRef.current = el;
      if (!el || typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(() => {
        // Skip the per-frame re-anchor while a resize-handle drag is in
        // flight; the catch-up subscription above runs one pass on release.
        if (isResizing()) return;
        // While a conversation-switch swap is settling, every layout shift
        // pushes the close-out further so the window covers Virtuoso's
        // async measurement pass even if it spills past `SWAP_SETTLE_MS`.
        if (swapInProgressRef.current) closeSwapWindow();
        if (!stickRef.current || pendingPrependRef.current !== null) return;
        const scroller = scrollerElRef.current;
        if (!scroller) return;
        scroller.scrollTop = scroller.scrollHeight;
      });
      observer.observe(el);
      contentObserverRef.current = observer;
    },
    [closeSwapWindow],
  );

  const topSentinelRef = useCallback<DivRef>((el) => {
    if (sentinelElRef.current === el) return;
    observerRef.current?.disconnect();
    observerRef.current = null;
    sentinelElRef.current = el;
    if (!el) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (!hasMoreRef.current || !onLoadOlderRef.current || loadingOlderRef.current) continue;
          const scroller = scrollerElRef.current;
          if (!scroller) continue;
          // Capture geometry synchronously — the upcoming layout effect
          // restores the visible-content anchor via this delta.
          pendingPrependRef.current = {
            prevH: scroller.scrollHeight,
            prevT: scroller.scrollTop,
          };
          loadingOlderRef.current = true;
          setIsLoadingOlder(true);
          void onLoadOlderRef
            .current()
            .then(() => {
              loadingOlderRef.current = false;
              setIsLoadingOlder(false);
            })
            .catch(() => {
              pendingPrependRef.current = null;
              loadingOlderRef.current = false;
              setIsLoadingOlder(false);
              toast.error("Failed to load older messages");
            });
        }
      },
      { rootMargin: "200px 0px 0px 0px" },
    );
    observerRef.current.observe(el);
  }, []);

  return {
    scrollContainerRef,
    topSentinelRef,
    scrollContentRef,
    autoScrollEnabled,
    isLoadingOlder,
    scrollToBottom,
  };
}
