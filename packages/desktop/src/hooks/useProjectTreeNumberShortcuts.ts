import { useEffect, useRef, type RefObject } from "react";

const BADGE_SELECTOR = "[data-nav-shortcut-badge]";
const STALE_MODIFIER_HINT_MS = 1_000;

function shortcutIndex(event: KeyboardEvent): number | null {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (!/^[1-9]$/.test(event.key)) return null;
  return Number(event.key) - 1;
}

function isAppSwitcherShortcut(event: KeyboardEvent): boolean {
  return event.key === "Tab" && event.metaKey && !event.ctrlKey && !event.altKey;
}

function visibleNavItems(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>("[data-nav-item]"));
}

function setShortcutHints(container: HTMLElement | null, visible: boolean): void {
  if (!container) return;
  for (const badge of container.querySelectorAll<HTMLElement>(BADGE_SELECTOR)) {
    badge.textContent = "";
    badge.hidden = true;
  }
  if (!visible) return;

  visibleNavItems(container)
    .slice(0, 9)
    .forEach((item, index) => {
      const badge = item.querySelector<HTMLElement>(BADGE_SELECTOR);
      if (!badge) return;
      badge.textContent = String(index + 1);
      badge.hidden = false;
    });
}

export function useProjectTreeNumberShortcuts(
  treeRef: RefObject<HTMLElement | null>,
  enabled = true,
): void {
  const hintsVisibleRef = useRef(false);
  const staleHideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearStaleHideTimer = (): void => {
      if (staleHideTimerRef.current == null) return;
      window.clearTimeout(staleHideTimerRef.current);
      staleHideTimerRef.current = null;
    };

    const showHints = (): void => {
      if (hintsVisibleRef.current) return;
      setShortcutHints(treeRef.current, true);
      hintsVisibleRef.current = true;
    };

    const refreshHints = (): void => {
      if (!hintsVisibleRef.current) return;
      setShortcutHints(treeRef.current, true);
    };

    const hideHints = (): void => {
      clearStaleHideTimer();
      if (!hintsVisibleRef.current) return;
      setShortcutHints(treeRef.current, false);
      hintsVisibleRef.current = false;
    };

    const scheduleStaleHide = (): void => {
      clearStaleHideTimer();
      staleHideTimerRef.current = window.setTimeout(() => {
        staleHideTimerRef.current = null;
        hideHints();
      }, STALE_MODIFIER_HINT_MS);
    };

    if (!enabled) {
      hideHints();
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isAppSwitcherShortcut(event)) {
        hideHints();
        return;
      }

      const shouldShowHints = event.key === "Meta" || event.metaKey;
      if (shouldShowHints && !hintsVisibleRef.current) {
        showHints();
        scheduleStaleHide();
      }

      const index = shortcutIndex(event);
      if (index == null) return;

      const target = visibleNavItems(treeRef.current)[index];
      if (!target) return;

      event.preventDefault();
      target.click();
      requestAnimationFrame(refreshHints);
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (event.key === "Meta") hideHints();
    };

    const handleWindowFocusChange = (): void => hideHints();

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleWindowFocusChange);
    window.addEventListener("focus", handleWindowFocusChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleWindowFocusChange);
      window.removeEventListener("focus", handleWindowFocusChange);
      hideHints();
    };
  }, [enabled, treeRef]);
}
