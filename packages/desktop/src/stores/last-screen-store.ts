import { create } from "zustand";

/**
 * Remembers the last "meaningful" screen the user was on so the theme
 * drawer's **Change theme** button (rendered inside `/settings`) can send
 * them back to where they were working. We only record screens where a live
 * theme preview is useful — the unified agent view and any session/feature
 * route. Settings, onboarding, and the home page are intentionally skipped.
 *
 * We persist both the resolved `pathname` and the `search` object because
 * some routes (notably `/ws-session/$sessionId`) require `cwd`, `featureId`,
 * and `projectId` search params and throw on navigation if they're missing.
 *
 * In-memory only by design: on first launch (or a hard reload) we fall back
 * to `/`, which is fine — the drawer is global and works there too.
 */
export interface LastScreen {
  pathname: string;
  search: Record<string, unknown>;
}

interface LastScreenState {
  lastScreen: LastScreen | null;
  setLastScreen: (screen: LastScreen) => void;
}

export const useLastScreenStore = create<LastScreenState>((set) => ({
  lastScreen: null,
  setLastScreen: (screen) => set({ lastScreen: screen }),
}));

/**
 * Path allow-list for screens where a theme preview is useful. Matches:
 *   - `/agents`                                     (unified agent view)
 *   - `/projects/:projectId/features/:featureId`    (feature editor)
 *   - `/ws-session/:sessionId`                      (live session)
 *
 * Kept here so the route-tracker effect in `__root.tsx` and any future
 * caller use the same rule.
 */
const MEANINGFUL_SCREEN_PATTERNS: readonly RegExp[] = [
  /^\/agents$/,
  /^\/projects\/\d+\/features\/\d+(?:\/.*)?$/,
  /^\/ws-session\/[^/]+(?:\/.*)?$/,
];

export function isMeaningfulScreenPath(pathname: string): boolean {
  return MEANINGFUL_SCREEN_PATTERNS.some((re) => re.test(pathname));
}
