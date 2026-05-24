import { useEffect, type RefObject } from "react";

import { activateFeatureTab } from "@/stores/feature-layout-store";

/**
 * The documented `pane-agent` shortcut (⌘⇧A) is supposed to focus the
 * Agent tab. When focus is inside the file tree, pierre's own keydown
 * handler in its shadow root swallows the chord (its select-all path
 * matches Mod+A regardless of Shift), so the `useShortcut("pane-agent")`
 * listener at the document never fires.
 *
 * Intercept on the wrapper in CAPTURE phase — that runs before the event
 * enters pierre's shadow tree — and dispatch the same action the global
 * shortcut would have. Scoped to keydown originating from inside the
 * file tree only, so the chord still behaves normally everywhere else.
 */
export function useFileTreeAgentShortcut(
  containerRef: RefObject<HTMLElement | null>,
  featureId: number,
): void {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "a" && e.key !== "A") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (!e.shiftKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      activateFeatureTab(featureId, "agent");
    };
    el.addEventListener("keydown", handler, true);
    return () => el.removeEventListener("keydown", handler, true);
  }, [containerRef, featureId]);
}
