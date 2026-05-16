import { useEffect, useState } from "react";

export const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

function readInitial(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches;
}

/**
 * Subscribe to the OS-level `prefers-reduced-motion` media query.
 *
 * Mirrors the matchMedia pattern used by the theme system
 * (`packages/desktop/src/lib/themes/system.ts`). Returns `true` when the OS
 * is set to reduce motion — the animations provider treats this as the
 * fallback when the user hasn't explicitly opted in or out.
 */
export function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(readInitial);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCED_MOTION_MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    query.addEventListener("change", onChange);
    setReduced(query.matches);
    return (): void => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
