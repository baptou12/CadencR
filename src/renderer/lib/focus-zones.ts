/**
 * Returns the closest (most specific) focus zone name for the currently active element.
 * Walks up the DOM tree from document.activeElement to find the nearest
 * data-focus-zone attribute, so nested zones are correctly resolved.
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
