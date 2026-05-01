import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import type { VirtuosoHandle } from "react-virtuoso";
import type { AgentBlockData } from "../AgentBlock";

/**
 * Initial value for `firstItemIndex`. Virtuoso uses item indices to track
 * scroll position; when older history is prepended we *decrement* this so
 * existing items keep their conceptual indices. Starting from a large value
 * gives plenty of headroom for prepends.
 */
const PREPEND_START_INDEX = 1_000_000;

interface UseAgentSessionScrollOptions {
  blocks: AgentBlockData[];
  hasMore?: boolean;
  onLoadOlder?: () => Promise<void>;
}

interface UseAgentSessionScrollResult {
  /** Pass to `<AgentStream virtuosoRef={...} />`. Used by `scrollToBottom` to scroll to the bottom imperatively. */
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  /** Pass to `<AgentStream firstItemIndex={...} />`. Decrements when older items are prepended so the user's scroll position is preserved. */
  firstItemIndex: number;
  /**
   * Pass to `<AgentStream onAtBottomChange={...} />`. The auto-scroll state
   * is just a mirror of Virtuoso's "at bottom" — no extra book-keeping.
   */
  handleAtBottomChange: (atBottom: boolean) => void;
  /** Pass to `<AgentStream onStartReached={...} />`. Triggers older-history loading when the user scrolls near the top. */
  handleStartReached: () => void;
  /** True when we're at the bottom and Virtuoso is following new output. */
  autoScrollEnabled: boolean;
  isLoadingOlder: boolean;
  /**
   * Wire to the auto-scroll chip's onClick. Scrolls the list to the last
   * item; the resulting `atBottomStateChange(true)` flips `autoScrollEnabled`
   * back on. This is the only way to re-enable follow-mode from the UI.
   */
  scrollToBottom: () => void;
}

export function useAgentSessionScroll({
  blocks,
  hasMore,
  onLoadOlder,
}: UseAgentSessionScrollOptions): UseAgentSessionScrollResult {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const loadingOlderRef = useRef(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [firstItemIndex, setFirstItemIndex] = useState(PREPEND_START_INDEX);
  const blocksLengthRef = useRef(blocks.length);
  const isMountedRef = useRef(true);

  useLayoutEffect(() => {
    blocksLengthRef.current = blocks.length;
  }, [blocks.length]);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  const scrollToBottom = useCallback((): void => {
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      align: "end",
      behavior: "auto",
    });
  }, []);

  const handleStartReached = useCallback((): void => {
    if (!hasMore || !onLoadOlder || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setIsLoadingOlder(true);
    const before = blocksLengthRef.current;

    void onLoadOlder()
      .then(() => {
        if (!isMountedRef.current) return;
        // Wait one frame so React commits the new blocks prop and our
        // `blocksLengthRef` (updated via useLayoutEffect) reflects the
        // appended count.
        requestAnimationFrame(() => {
          if (!isMountedRef.current) return;
          const delta = blocksLengthRef.current - before;
          if (delta > 0) {
            setFirstItemIndex((idx) => idx - delta);
          }
          loadingOlderRef.current = false;
          setIsLoadingOlder(false);
        });
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
    // The auto-scroll state *is* `atBottom` — the handler is just the setter.
    handleAtBottomChange: setAutoScrollEnabled,
    handleStartReached,
    autoScrollEnabled,
    isLoadingOlder,
    scrollToBottom,
  };
}
