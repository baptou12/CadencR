/**
 * Returns the closest (most specific) focus zone name for the currently active element.
 * Walks up the DOM tree from document.activeElement to find the nearest
 * data-focus-zone attribute, so nested zones are correctly resolved.
 *
 * `data-focus-zone` is still used to gate keyboard handlers in a few places
 * (e.g. agent letter-focus only fires in main-content; sidebar shortcuts
 * fire only in left-sidebar). The previous app-wide CMD+ALT+arrow cycle
 * between zones — and the visible focus ring that travelled with it — has
 * been removed, but this lookup helper stays because it's still needed for
 * those scope checks.
 */
export function getActiveFocusZone(): string | null {
  let el = document.activeElement as HTMLElement | null;
  while (el) {
    const zone = el.getAttribute("data-focus-zone");
    if (zone) return zone;
    el = el.parentElement;
  }
  return null;
}
