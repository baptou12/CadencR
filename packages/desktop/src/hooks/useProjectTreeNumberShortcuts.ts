import { useEffect, useRef, type RefObject } from "react";

const BADGE_SELECTOR = "[data-nav-shortcut-badge]";

function shortcutIndex(event: KeyboardEvent): number | null {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (!/^[1-9]$/.test(event.key)) return null;
  return Number(event.key) - 1;
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

  useEffect(() => {
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
      if (!hintsVisibleRef.current) return;
      setShortcutHints(treeRef.current, false);
      hintsVisibleRef.current = false;
    };

    if (!enabled) {
      hideHints();
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.key === "Meta" || event.metaKey) && !hintsVisibleRef.current) {
        showHints();
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

    const handleBlur = (): void => hideHints();

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleBlur);
      hideHints();
    };
  }, [enabled, treeRef]);
}
