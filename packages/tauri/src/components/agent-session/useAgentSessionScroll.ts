import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { isResizing, subscribeResize } from "@/lib/resize-coordinator";
import type { AgentBlockData } from "../AgentBlock";

const BOTTOM_EPSILON = 1;
const LOAD_OLDER_THRESHOLD = 800;

interface UseAgentSessionScrollOptions {
  isOpen: boolean;
  blocks: AgentBlockData[];
  hasMore?: boolean;
  onLoadOlder?: () => Promise<void>;
}

interface UseAgentSessionScrollResult {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  autoScrollEnabled: boolean;
  isLoadingOlder: boolean;
  setAutoScrollEnabled: (enabled: boolean) => void;
}

function getBottomScrollTop(el: HTMLDivElement): number {
  return Math.max(0, el.scrollHeight - el.clientHeight);
}

export function useAgentSessionScroll({
  isOpen,
  blocks,
  hasMore,
  onLoadOlder,
}: UseAgentSessionScrollOptions): UseAgentSessionScrollResult {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const loadingOlderRef = useRef(false);
  const [autoScrollEnabled, setAutoScrollEnabledState] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const autoScrollEnabledRef = useRef(autoScrollEnabled);
  const programmaticScrollTopRef = useRef<number | null>(null);
  const previousScrollTopRef = useRef(0);
  const isMountedRef = useRef(true);

  const setOlderLoading = useCallback((loading: boolean): void => {
    if (!isMountedRef.current) return;
    setIsLoadingOlder(loading);
  }, []);

  const loadOlderIfNeeded = useCallback(
    (reason: "scroll" | "bootstrap"): void => {
      const el = scrollContainerRef.current;
      if (!el || !hasMore || !onLoadOlder || loadingOlderRef.current) {
        return;
      }
      if (reason === "scroll" && el.scrollTop >= LOAD_OLDER_THRESHOLD) return;
      if (reason === "bootstrap" && el.scrollHeight > el.clientHeight) return;

      loadingOlderRef.current = true;
      setOlderLoading(true);
      const prevHeight = el.scrollHeight;

      void onLoadOlder()
        .then(() => {
          requestAnimationFrame(() => {
            if (!isMountedRef.current) return;
            el.scrollTop += el.scrollHeight - prevHeight;
            previousScrollTopRef.current = el.scrollTop;
            loadingOlderRef.current = false;
            setOlderLoading(false);
          });
        })
        .catch(() => {
          loadingOlderRef.current = false;
          setOlderLoading(false);
          toast.error("Failed to load older messages");
        });
    },
    [hasMore, onLoadOlder, setOlderLoading],
  );

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  const scrollToBottom = useCallback((): void => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const bottomScrollTop = getBottomScrollTop(el);
    programmaticScrollTopRef.current = bottomScrollTop;
    el.scrollTop = bottomScrollTop;
    previousScrollTopRef.current = el.scrollTop;
  }, []);

  const setAutoScrollEnabled = useCallback(
    (enabled: boolean): void => {
      autoScrollEnabledRef.current = enabled;
      setAutoScrollEnabledState((current) => (current === enabled ? current : enabled));
      if (enabled) {
        scrollToBottom();
      }
    },
    [scrollToBottom],
  );

  // Single scroll handler: autoscroll detection + load-older trigger.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    previousScrollTopRef.current = el.scrollTop;

    const onScroll = (): void => {
      const scrollTop = el.scrollTop;
      const distanceFromBottom = el.scrollHeight - scrollTop - el.clientHeight;
      const atBottom = distanceFromBottom <= BOTTOM_EPSILON;

      if (
        programmaticScrollTopRef.current !== null &&
        Math.abs(scrollTop - programmaticScrollTopRef.current) <= BOTTOM_EPSILON
      ) {
        programmaticScrollTopRef.current = null;
        previousScrollTopRef.current = scrollTop;
        return;
      }

      programmaticScrollTopRef.current = null;

      if (atBottom) {
        setAutoScrollEnabled(true);
      } else if (autoScrollEnabledRef.current && scrollTop < previousScrollTopRef.current) {
        setAutoScrollEnabled(false);
      }

      previousScrollTopRef.current = scrollTop;

      loadOlderIfNeeded("scroll");
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    loadOlderIfNeeded("bootstrap");

    return () => el.removeEventListener("scroll", onScroll);
  }, [isOpen, loadOlderIfNeeded, setAutoScrollEnabled]);

  // Scroll to bottom on new content when autoscroll is active.
  useLayoutEffect(() => {
    if (autoScrollEnabledRef.current) {
      scrollToBottom();
    }
  }, [blocks, scrollToBottom]);

  // Catch async content height changes (e.g. CodeMirror rendering after useEffect).
  //
  // During an active resize drag we *skip* this work entirely. The callback
  // does forced-sync-layout reads (`scrollHeight`, `clientHeight`) and a
  // `scrollTop` write; running it per frame across 4 split panes was the
  // dominant bottleneck behind the choppy resize. We listen for
  // resize-end via `subscribeResize` and run a single catch-up when the
  // user releases the handle.
  useEffect(() => {
    const content = contentRef.current;
    const scrollEl = scrollContainerRef.current;
    if (!content || !scrollEl) return;

    let raf = 0;
    const flush = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (autoScrollEnabledRef.current) {
          scrollEl.scrollTop = getBottomScrollTop(scrollEl);
        }
        loadOlderIfNeeded("bootstrap");
      });
    };
    const ro = new ResizeObserver(() => {
      if (isResizing()) return;
      flush();
    });
    ro.observe(content);
    const unsubscribe = subscribeResize((active) => {
      if (!active) flush();
    });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsubscribe();
    };
  }, [loadOlderIfNeeded]);

  return {
    scrollContainerRef,
    contentRef,
    autoScrollEnabled,
    isLoadingOlder,
    setAutoScrollEnabled,
  };
}
