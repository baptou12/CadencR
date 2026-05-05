export { applyThemeToDocument, readPersistedTheme, writePersistedTheme } from "./apply";
export {
  DEFAULT_THEME_ID,
  THEMES,
  THEME_LIST,
  getTheme,
  isThemeId,
  parseThemeId,
} from "./registry";
export type {
  ThemeAppearance,
  ThemeDefinition,
  ThemeId,
  ThemeLogo,
  ThemeLogoVariant,
  XTermPalette,
} from "./types";
export { THEME_IDS } from "./types";
