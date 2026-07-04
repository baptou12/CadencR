import type { Terminal } from "@xterm/xterm";

/**
 * Make the terminal draggable by finger on touch devices. xterm 6 drives
 * scrolling through VS Code's `ScrollableElement` (not a native CSS overflow
 * scroller), and iOS never feeds that element a touch gesture — so a finger
 * drag did nothing. We translate the vertical touch delta into whole-row
 * scrolls via xterm's public `scrollLines()` API, which is the same path the
 * wheel uses, so the buffer and scrollbar stay in sync. `surface` is the outer
 * container (not `.xterm-viewport`, which is painted over and never sees the
 * touches). Returns a cleanup fn; inert on non-touch input since touch events
 * never fire there.
 */
export function attachTouchScroll(surface: HTMLElement, terminal: Terminal): () => void {
  let lastY = 0;
  // Sub-row pixels carried between moves so slow drags still scroll smoothly
  // instead of rounding every delta down to zero.
  let pixelRemainder = 0;
  // Row height in px, sampled once per drag at `touchstart`. Reading
  // `clientHeight` here (not on every `touchmove`) keeps a forced reflow off
  // the rapid-fire move path; the terminal can't resize mid-drag anyway.
  let rowHeight = 1;

  const onTouchStart = (e: TouchEvent): void => {
    if (e.touches.length !== 1) return;
    lastY = e.touches[0].clientY;
    pixelRemainder = 0;
    rowHeight = Math.max(1, surface.clientHeight / Math.max(1, terminal.rows));
  };

  const onTouchMove = (e: TouchEvent): void => {
    if (e.touches.length !== 1) return;
    const y = e.touches[0].clientY;
    pixelRemainder += y - lastY;
    lastY = y;
    const rows = Math.trunc(pixelRemainder / rowHeight);
    if (rows === 0) return;
    pixelRemainder -= rows * rowHeight;
    // Finger down (rows > 0) reveals older output, i.e. scroll up → negative.
    terminal.scrollLines(-rows);
    e.preventDefault();
  };

  surface.addEventListener("touchstart", onTouchStart, { passive: true });
  surface.addEventListener("touchmove", onTouchMove, { passive: false });
  return () => {
    surface.removeEventListener("touchstart", onTouchStart);
    surface.removeEventListener("touchmove", onTouchMove);
  };
}
