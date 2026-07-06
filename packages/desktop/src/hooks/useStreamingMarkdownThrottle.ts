import { useEffect, useRef, useState } from "react";

/** Max re-parse cadence for the actively streaming markdown block. */
const STREAMING_REPARSE_MS = 100;

/**
 * Rate-limit how often the actively streaming markdown block re-parses.
 *
 * The streaming block's content grows on every coalesced delta batch, and
 * `ReactMarkdown` + `remark-gfm` re-parse the ENTIRE accumulated message each
 * time — O(length²) across a long stream. While `active`, this returns text
 * that advances at most every ~100ms (leading + trailing edge), so the parse
 * cost is bounded by a time cadence rather than the token rate. When not
 * streaming (or once it stops) the latest content passes through immediately so
 * the final message is never left truncated.
 */
export function useStreamingMarkdownThrottle(content: string, active: boolean): string {
  const [throttled, setThrottled] = useState(content);
  const latestRef = useRef(content);
  const lastEmitRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  latestRef.current = content;

  useEffect(() => {
    if (!active) {
      // Not (or no longer) streaming: show the latest content immediately.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setThrottled(content);
      return;
    }
    const wait = STREAMING_REPARSE_MS - (Date.now() - lastEmitRef.current);
    if (wait <= 0) {
      lastEmitRef.current = Date.now();
      setThrottled(content);
      return;
    }
    // Within the window: let the already-scheduled trailing update pick up the
    // latest content instead of scheduling a second timer.
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastEmitRef.current = Date.now();
      setThrottled(latestRef.current);
    }, wait);
  }, [content, active]);

  // Clear any pending timer on unmount.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return active ? throttled : content;
}
