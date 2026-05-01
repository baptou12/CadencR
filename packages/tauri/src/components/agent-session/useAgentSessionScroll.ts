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
  /** Pass to `<AgentStream virtuosoRef={...} />`. Used by `setAutoScrollEnabled` to scroll to the bottom imperatively. */
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  /** Pass to `<AgentStream firstItemIndex={...} />`. Decrements when older items are prepended so the user's scroll position is preserved. */
  firstItemIndex: number;
  /** Pass to `<AgentStream onAtBottomChange={...} />`. Tracks the auto-scroll state based on Virtuoso's bottom detection. */
  handleAtBottomChange: (atBottom: boolean) => void;
  /** Pass to `<AgentStream onStartReached={...} />`. Triggers older-history loading when the user scrolls near the top. */
  handleStartReached: () => void;
  autoScrollEnabled: boolean;
  isLoadingOlder: boolean;
  setAutoScrollEnabled: (enabled: boolean) => void;
}

export function useAgentSessionScroll({
  blocks,
  hasMore,
  onLoadOlder,
}: UseAgentSessionScrollOptions): UseAgentSessionScrollResult {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const loadingOlderRef = useRef(false);
  const [autoScrollEnabled, setAutoScrollEnabledState] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [firstItemIndex, setFirstItemIndex] = useState(PREPEND_START_INDEX);
  const autoScrollEnabledRef = useRef(autoScrollEnabled);
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

  const setAutoScrollEnabled = useCallback((enabled: boolean): void => {
    autoScrollEnabledRef.current = enabled;
    setAutoScrollEnabledState((current) => (current === enabled ? current : enabled));
    if (enabled) {
      virtuosoRef.current?.scrollToIndex({
        index: "LAST",
        align: "end",
        behavior: "auto",
      });
    }
  }, []);

  const handleAtBottomChange = useCallback(
    (atBottom: boolean): void => {
      if (atBottom) {
        if (!autoScrollEnabledRef.current) setAutoScrollEnabled(true);
      } else if (autoScrollEnabledRef.current) {
        setAutoScrollEnabled(false);
      }
    },
    [setAutoScrollEnabled],
  );

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
    handleAtBottomChange,
    handleStartReached,
    autoScrollEnabled,
    isLoadingOlder,
    setAutoScrollEnabled,
  };
}
