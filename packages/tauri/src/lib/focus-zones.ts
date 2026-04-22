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

const ZONE_ORDER = ["left-sidebar", "main-content", "terminal", "right-sidebar"] as const;

export function focusZoneByDirection(direction: "left" | "right"): void {
  const currentZone = getActiveFocusZone();
  const currentIndex = currentZone
    ? ZONE_ORDER.indexOf(currentZone as (typeof ZONE_ORDER)[number])
    : -1;
  const step = direction === "right" ? 1 : -1;
  for (let next = currentIndex + step; next >= 0 && next < ZONE_ORDER.length; next += step) {
    const nextEl = document.querySelector(
      `[data-focus-zone="${ZONE_ORDER[next]}"]`,
    ) as HTMLElement | null;
    if (nextEl) {
      nextEl.focus();
      if (ZONE_ORDER[next] === "main-content") {
        requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent("cadence:focus-prompt"));
        });
      }
      return;
    }
  }
}
