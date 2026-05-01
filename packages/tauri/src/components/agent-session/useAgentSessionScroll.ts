import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import type { VirtuosoHandle } from "react-virtuoso";

/**
 * Initial value for `firstItemIndex`. Virtuoso uses item indices to track
 * scroll position; when older history is prepended we *decrement* this so
 * existing items keep their conceptual indices. Starting from a large value
 * gives plenty of headroom for prepends.
 */
const PREPEND_START_INDEX = 1_000_000;

interface UseAgentSessionScrollOptions {
  hasMore?: boolean;
  /**
   * Resolves with the number of blocks that were prepended. The hook uses
   * this delta to decrement `firstItemIndex` synchronously — no
   * `requestAnimationFrame` + ref dance needed. Implementations that don't
   * report a count (legacy callers) may resolve with `void`.
   */
  onLoadOlder?: () => Promise<number | void>;
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
  hasMore,
  onLoadOlder,
}: UseAgentSessionScrollOptions): UseAgentSessionScrollResult {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const loadingOlderRef = useRef(false);
  const [autoScrollEnabled, setAutoScrollEnabledState] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [firstItemIndex, setFirstItemIndex] = useState(PREPEND_START_INDEX);
  const autoScrollEnabledRef = useRef(autoScrollEnabled);
  const isMountedRef = useRef(true);

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
    isLoadingOlder,
    setAutoScrollEnabled,
  };
}
