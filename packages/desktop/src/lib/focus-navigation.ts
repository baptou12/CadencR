/**
 * "Did this focus come from the user tabbing around?"
 *
 * `:focus-visible` can't answer that: Chromium also matches it for
 * programmatic `.focus()` when no pointer interaction preceded it, which is
 * exactly what a pane does when it restores focus to its active tab trigger on
 * mount. Hover-or-focus affordances (tooltips) would then pop open with the
 * cursor nowhere near them.
 *
 * So we watch for the keys that actually move focus. A shortcut like ⌘⇧G
 * deliberately does not count — the focus it causes is a side effect, not a
 * request to see the trigger's own tooltip.
 */
const FOCUS_NAVIGATION_KEYS = new Set([
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

/** Focus lands in the same task as the keydown; this is slack, not a wait. */
const NAVIGATION_WINDOW_MS = 300;

let lastNavigationAt = Number.NEGATIVE_INFINITY;

export function noteFocusNavigationKey(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (!FOCUS_NAVIGATION_KEYS.has(event.key)) return;
  // Shift only reverses Tab. `Shift+Arrow`/`Shift+Home` extend a text
  // selection, which moves the caret, not focus.
  if (event.shiftKey && event.key !== "Tab") return;
  lastNavigationAt = performance.now();
}

/**
 * True for the *first* focus that follows a focus-moving key, and consumed on
 * read: one keypress grants one focus its tooltip, so a later programmatic
 * focus inside the same window can't borrow the user's intent.
 */
export function focusFollowedKeyboardNavigation(): boolean {
  const followed = performance.now() - lastNavigationAt < NAVIGATION_WINDOW_MS;
  lastNavigationAt = Number.NEGATIVE_INFINITY;
  return followed;
}

if (typeof window !== "undefined") {
  window.addEventListener("keydown", noteFocusNavigationKey, { capture: true });
  // Vite re-executes this module on every hot update; without this the
  // listeners stack up for the rest of the dev session.
  import.meta.hot?.dispose(() => {
    window.removeEventListener("keydown", noteFocusNavigationKey, { capture: true });
  });
}
