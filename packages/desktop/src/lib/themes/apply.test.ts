import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyThemeToDocument, readPersistedTheme, writePersistedThemeSettings } from "./apply";

describe("theme paint hint", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-appearance");
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it("sets data-theme and data-appearance on the document", () => {
    applyThemeToDocument("aurora");
    expect(document.documentElement.dataset.theme).toBe("aurora");
    expect(document.documentElement.dataset.appearance).toBe("light");

    applyThemeToDocument("dracula");
    expect(document.documentElement.dataset.theme).toBe("dracula");
    expect(document.documentElement.dataset.appearance).toBe("dark");
  });

  it("resolves the cached light system theme before React mounts", () => {
    writePersistedThemeSettings({
      followSystem: true,
      manualTheme: "dracula",
      systemLightTheme: "aurora",
      systemDarkTheme: "dracula",
    });

    expect(readPersistedTheme()).toBe("aurora");
  });

  it("resolves the cached dark system theme before React mounts", () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    writePersistedThemeSettings({
      followSystem: true,
      manualTheme: "aurora",
      systemLightTheme: "aurora",
      systemDarkTheme: "dracula",
    });

    expect(readPersistedTheme()).toBe("dracula");
  });
});
