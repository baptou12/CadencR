import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ID, THEME_LIST, getTheme, isThemeId, parseThemeId } from "./registry";

vi.mock("../../../assets/cadencr-mark-dark.svg", () => ({ default: "cadencr-mark-dark.svg" }));
vi.mock("../../../assets/cadencr-mark-light.svg", () => ({
  default: "cadencr-mark-light.svg",
}));

describe("theme registry", () => {
  it("ships the cadencr pair, dracula, aurora, one-dark, one-light, monokai, monokai-light, and the frost pair", () => {
    const ids = THEME_LIST.map((t) => t.id);
    expect(ids).toContain("cadencr-dark");
    expect(ids).toContain("cadencr-light");
    expect(ids).toContain("dracula");
    expect(ids).toContain("aurora");
    expect(ids).toContain("one-dark");
    expect(ids).toContain("one-light");
    expect(ids).toContain("monokai");
    expect(ids).toContain("monokai-light");
    expect(ids).toContain("frost-dark");
    expect(ids).toContain("frost-light");
    expect(ids).toContain("carbon-owl");
    expect(ids).toContain("paper-owl");
    expect(ids).toContain("catppuccin-mocha");
    expect(ids).toContain("catppuccin-latte");
  });

  it("gives every built-in somewhere to read its tokens from", () => {
    // Duplicating a built-in seeds the new theme from its token values, taken
    // either from `cssVars` or — for the themes still authored in CSS — by
    // briefly applying the theme and reading the computed properties. That read
    // can't tell "no rule matched" from "this theme shares the `:root` values",
    // since CadencR Dark *is* the `:root` block. So the guarantee it depends on
    // is asserted here: a built-in with neither would silently duplicate the
    // default palette under its name.
    const cssDir = join(process.cwd(), "src");
    const css = readdirSync(cssDir)
      .filter((name) => name.endsWith(".css"))
      .map((name) => readFileSync(join(cssDir, name), "utf8"))
      .join("\n");
    const unreadable = THEME_LIST.filter(
      (theme) => !theme.cssVars && !css.includes(`[data-theme="${theme.id}"]`),
    );
    expect(unreadable.map((theme) => theme.id)).toEqual([]);
  });

  it("isThemeId narrows to known ids", () => {
    expect(isThemeId("cadencr-dark")).toBe(true);
    expect(isThemeId("cadencr-light")).toBe(true);
    expect(isThemeId("dracula")).toBe(true);
    expect(isThemeId("aurora")).toBe(true);
    expect(isThemeId("one-dark")).toBe(true);
    expect(isThemeId("one-light")).toBe(true);
    expect(isThemeId("monokai")).toBe(true);
    expect(isThemeId("monokai-light")).toBe(true);
    expect(isThemeId("carbon-owl")).toBe(true);
    expect(isThemeId("paper-owl")).toBe(true);
    expect(isThemeId("catppuccin-mocha")).toBe(true);
    expect(isThemeId("catppuccin-latte")).toBe(true);
    expect(isThemeId("solarized")).toBe(false);
    expect(isThemeId(null)).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
    expect(isThemeId(42)).toBe(false);
  });

  it("parseThemeId falls back to default for unknown values", () => {
    expect(parseThemeId("aurora")).toBe("aurora");
    expect(parseThemeId("one-dark")).toBe("one-dark");
    expect(parseThemeId("nope")).toBe(DEFAULT_THEME_ID);
    expect(parseThemeId(null)).toBe(DEFAULT_THEME_ID);
  });

  it("defaults to CadencR Dark", () => {
    expect(DEFAULT_THEME_ID).toBe("cadencr-dark");
    expect(THEME_LIST[0]?.id).toBe("cadencr-dark");
    expect(THEME_LIST[1]?.id).toBe("cadencr-light");
  });

  it("ships the cadencr pair with brand colors and the Index Dots logo", () => {
    const dark = getTheme("cadencr-dark");
    expect(dark.label).toBe("CadencR Dark");
    expect(dark.appearance).toBe("dark");
    expect(dark.logo.variant).toBe("dark");
    expect(dark.logo.src).toContain("cadencr-mark-dark.svg");
    expect(dark.swatch.background).toBe("#131416");
    expect(dark.swatch.primary).toBe("#2db47d");
    expect(dark.xterm.background).toMatch(/^#[0-9a-fA-F]{6}$/);

    const light = getTheme("cadencr-light");
    expect(light.label).toBe("CadencR Light");
    expect(light.appearance).toBe("light");
    expect(light.logo.variant).toBe("light");
    expect(light.logo.src).toContain("cadencr-mark-light.svg");
    expect(light.swatch.background).toBe("#fafafb");
    expect(light.swatch.primary).toBe("#087653");
    expect(light.xterm.background).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("getTheme returns a definition with a label and xterm palette", () => {
    const aurora = getTheme("aurora");
    expect(aurora.label).toBe("Aurora");
    expect(aurora.appearance).toBe("light");
    expect(aurora.xterm.background).toMatch(/^#[0-9a-fA-F]{6}$/);

    const oneLight = getTheme("one-light");
    expect(oneLight.label).toBe("One Light");
    expect(oneLight.appearance).toBe("light");
    expect(oneLight.xterm.background).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("declares appearance and logo choices per theme", () => {
    const dracula = getTheme("dracula");
    const aurora = getTheme("aurora");
    const oneDark = getTheme("one-dark");
    const oneLight = getTheme("one-light");

    expect(dracula.appearance).toBe("dark");
    expect(dracula.logo.variant).toBe("dark");
    expect(dracula.logo.src).toContain("cadencr-mark-dark.svg");
    expect(dracula.logo.displayScale).toBeCloseTo(1.1);

    expect(aurora.appearance).toBe("light");
    expect(aurora.logo.variant).toBe("light");
    expect(aurora.logo.src).toContain("cadencr-mark-light.svg");
    expect(aurora.logo.displayScale).toBe(dracula.logo.displayScale);

    expect(oneDark.appearance).toBe("dark");
    expect(oneDark.logo.variant).toBe("dark");
    expect(oneLight.appearance).toBe("light");
    expect(oneLight.logo.variant).toBe("light");

    const monokai = getTheme("monokai");
    const monokaiLight = getTheme("monokai-light");
    expect(monokai.appearance).toBe("dark");
    expect(monokai.logo.variant).toBe("dark");
    expect(monokai.xterm.background).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(monokaiLight.appearance).toBe("light");
    expect(monokaiLight.logo.variant).toBe("light");
    expect(monokaiLight.xterm.background).toMatch(/^#[0-9a-fA-F]{6}$/);

    const frostDark = getTheme("frost-dark");
    const frostLight = getTheme("frost-light");
    expect(frostDark.appearance).toBe("dark");
    expect(frostDark.logo.variant).toBe("dark");
    expect(frostDark.xterm.background).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(frostLight.appearance).toBe("light");
    expect(frostLight.logo.variant).toBe("light");
    expect(frostLight.xterm.background).toMatch(/^#[0-9a-fA-F]{6}$/);

    const carbonOwl = getTheme("carbon-owl");
    const paperOwl = getTheme("paper-owl");
    expect(carbonOwl.appearance).toBe("dark");
    expect(carbonOwl.logo.variant).toBe("dark");
    expect(carbonOwl.xterm.background).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(paperOwl.appearance).toBe("light");
    expect(paperOwl.logo.variant).toBe("light");
    expect(paperOwl.xterm.background).toMatch(/^#[0-9a-fA-F]{6}$/);

    const catppuccinMocha = getTheme("catppuccin-mocha");
    const catppuccinLatte = getTheme("catppuccin-latte");
    expect(catppuccinMocha.label).toBe("Catppuccin Mocha");
    expect(catppuccinMocha.appearance).toBe("dark");
    expect(catppuccinMocha.logo.variant).toBe("dark");
    expect(catppuccinMocha.xterm.background).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(catppuccinLatte.label).toBe("Catppuccin Latte");
    expect(catppuccinLatte.appearance).toBe("light");
    expect(catppuccinLatte.logo.variant).toBe("light");
    expect(catppuccinLatte.xterm.background).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
