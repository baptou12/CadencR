import { useEffect, useLayoutEffect, useRef } from "react";
import type { AgentBlockData } from "../AgentBlock";

interface UseAgentSessionScrollOptions {
  isOpen: boolean;
  blocks: AgentBlockData[];
  promptBarFocused: boolean;
  hasMore?: boolean;
  onLoadOlder?: () => Promise<void>;
}

export function useAgentSessionScroll({
  isOpen,
  blocks,
  promptBarFocused,
  hasMore,
  onLoadOlder,
}: UseAgentSessionScrollOptions) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const loadingOlderRef = useRef(false);

  // Single scroll handler: autoscroll detection + load-older trigger.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      autoScrollRef.current = atBottom;

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
  }, [isOpen, hasMore, onLoadOlder]);

  // Re-enable autoscroll when prompt bar is focused.
  useEffect(() => {
    if (promptBarFocused) {
      autoScrollRef.current = true;
      const el = scrollContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [promptBarFocused]);

  // Scroll to bottom on new content when autoscroll is active.
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (autoScrollRef.current && el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [blocks]);

  return { scrollContainerRef };
}
