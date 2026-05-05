import { useEffect, useMemo } from "react";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import {
  applyThemeToDocument,
  DEFAULT_THEME_ID,
  getTheme,
  parseThemeId,
  writePersistedTheme,
  type ThemeDefinition,
  type ThemeId,
} from "@/lib/themes";

const THEME_SETTING_KEY = "theme_current";

interface UseThemeResult {
  themeId: ThemeId;
  theme: ThemeDefinition;
  setTheme: (next: ThemeId) => void;
  isLoading: boolean;
}

/**
 * Subscribe to the active theme. Persistence reuses the same
 * `/api/workspace/settings` plumbing every other setting goes through.
 *
 * Canvas-rendered xterm can't read CSS variables, so terminals receive the
 * palette as a JS object via `theme.xterm`. The rest of the UI follows
 * automatically because `useThemeSync` keeps `<html data-theme="…">` in
 * sync with this hook.
 */
export function useTheme(): UseThemeResult {
  const setting = useDebouncedSetting(THEME_SETTING_KEY);
  const themeId = parseThemeId(setting.value ?? DEFAULT_THEME_ID);
  const theme = getTheme(themeId);

  return useMemo(
    () => ({
      themeId,
      theme,
      setTheme: setting.setValue,
      isLoading: setting.isLoading,
    }),
    [themeId, theme, setting.setValue, setting.isLoading],
  );
}

/**
 * Side-effect-only hook: keeps `<html data-theme="…">` and the localStorage
 * paint hint in sync with the active theme. Mount once near the route root.
 *
 * `applyThemeToDocument` is idempotent and `parseThemeId` always resolves to
 * a valid id (default before the server answers), so the effect is safe to
 * run before `isLoading` flips — and not gating on it avoids the silent
 * "cache never refreshed" failure mode if the workspace fetch errors out.
 */
export function useThemeSync(): void {
  const { themeId } = useTheme();
  useEffect(() => {
    applyThemeToDocument(themeId);
    writePersistedTheme(themeId);
  }, [themeId]);
}
