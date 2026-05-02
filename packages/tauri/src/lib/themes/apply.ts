import { DEFAULT_THEME_ID, parseThemeId } from "./registry";
import type { ThemeId } from "./types";

/**
 * Theme bootstrap helpers.
 *
 * The active theme is encoded as `<html data-theme="<id>">`. CSS variables and
 * Tailwind's semantic tokens key off this attribute, so changing it instantly
 * re-skins the entire UI (CodeMirror's theme rules, app chrome, etc.).
 *
 * The xterm.js terminal is canvas-rendered and can't read CSS — it has its
 * own bridge in the terminal components that listens to the same setting.
 */

const STORAGE_KEY = "cadencr.theme";

/** Sets the document's active theme attribute. Idempotent. */
export function applyThemeToDocument(themeId: ThemeId): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = themeId;
}

/**
 * Read the cached theme id from localStorage. Used pre-paint in main.tsx to
 * apply the user's last-known theme synchronously, before React mounts and
 * before the workspace settings round-trip resolves. Server-side persisted
 * setting remains the source of truth — this cache is a paint hint only.
 */
export function readPersistedTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME_ID;
  try {
    return parseThemeId(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // localStorage may throw in some sandboxed environments. Fall back silently.
    return DEFAULT_THEME_ID;
  }
}

/** Update the localStorage paint hint. Called by `useThemeSync` after the
 *  server-confirmed value changes. */
export function writePersistedTheme(themeId: ThemeId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, themeId);
  } catch {
    // Same: ignore localStorage failures.
  }
}
