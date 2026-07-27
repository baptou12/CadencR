import { useEffect, useState } from "react";

/** Below this, a wait is not a wait — it is a flicker. */
const DEFAULT_DELAY_MS = 400;

/**
 * Reports a pending value only once it has lasted long enough to be worth
 * showing, and drops it the moment it changes or resolves.
 *
 * Everything here runs against a local backend, so most "async" operations
 * settle inside a frame or two. A spinner shown for that long never reads as
 * progress — it reads as the thing under it glitching, which is worse than no
 * feedback at all. Delaying the indicator is not hiding the wait: an operation
 * that genuinely takes time still announces itself, at the point where the user
 * has started to wonder.
 *
 * Deliberately not `useDebouncedValue` plus a guard, though it is nearly that:
 * that hook seeds its state with the value it is first given, so a caller that
 * mounts with work already in flight would show the indicator instantly — the
 * one case this exists to prevent. Here nothing is ever shown that has not sat
 * out the full delay under this hook's own eye.
 */
export function useDelayedPending<T>(value: T | null, delayMs = DEFAULT_DELAY_MS): T | null {
  const [shown, setShown] = useState<T | null>(null);

  useEffect(() => {
    // Asymmetric on purpose: the delay applies to appearing, never to
    // disappearing. Clearing here rather than only on resolve is what keeps a
    // switch mid-flight from stranding the old indicator — it used to stay up
    // for another full delay, pointing at work that had already moved on.
    setShown(null);
    if (value == null) return;
    const timer = setTimeout(() => setShown(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);

  return shown;
}
