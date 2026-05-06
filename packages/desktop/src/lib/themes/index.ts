export { applyThemeToDocument, readPersistedTheme, writePersistedThemeSettings } from "./apply";
export {
  DEFAULT_THEME_ID,
  THEMES,
  THEME_LIST,
  getTheme,
  isThemeId,
  parseThemeId,
} from "./registry";
export {
  DEFAULT_SYSTEM_APPEARANCE,
  DEFAULT_SYSTEM_DARK_THEME_ID,
  DEFAULT_SYSTEM_LIGHT_THEME_ID,
  SYSTEM_DARK_MEDIA_QUERY,
  THEME_FOLLOW_SYSTEM_SETTING_KEY,
  THEME_SETTING_KEY,
  THEME_SYSTEM_DARK_SETTING_KEY,
  THEME_SYSTEM_LIGHT_SETTING_KEY,
  isFollowSystemThemeEnabled,
  parseSystemAppearance,
  parseSystemDarkThemeId,
  parseSystemLightThemeId,
  readBrowserSystemAppearance,
  resolveActiveThemeId,
} from "./system";
export type {
  ThemeAppearance,
  ThemeDefinition,
  ThemeId,
  ThemeLogo,
  ThemeLogoVariant,
  XTermPalette,
} from "./types";
export { THEME_IDS } from "./types";
