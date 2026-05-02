import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID, THEME_LIST, getTheme, isThemeId, parseThemeId } from "./registry";

describe("theme registry", () => {
  it("ships at least dracula and aurora", () => {
    const ids = THEME_LIST.map((t) => t.id);
    expect(ids).toContain("dracula");
    expect(ids).toContain("aurora");
  });

  it("isThemeId narrows to known ids", () => {
    expect(isThemeId("dracula")).toBe(true);
    expect(isThemeId("aurora")).toBe(true);
    expect(isThemeId("solarized")).toBe(false);
    expect(isThemeId(null)).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
    expect(isThemeId(42)).toBe(false);
  });

  it("parseThemeId falls back to default for unknown values", () => {
    expect(parseThemeId("aurora")).toBe("aurora");
    expect(parseThemeId("nope")).toBe(DEFAULT_THEME_ID);
    expect(parseThemeId(null)).toBe(DEFAULT_THEME_ID);
  });

  it("getTheme returns a definition with a label and xterm palette", () => {
    const aurora = getTheme("aurora");
    expect(aurora.label).toBe("Aurora");
    expect(aurora.appearance).toBe("light");
    expect(aurora.xterm.background).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
