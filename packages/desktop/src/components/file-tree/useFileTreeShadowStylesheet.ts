import { useEffect, useRef } from "react";
import type { FileTree as FileTreeModel } from "@pierre/trees";

/**
 * Inject a `<style>` element into pierre's open shadow root and keep its
 * `textContent` in sync with `css`.
 *
 * Pierre attaches the host + shadow root inside a layout effect, so on the
 * first tick they may both be missing. We rAF-retry up to a bounded
 * number of frames; if pierre never produces a shadow root we surface a
 * `console.warn` rather than silently giving up.
 *
 * The element is mounted/unmounted on `[model, key]` so a tree remount
 * (or a key change) tears down the old stylesheet. `css` updates are
 * applied via a separate effect that only writes `textContent`, so
 * frequent updates (e.g. tab switches re-running an `activeFilePath`-
 * keyed selector) don't thrash the shadow DOM.
 *
 * `key` is the `data-*` attribute used to identify the stylesheet inside
 * the shadow root — pick a stable, namespaced name (e.g.
 * `"data-cadencr-active-file"`).
 */
export function useFileTreeShadowStylesheet(model: FileTreeModel, key: string, css: string): void {
  const elRef = useRef<HTMLStyleElement | null>(null);
  // Stash the latest `css` so the rAF-deferred attach can pick it up
  // even if `css` changed between scheduling the retry and the shadow
  // root becoming available.
  const cssRef = useRef(css);
  cssRef.current = css;

  // Lifecycle: attach the <style> element to the shadow root once
  // available, remove it on unmount. Does NOT depend on `css`.
  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let attempts = 0;
    const MAX_ATTEMPTS = 60;

    const attach = () => {
      if (cancelled) return;
      const shadowRoot = model.getFileTreeContainer()?.shadowRoot;
      if (!shadowRoot) {
        if (++attempts >= MAX_ATTEMPTS) {
          // eslint-disable-next-line no-console
          console.warn(
            `useFileTreeShadowStylesheet: gave up waiting for pierre shadow root (key="${key}")`,
          );
          return;
        }
        rafId = requestAnimationFrame(attach);
        return;
      }
      let el = shadowRoot.querySelector<HTMLStyleElement>(`style[${key}]`);
      if (el == null) {
        el = document.createElement("style");
        el.setAttribute(key, "");
        shadowRoot.appendChild(el);
      }
      el.textContent = cssRef.current;
      elRef.current = el;
    };

    attach();
    return () => {
      cancelled = true;
      if (rafId !== 0) cancelAnimationFrame(rafId);
      elRef.current?.remove();
      elRef.current = null;
    };
  }, [model, key]);

  // Push css updates without re-attaching. Falls through harmlessly if
  // attach is still pending — the rAF retry will pick up `cssRef.current`
  // when it eventually lands.
  useEffect(() => {
    if (elRef.current != null) {
      elRef.current.textContent = css;
    }
  }, [css]);
}
