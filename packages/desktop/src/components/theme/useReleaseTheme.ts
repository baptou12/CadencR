import { useCallback, useMemo } from "react";
import type { UserTheme } from "@/api/generated";
import { settingsArrayToMap, useGetWorkspaceSettings } from "@/api/settings";
import { useTheme } from "@/hooks/useTheme";
import {
  DEFAULT_SYSTEM_DARK_THEME_ID,
  DEFAULT_SYSTEM_LIGHT_THEME_ID,
  DEFAULT_THEME_ID,
  THEME_SETTING_KEY,
  THEME_SYSTEM_DARK_SETTING_KEY,
  THEME_SYSTEM_LIGHT_SETTING_KEY,
} from "@/lib/themes";
import { userThemeId } from "@/lib/themes/user-theme";

/**
 * Stop wearing a theme that is going away.
 *
 * Deleting or disabling a theme leaves the *selection* behind: the setting
 * still names a theme that can no longer be applied, so the app quietly paints
 * the default instead and nothing says why. Worse, the selection outlives the
 * theme — re-enabling it, or creating a theme that lands on the same id, would
 * put it back on by surprise. So the selection is retired with the theme.
 *
 * The stored values are read raw rather than through `useTheme`'s parsed ids:
 * by the time the theme list has refetched, an id pointing at a theme that no
 * longer exists already reads as the default, and there would be nothing left
 * to match on.
 */
export function useReleaseTheme(): (theme: UserTheme) => void {
  const { setTheme, setSystemLightTheme, setSystemDarkTheme } = useTheme();
  const workspaceSettings = useGetWorkspaceSettings();
  const settings = useMemo(
    () => settingsArrayToMap(workspaceSettings.data),
    [workspaceSettings.data],
  );

  return useCallback(
    (theme: UserTheme): void => {
      const id = userThemeId(theme.id);
      if (settings[THEME_SETTING_KEY] === id) setTheme(DEFAULT_THEME_ID);
      if (settings[THEME_SYSTEM_LIGHT_SETTING_KEY] === id) {
        setSystemLightTheme(DEFAULT_SYSTEM_LIGHT_THEME_ID);
      }
      if (settings[THEME_SYSTEM_DARK_SETTING_KEY] === id) {
        setSystemDarkTheme(DEFAULT_SYSTEM_DARK_THEME_ID);
      }
    },
    [settings, setTheme, setSystemLightTheme, setSystemDarkTheme],
  );
}
