import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { VirtuosoHandle, FollowOutputCallback } from "react-virtuoso";
import type { AgentBlockData } from "../AgentBlock";
import { subscribeResize } from "@/lib/resize-coordinator";

/**
 * Auto-scroll for the chat, in three rules:
 *
 *   1. At the bottom → auto-scroll, always.
 *   2. User scrolls up → stop auto-scrolling.
 *   3. User clicks the chip → scroll to bottom (rule 1 re-engages).
 *
 * Implementation note: with virtualization, `scrollerEl.scrollHeight` only
 * reflects items Virtuoso has already measured. Items below the rendered
 * window use an estimated height, and async sub-components (markdown
 * highlighting, BashBlock `useQuery`) re-measure later. A single
 * `scrollTop = scrollHeight` is therefore stale by the next paint and the
 * scroller lands mid-list. We delegate bottom-pinning to react-virtuoso's
 * measurement-aware APIs:
 *
 *   - `followOutput`: returns 'auto' while stick is engaged. Virtuoso re-runs
 *     it on every data change AND after async measurement settles, so the
 *     view stays pinned through markdown / code highlighting / query loads.
 *   - `atBottomStateChange`: Virtuoso's measurement-aware bottom detection.
 *     We use it to re-engage when the user lands at the bottom — we never
 *     disengage here, because async height settles must not flip stick off.
 *   - `scrollToIndex({ index: 'LAST', align: 'end' })`: the only correct way
 *     to programmatically reach the true last item; Virtuoso renders forward
 *     until it actually arrives. Used by the chip and conversation-switch.
 *
 * Disengage stays on synchronous user input (`wheel` / `touchmove` upward) so
 * a streaming-token re-anchor in the same commit can't undo the user's
 * scroll.
 */

