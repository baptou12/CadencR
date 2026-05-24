import { beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_IDS } from "@/lib/themes";

const registerCustomTheme = vi.fn();

vi.mock("@pierre/diffs", () => ({
  registerCustomTheme: (...args: unknown[]) => registerCustomTheme(...args),
}));

describe("pierre-theme", () => {
  beforeEach(() => {
    vi.resetModules();
    registerCustomTheme.mockClear();
  });

  it("maps every ThemeId to a distinct Pierre theme name", async () => {
    const { getPierreThemeName } = await import("./pierre-theme");
    const names = THEME_IDS.map((id) => getPierreThemeName(id));

    // Every id resolves, no id silently falls back to another's name.
    expect(new Set(names).size).toBe(THEME_IDS.length);
    for (const name of names) {
      expect(name).toMatch(/^cadencr-.+-diff$/);
    }
  });

  it("registers one Pierre theme per ThemeId, only once", async () => {
    const { ensurePierreThemesRegistered, getPierreThemeName } = await import("./pierre-theme");

    ensurePierreThemesRegistered();
    ensurePierreThemesRegistered();

    expect(registerCustomTheme).toHaveBeenCalledTimes(THEME_IDS.length);
    const registeredNames = registerCustomTheme.mock.calls.map((call) => call[0]);
    for (const id of THEME_IDS) {
      expect(registeredNames).toContain(getPierreThemeName(id));
    }
  });

  it("each registered theme exposes editor + syntax token colors", async () => {
    const { ensurePierreThemesRegistered } = await import("./pierre-theme");
    ensurePierreThemesRegistered();

    for (const call of registerCustomTheme.mock.calls) {
      const loader = call[1] as () => Promise<{
        colors: Record<string, string>;
        tokenColors: Array<{ scope: string[]; settings: { foreground: string } }>;
      }>;
      const theme = await loader();
      expect(theme.colors["editor.background"]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.colors["editor.foreground"]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.tokenColors.length).toBeGreaterThan(0);
      for (const token of theme.tokenColors) {
        expect(token.settings.foreground).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});
