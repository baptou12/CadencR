import { AURORA_THEME } from "./aurora";
import { DRACULA_THEME } from "./dracula";
import { THEME_IDS, type ThemeDefinition, type ThemeId } from "./types";

/** Display order in the settings picker. */
export const THEME_LIST: ThemeDefinition[] = [DRACULA_THEME, AURORA_THEME];

/** All themes shipped with Cadencr, keyed by id. */
export const THEMES: Record<ThemeId, ThemeDefinition> = {
  dracula: DRACULA_THEME,
  aurora: AURORA_THEME,
};

export const DEFAULT_THEME_ID: ThemeId = "dracula";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

export function parseThemeId(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME_ID;
}

export function getTheme(id: ThemeId): ThemeDefinition {
  return THEMES[id];
}
