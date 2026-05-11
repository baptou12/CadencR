import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a stable callback that defers invocation by `delayMs`. Subsequent
 * calls within the window reset the timer. The latest arguments win — useful
 * for "fire one prefetch after the mouse settles" patterns where a fast
 * cursor sweep across a list would otherwise issue dozens of requests.
 *
 * The returned function is stable across renders; the latest `callback`
 * reference is captured via ref so consumers don't have to memoize.
 */
export function useDebouncedCallback<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  delayMs: number,
): (...args: TArgs) => void {
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return useCallback(
    (...args: TArgs) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delayMs);
    },
    [delayMs],
  );
}
