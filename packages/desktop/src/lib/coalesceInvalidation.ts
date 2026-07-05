/**
 * Leading-edge + trailing-settle coalescer.
 *
 * A single shape reused wherever a burst of WebSocket pushes would otherwise
 * fan out into one query invalidation (and re-render wave) per event: settings
 * events (`settingsInvalidation.ts`), and editor `file_tree.changed` events
 * (`session-status-handlers.ts`). The per-feature git variant in
 * `ws-git-status-handler.ts` keeps its own copy because it also re-arms and
 * accumulates prefixes per key — this keyless factory is the simpler case.
 *
 * Semantics:
 *  - The first trigger after a quiet period runs immediately (leading edge) so
 *    a lone change is never delayed.
 *  - Triggers inside the settle window are collapsed: they push the trailing
 *    run out and, once the burst settles, fire it exactly once.
 *  - A single trigger produces only the leading run (no redundant trailing).
 *
 * The trailing run uses the argument from the most recent trigger, which is
 * what callers want (the latest client / latest state wins).
 */
export interface Coalescer<T> {
  /** Trigger a coalesced run: immediate on the leading edge, once on settle. */
  trigger: (arg: T) => void;
  /** Test-only: cancel any pending trailing timer and reset to idle. */
  reset: () => void;
}

export function createLeadingSettleCoalescer<T = void>(
  run: (arg: T) => void | Promise<void>,
  settleMs: number,
): Coalescer<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const trigger = (arg: T): void => {
    if (timer === null) {
      // Leading edge — run now and open the settle window.
      void run(arg);
      timer = setTimeout(() => {
        timer = null;
      }, settleMs);
      return;
    }
    // Inside the window — debounce a single trailing run.
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run(arg);
    }, settleMs);
  };

  const reset = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return { trigger, reset };
}