interface UseAgentSessionScrollOptions {
  /**
   * Conversation contents. The hook reads `length` to detect the first
   * non-empty paint (so we can scroll to bottom once blocks arrive after
   * mount). Pass the same array `<AgentStream>` renders.
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

type ScrollRef = (el: HTMLElement | null) => void;

interface UseAgentSessionScrollResult {
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  scrollContainerRef: ScrollRef;
  onStartReached: () => void;
  followOutput: FollowOutputCallback;
  onAtBottomStateChange: (atBottom: boolean) => void;
  onTotalListHeightChanged: (height: number) => void;
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

  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  const stickRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const touchStartYRef = useRef(0);
  const prevConversationKeyRef = useRef<string | null>(conversationKey);
  // Tracks whether we've already fired the one-shot first-paint scroll. We
  // only need to bottom-pin via `scrollToIndex` once after blocks first
  // become non-empty; subsequent appends are handled by `followOutput`.
  const didFirstPaintScrollRef = useRef(false);
  const [autoScrollEnabled, setAutoScrollEnabledState] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  // Latest-callbacks pattern so the Virtuoso `startReached` handler stays
  // stable while reading current pagination state.
  const hasMoreRef = useRef(hasMore);
  const onLoadOlderRef = useRef(onLoadOlder);
  hasMoreRef.current = hasMore;
  onLoadOlderRef.current = onLoadOlder;

  const setAutoScrollEnabled = useCallback((enabled: boolean): void => {
    if (stickRef.current === enabled) return;
    stickRef.current = enabled;
    setAutoScrollEnabledState(enabled);
  }, []);

  const pinToEnd = useCallback((): void => {
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
  }, []);

  const scrollToBottom = useCallback((): void => {
    setAutoScrollEnabled(true);
    pinToEnd();
  }, [setAutoScrollEnabled, pinToEnd]);

  // Virtuoso re-evaluates `followOutput` whenever `data` changes AND after
  // async item measurement settles. Returning 'auto' while stick is engaged
  // keeps the view pinned across markdown highlighting, `useQuery` resolves,
  // and any other deferred-height updates.
  const followOutput = useCallback<FollowOutputCallback>(() => {
    return stickRef.current ? "auto" : false;
  }, []);

  // Measurement-aware re-engagement. We do NOT disengage here: Virtuoso also
  // calls this with `false` during transient measurement settles, and using
  // it for disengage would defeat the whole point of switching off raw
  // `scroll` events.
  const onAtBottomStateChange = useCallback(
    (atBottom: boolean): void => {
      if (atBottom) setAutoScrollEnabled(true);
    },
    [setAutoScrollEnabled],
  );

  // The "opens almost at the bottom" gap on cold-open comes from Virtuoso
  // re-measuring items after the first paint: markdown highlighting, code
  // blocks, and any block whose final height differs from
  // `defaultItemHeight={96}` shift the total list height after we've already
  // scrolled. `totalListHeightChanged` is Virtuoso's measurement-aware signal
  // — fired once per height delta after items remeasure — so re-pinning here
  // catches every settle step until the list stabilises. Gated on
  // `stickRef.current` so it never fights older-history prepend (stick is
  // off when the user is scrolled up).
  const onTotalListHeightChanged = useCallback((_height: number): void => {
    if (!stickRef.current) return;
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
  }, []);

  // Conversation switch: parent reuses this hook instance across sessionId
  // changes, so a "scrolled up" stick state would otherwise leak into the
  // next conversation. Reset to bottom + stick before any block-driven
  // re-anchor runs in the same commit. `scrollToIndex` is measurement-aware
  // — no manual `scrollTop` math, no swap-window timer needed.
  useLayoutEffect(() => {
    if (prevConversationKeyRef.current === conversationKey) return;
    prevConversationKeyRef.current = conversationKey;
    stickRef.current = true;
    setAutoScrollEnabledState(true);
    didFirstPaintScrollRef.current = false;
    pinToEnd();
  }, [conversationKey, pinToEnd]);

  // First-paint catch-up: when blocks arrive after mount (the common case for
  // opening an existing conversation), Virtuoso's `initialTopMostItemIndex`
  // is already past. Fire a single `scrollToIndex` on the first non-empty
  // paint so we land at the bottom; subsequent appends are owned by
  // `followOutput`.
  useEffect(() => {
    if (didFirstPaintScrollRef.current || blocksLength === 0) return;
    didFirstPaintScrollRef.current = true;
    if (!stickRef.current) return;
    pinToEnd();
  }, [blocksLength, pinToEnd]);

  // Catch up after a panel-resize drag ends. The RO callback skips work
  // while `isResizing()` is true (per the global rule in
  // `lib/resize-coordinator.ts`), so the moment the drag ends we run a
  // single re-anchor pass via Virtuoso so it accounts for measurement.
  useEffect(
    () =>
      subscribeResize((active) => {
        if (active || !stickRef.current) return;
        pinToEnd();
      }),
    [pinToEnd],
  );

  // Synchronous user-input disengage: `wheel` up / `touchmove` up fire
  // before the browser repaints, so a streaming-token re-anchor in the same
  // commit can't undo the user's scroll. We only disengage when the
  // viewport can actually scroll — wheel-up on a short session is idle
  // intent, not a request to leave the bottom.
  const onWheel = useCallback(
    (e: WheelEvent): void => {
      if (e.deltaY >= 0) return;
      const el = scrollerElRef.current;
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

  const scrollContainerRef = useCallback<ScrollRef>(
    (el) => {
      const prev = scrollerElRef.current;
      if (prev === el) return;
      if (prev) {
        prev.removeEventListener("wheel", onWheel);
        prev.removeEventListener("touchstart", onTouchStart);
        prev.removeEventListener("touchmove", onTouchMove);
      }
      scrollerElRef.current = el;
      if (el) {
        el.addEventListener("wheel", onWheel, { passive: true });
        el.addEventListener("touchstart", onTouchStart, { passive: true });
        el.addEventListener("touchmove", onTouchMove, { passive: true });
      }
    },
    [onWheel, onTouchStart, onTouchMove],
  );

  const onStartReached = useCallback((): void => {
    if (!hasMoreRef.current || !onLoadOlderRef.current || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setIsLoadingOlder(true);
    void onLoadOlderRef
      .current()
      .then(() => {
        loadingOlderRef.current = false;
        setIsLoadingOlder(false);
      })
      .catch(() => {
        loadingOlderRef.current = false;
        setIsLoadingOlder(false);
        toast.error("Failed to load older messages");
      });
  }, []);

  return {
    virtuosoRef,
    scrollContainerRef,
    onStartReached,
    followOutput,
    onAtBottomStateChange,
    onTotalListHeightChanged,
    autoScrollEnabled,
    isLoadingOlder,
    scrollToBottom,
  };
}
