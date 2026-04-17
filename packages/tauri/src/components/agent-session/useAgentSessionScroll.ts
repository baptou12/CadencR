import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { AgentBlockData } from "../AgentBlock";

const AUTO_SCROLL_ATTACH_THRESHOLD = 64;
const AUTO_SCROLL_DETACH_THRESHOLD = 160;

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
  setAutoScrollEnabled: (enabled: boolean) => void;
}

function getDistanceFromBottom(el: HTMLDivElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
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
  const autoScrollEnabledRef = useRef(autoScrollEnabled);

  const scrollToBottom = useCallback((): void => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = getBottomScrollTop(el);
  }, []);

  const setAutoScrollEnabled = useCallback((enabled: boolean): void => {
    autoScrollEnabledRef.current = enabled;
    setAutoScrollEnabledState((current) => (current === enabled ? current : enabled));
    if (enabled) {
      scrollToBottom();
    }
  }, [scrollToBottom]);

  // Single scroll handler: autoscroll detection + load-older trigger.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = (): void => {
      const distanceFromBottom = getDistanceFromBottom(el);
      const isAtBottom = distanceFromBottom <= AUTO_SCROLL_ATTACH_THRESHOLD;

      if (isAtBottom) {
        setAutoScrollEnabled(true);
      } else if (autoScrollEnabledRef.current && distanceFromBottom > AUTO_SCROLL_DETACH_THRESHOLD) {
        setAutoScrollEnabled(false);
      }

      if (hasMore && onLoadOlder && !loadingOlderRef.current && el.scrollTop < 800) {
        loadingOlderRef.current = true;
        const prevHeight = el.scrollHeight;
        onLoadOlder().then(() => {
          requestAnimationFrame(() => {
            el.scrollTop += el.scrollHeight - prevHeight;
            loadingOlderRef.current = false;
          });
        }).catch(() => {
          loadingOlderRef.current = false;
        });
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    // If the content is too short to scroll, trigger load-older immediately.
    if (hasMore && onLoadOlder && !loadingOlderRef.current && el.scrollHeight <= el.clientHeight) {
      loadingOlderRef.current = true;
      onLoadOlder().finally(() => {
        requestAnimationFrame(() => { loadingOlderRef.current = false; });
      });
    }

    return () => el.removeEventListener("scroll", onScroll);
  }, [hasMore, isOpen, onLoadOlder, setAutoScrollEnabled]);

  // Scroll to bottom on new content when autoscroll is active.
  useLayoutEffect(() => {
    if (autoScrollEnabledRef.current) {
      scrollToBottom();
    }
  }, [blocks, scrollToBottom]);

  // Catch async content height changes (e.g. CodeMirror rendering after useEffect).
  useEffect(() => {
    const content = contentRef.current;
    const scrollEl = scrollContainerRef.current;
    if (!content || !scrollEl) return;

    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (autoScrollEnabledRef.current) {
          scrollEl.scrollTop = getBottomScrollTop(scrollEl);
        }
      });
    });
    ro.observe(content);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return { scrollContainerRef, contentRef, autoScrollEnabled, setAutoScrollEnabled };
}
