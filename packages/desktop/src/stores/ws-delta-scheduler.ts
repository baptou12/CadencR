/**
 * Standalone flush scheduler for the stream-delta coalescer.
 *
 * Kept dependency-free (no store/handler imports) so tests can import
 * `setDeltaFlushScheduler` from here without dragging the whole session-handler
 * graph — importing that chain from a setup file loads `@/api/generated` before
 * a test's `vi.mock` can intercept it.
 */

/** Schedules a pending flush. Overridable so tests can flush synchronously. */
export type FlushScheduler = (flush: () => void) => void;

const defaultScheduler: FlushScheduler =
  typeof requestAnimationFrame === "function"
    ? (flush) => {
        requestAnimationFrame(flush);
      }
    : (flush) => {
        queueMicrotask(flush);
      };

let current: FlushScheduler = defaultScheduler;

/**
 * Override the flush scheduler. Tests install a synchronous scheduler (apply
 * immediately) or a manual one (capture the callback, fire it on demand to
 * assert one-commit-per-burst). Pass `null` to restore the rAF default.
 */
export function setDeltaFlushScheduler(scheduler: FlushScheduler | null): void {
  current = scheduler ?? defaultScheduler;
}

/** Run the current scheduler for a pending flush callback. */
export function scheduleDeltaFlush(flush: () => void): void {
  current(flush);
}
