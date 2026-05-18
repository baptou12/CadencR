import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * Holds the (navItem, badge) ref pairs for every sidebar row that opted in
 * via `useNavShortcutHint`. The provider runs the keyboard listeners and
 * toggles each registered badge directly through its ref — no DOM queries
 * are performed.
 *
 * Render order in the DOM is the activation order: pressing `⌘1` activates
 * the first registered nav item (after sorting by `compareDocumentPosition`),
 * `⌘2` the second, and so on, up to nine.
 */

const STALE_MODIFIER_HINT_MS = 1_000;

interface ShortcutHintRegistration {
  navRef: RefObject<HTMLElement | null>;
  badgeRef: RefObject<HTMLElement | null>;
}

interface ShortcutHintsApi {
  register(entry: ShortcutHintRegistration): () => void;
}

const ShortcutHintsContext = createContext<ShortcutHintsApi | null>(null);

function shortcutIndex(event: KeyboardEvent): number | null {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (!/^[1-9]$/.test(event.key)) return null;
  return Number(event.key) - 1;
}

function isAppSwitcherShortcut(event: KeyboardEvent): boolean {
  return event.key === "Tab" && event.metaKey && !event.ctrlKey && !event.altKey;
}

/** Order registered entries by their nav element's DOM position. */
function orderedEntries(
  entries: ReadonlySet<ShortcutHintRegistration>,
): ShortcutHintRegistration[] {
  const live: { entry: ShortcutHintRegistration; nav: HTMLElement }[] = [];
  for (const entry of entries) {
    const nav = entry.navRef.current;
    if (nav) live.push({ entry, nav });
  }
  live.sort((a, b) => {
    const cmp = a.nav.compareDocumentPosition(b.nav);
    if (cmp & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (cmp & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  return live.map(({ entry }) => entry);
}

function paintBadges(entries: ShortcutHintRegistration[], visible: boolean): void {
  // Reset every badge first. `data-visible="false"` drives opacity, so
  // the fade-out transition runs.
  for (const entry of entries) {
    const badge = entry.badgeRef.current;
    if (!badge) continue;
    badge.dataset.visible = "false";
    badge.textContent = "";
  }
  if (!visible) return;
  entries.slice(0, 9).forEach((entry, index) => {
    const badge = entry.badgeRef.current;
    if (!badge) return;
    badge.textContent = String(index + 1);
    badge.dataset.visible = "true";
  });
}

interface ShortcutHintsProviderProps {
  enabled: boolean;
  children: ReactNode;
}

/**
 * Mounts the keyboard listeners that show/hide the numeric shortcut hints
 * on every registered sidebar row. Children call `useNavShortcutHint()` to
 * register a (navItem, badge) ref pair.
 */
export function ShortcutHintsProvider({
  enabled,
  children,
}: ShortcutHintsProviderProps): ReactElement {
  const entriesRef = useRef<Set<ShortcutHintRegistration>>(new Set());
  const hintsVisibleRef = useRef(false);
  const staleHideTimerRef = useRef<number | null>(null);

  const api = useMemo<ShortcutHintsApi>(
    () => ({
      register(entry) {
        entriesRef.current.add(entry);
        return () => {
          entriesRef.current.delete(entry);
        };
      },
    }),
    [],
  );

  useEffect(() => {
    const clearStaleHideTimer = (): void => {
      if (staleHideTimerRef.current == null) return;
      window.clearTimeout(staleHideTimerRef.current);
      staleHideTimerRef.current = null;
    };

    const ordered = (): ShortcutHintRegistration[] => orderedEntries(entriesRef.current);

    const showHints = (): void => {
      if (hintsVisibleRef.current) return;
      paintBadges(ordered(), true);
      hintsVisibleRef.current = true;
    };

    const refreshHints = (): void => {
      if (!hintsVisibleRef.current) return;
      paintBadges(ordered(), true);
    };

    const hideHints = (): void => {
      clearStaleHideTimer();
      if (!hintsVisibleRef.current) return;
      paintBadges(ordered(), false);
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

      const target = ordered()[index]?.navRef.current;
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
  }, [enabled]);

  return <ShortcutHintsContext.Provider value={api}>{children}</ShortcutHintsContext.Provider>;
}

/**
 * Hook for a sidebar nav row that wants a numeric shortcut hint badge.
 * Returns refs to attach to (a) the clickable nav element and (b) the
 * `SidebarShortcutBadge` rendered inside it. Registration is automatic.
 *
 * The nav ref is generic so consumers can attach it to a `<div>`,
 * `<button>`, etc. without casting. The registry only ever reads
 * `HTMLElement` methods on it.
 */
export function useNavShortcutHint<TNav extends HTMLElement = HTMLElement>(): {
  navRef: RefObject<TNav | null>;
  badgeRef: RefObject<HTMLSpanElement | null>;
} {
  const api = useContext(ShortcutHintsContext);
  const navRef = useRef<TNav | null>(null);
  const badgeRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!api) return;
    return api.register({
      navRef: navRef as RefObject<HTMLElement | null>,
      badgeRef,
    });
  }, [api]);

  return { navRef, badgeRef };
}
