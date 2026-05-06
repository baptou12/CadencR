/**
 * Global "is the user actively dragging a resize handle?" flag.
 *
 * Why this exists
 * ---------------
 * react-resizable-panels resizes panel children per pointer-move. Heavy
 * children (xterm, agent stream, CodeMirror, …) each register their own
 * `ResizeObserver` to react to layout changes — and those observers run a
 * batch per animation frame. During an active drag, the cumulative cost of
 * every observer firing per frame (xterm refit, scroll-bottom catch-up with
 * forced sync layout reads, virtualization remeasures, …) snowballs into
 * sub-30 fps drags, especially with multiple split panes visible.
 *
 * We can't disable the observers entirely — they're needed for normal
 * mount/grow/shrink flows. But during a *manual* resize drag, the user
 * doesn't want auto-scroll-to-bottom or a per-frame xterm refit; they want
 * the panel boundary to follow their pointer at 60+ fps. So observers
 * subscribe to this coordinator, skip work while a drag is in progress, and
 * run a single catch-up pass when the drag ends.
 *
 * Wiring
 * ------
 * - `pushResize()` is called from `<ResizableHandle>` on `pointerdown`. A
 *   matching `popResize()` runs on the global `pointerup` / `pointercancel`.
 *   Multiple concurrent drags (rare — only one pointer in practice) are
 *   safely refcounted.
 * - Heavy observers: `subscribeResize(cb)` to learn when the global state
 *   flips. Inside their RO callback, gate work with `isResizing()`.
 */

let activeCount = 0;
const listeners = new Set<(active: boolean) => void>();

function notify(active: boolean): void {
  for (const listener of listeners) listener(active);
}

export function pushResize(): void {
  activeCount += 1;
  if (activeCount === 1) notify(true);
}

export function popResize(): void {
  if (activeCount === 0) return;
  activeCount -= 1;
  if (activeCount === 0) notify(false);
}

export function isResizing(): boolean {
  return activeCount > 0;
}

export function subscribeResize(listener: (active: boolean) => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}
