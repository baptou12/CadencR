import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYSTEM_DARK_THEME_ID,
  DEFAULT_SYSTEM_LIGHT_THEME_ID,
  isFollowSystemThemeEnabled,
  parseSystemAppearance,
  resolveActiveThemeId,
} from "./system";

describe("system theme resolution", () => {
  it("uses the manual theme when follow-system is disabled", () => {
    expect(
      resolveActiveThemeId({
        followSystem: false,
        manualTheme: "aurora",
        systemLightTheme: "dracula",
        systemDarkTheme: "dracula",
        systemAppearance: "dark",
      }),
    ).toBe("aurora");
  });

  it("uses the configured light theme when follow-system sees a light system theme", () => {
    expect(
      resolveActiveThemeId({
        followSystem: true,
        manualTheme: "dracula",
        systemLightTheme: "aurora",
        systemDarkTheme: "dracula",
        systemAppearance: "light",
      }),
    ).toBe("aurora");
  });

  it("uses the configured dark theme when follow-system sees a dark system theme", () => {
    expect(
      resolveActiveThemeId({
        followSystem: true,
        manualTheme: "aurora",
        systemLightTheme: "aurora",
        systemDarkTheme: "dracula",
        systemAppearance: "dark",
      }),
    ).toBe("dracula");
  });

  it("falls back to appearance-specific defaults for invalid synced theme ids", () => {
    expect(
      resolveActiveThemeId({
        followSystem: true,
        manualTheme: "aurora",
        systemLightTheme: "missing",
        systemDarkTheme: "missing",
        systemAppearance: "light",
      }),
    ).toBe(DEFAULT_SYSTEM_LIGHT_THEME_ID);

    expect(
      resolveActiveThemeId({
        followSystem: true,
        manualTheme: "aurora",
        systemLightTheme: "missing",
        systemDarkTheme: "missing",
        systemAppearance: "dark",
      }),
    ).toBe(DEFAULT_SYSTEM_DARK_THEME_ID);
  });

  it("parses persisted follow-system and system appearance values", () => {
    expect(isFollowSystemThemeEnabled("true")).toBe(true);
    expect(isFollowSystemThemeEnabled("false")).toBe(false);
    expect(isFollowSystemThemeEnabled(null)).toBe(false);
    expect(parseSystemAppearance("light")).toBe("light");
    expect(parseSystemAppearance("dark")).toBe("dark");
    expect(parseSystemAppearance(null)).toBe("dark");
  });
});
