import { useSyncExternalStore } from "react";

/**
 * Phone-sized viewport breakpoint. We intentionally treat anything at or below
 * the Tailwind `md` floor (768px) as "mobile" — tablets/iPad are explicitly out
 * of scope, so a single phone breakpoint is all the UI branches on.
 */
const MOBILE_QUERY = "(max-width: 767px)";

// One shared MediaQueryList for every consumer — `getSnapshot` runs on each
// render, so allocating a fresh `matchMedia` per call would be needless churn.
const mql = window.matchMedia(MOBILE_QUERY);

function subscribe(onChange: () => void): () => void {
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return mql.matches;
}

/**
 * `true` when the viewport is phone-sized. Drives mobile-only layout decisions
 * (drawer sidebar, single tab strip, hidden unified-agents view). SSR-safe via
 * a constant server snapshot — the renderer is client-only so this never flips.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
