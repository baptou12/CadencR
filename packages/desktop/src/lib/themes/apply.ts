import { DEFAULT_THEME_ID, getTheme, parseThemeId } from "./registry";
import { injectThemeCssVars } from "./inject";
import { isThemePreviewActive, setThemePreviewFallback } from "./preview";
import type { ThemeId } from "./types";
import {
  isFollowSystemThemeEnabled,
  readBrowserSystemAppearance,
  resolveActiveThemeId,
} from "./system";

/**
 * Theme bootstrap helpers.
 *
 * The active theme is encoded as `<html data-theme="<id>">`. CSS variables and
 * Tailwind's semantic tokens key off this attribute, so changing it instantly
 * re-skins the entire UI (CodeMirror's theme rules, app chrome, etc.).
 *
 * Themes that carry their tokens as data (every user theme, plus the ported
 * first-party ones) additionally have those values injected as a CSS rule for
 * the same selector — see `inject.ts`.
 *
 * `data-appearance` mirrors the theme's light/dark classification so chrome
 * that can't rely on Tailwind's media-query `dark:` variant (e.g. mono logos)
 * can invert correctly for Cadencr themes.
 *
 * The xterm.js terminal is canvas-rendered and can't read CSS — it has its
 * own bridge in the terminal components that listens to the same setting.
 */

const STORAGE_KEY = "cadencr.theme";
const FOLLOW_SYSTEM_STORAGE_KEY = "cadencr.theme.followSystem";
const SYSTEM_LIGHT_STORAGE_KEY = "cadencr.theme.systemLight";
const SYSTEM_DARK_STORAGE_KEY = "cadencr.theme.systemDark";

/**
 * Sets the document's active theme attribute and injects the theme's token
 * values when it carries them as data. Idempotent.
 *
 * The injection happens *before* the attribute flips so the rule is already in
 * the stylesheet when the selector starts matching — otherwise a data-carried
 * theme would paint one frame with no tokens at all.
 */
export function applyThemeToDocument(themeId: ThemeId): void {
  if (typeof document === "undefined") return;
  // A user theme that was deleted, disabled or failed validation is not
  // applicable; resolving through `parseThemeId` (rather than setting an
  // attribute nothing styles) keeps a bad theme file from leaving the UI
  // unpainted.
  const theme = getTheme(parseThemeId(themeId));
  injectThemeCssVars(theme);
  // The theme studio paints from an unsaved draft, and every save it makes
  // lands here through the registry. Claiming the attribute back would blank
  // the preview between keystrokes, so defer to it and leave the selection for
  // it to restore on close.
  if (isThemePreviewActive()) {
    setThemePreviewFallback(theme.id, theme.appearance);
    return;
  }
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.dataset.appearance = theme.appearance;
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
    return resolveActiveThemeId({
      followSystem: isFollowSystemThemeEnabled(
        window.localStorage.getItem(FOLLOW_SYSTEM_STORAGE_KEY),
      ),
      manualTheme: window.localStorage.getItem(STORAGE_KEY),
      systemLightTheme: window.localStorage.getItem(SYSTEM_LIGHT_STORAGE_KEY),
      systemDarkTheme: window.localStorage.getItem(SYSTEM_DARK_STORAGE_KEY),
      systemAppearance: readCachedSystemAppearance(),
    });
  } catch {
    // localStorage may throw in some sandboxed environments. Fall back silently.
    return DEFAULT_THEME_ID;
  }
}

interface PersistedThemeSettings {
  followSystem: boolean;
  manualTheme: ThemeId;
  systemLightTheme: ThemeId;
  systemDarkTheme: ThemeId;
}

export function writePersistedThemeSettings(settings: PersistedThemeSettings): void {
  if (typeof window === "undefined") return;
  try {
    writeStorageValue(FOLLOW_SYSTEM_STORAGE_KEY, String(settings.followSystem));
    writeStorageValue(STORAGE_KEY, settings.manualTheme);
    writeStorageValue(SYSTEM_LIGHT_STORAGE_KEY, settings.systemLightTheme);
    writeStorageValue(SYSTEM_DARK_STORAGE_KEY, settings.systemDarkTheme);
  } catch {
    // Same: ignore localStorage failures.
  }
}

function writeStorageValue(key: string, value: string): void {
  if (window.localStorage.getItem(key) === value) return;
  window.localStorage.setItem(key, value);
}

function readCachedSystemAppearance(): "light" | "dark" {
  return readBrowserSystemAppearance();
}
