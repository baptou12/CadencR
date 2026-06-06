import { useEffect } from "react";

// Keyboards are tall; URL-bar show/hide and safe-area jitter are short. This
// threshold cleanly separates "the on-screen keyboard is open" from that noise,
// so we only re-anchor the shell for a real keyboard.
const KEYBOARD_INSET_THRESHOLD = 120;

/**
 * Keeps the mobile app shell sized to the *visible* viewport while the
 * on-screen keyboard is open.
 *
 * The whole mobile layout flows from the `--app-vh` CSS variable (index.css),
 * set to `100dvh`/`100lvh`. Those units track the URL bar but NOT the keyboard,
 * so an input pinned to the bottom of the screen — the terminal prompt, most
 * visibly — ends up hidden behind the keyboard with no way to see what you type.
 *
 * `window.visualViewport.height` is the one measurement that shrinks when the
 * keyboard appears. When the gap between the layout viewport and the visual
 * viewport grows past a keyboard-sized threshold, we pin `--app-vh` to the
 * visible height (px) so the shell collapses to the area above the keyboard and
 * the focused input stays in view. The terminal's own ResizeObserver
 * (XTermInstance) refits the PTY to the smaller box, lifting the prompt clear.
 *
 * Below the threshold we drop the override so the CSS unit takes back over.
 * That fallback is deliberate: it never regresses the iOS standalone case,
 * where only `lvh` spans the full screen (see index.css).
 */
export function useVisualViewportHeight(enabled: boolean): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!enabled || !vv) return;

    const root = document.documentElement;
    // Only a viewport *resize* (the keyboard opening/closing) changes the height
    // we write — `visualViewport.scroll` never does — so we listen to `resize`
    // alone. The keyboard slide still fires many resize ticks at the same final
    // height, so cache the last write and skip redundant style mutations.
    let lastHeightPx: number | null = null;
    const sync = (): void => {
      const inset = window.innerHeight - vv.height - vv.offsetTop;
      const heightPx = inset > KEYBOARD_INSET_THRESHOLD ? Math.round(vv.height) : null;
      if (heightPx === lastHeightPx) return;
      lastHeightPx = heightPx;
      if (heightPx === null) root.style.removeProperty("--app-vh");
      else root.style.setProperty("--app-vh", `${heightPx}px`);
    };

    sync();
    vv.addEventListener("resize", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      root.style.removeProperty("--app-vh");
    };
  }, [enabled]);
}
