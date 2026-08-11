import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserTheme } from "@/api/generated";
import { useReleaseTheme } from "./useReleaseTheme";

const themeState = vi.hoisted(() => ({
  setTheme: vi.fn(),
  setSystemLightTheme: vi.fn(),
  setSystemDarkTheme: vi.fn(),
}));
const settings = vi.hoisted(() => ({ value: {} as Record<string, string> }));

vi.mock("@/hooks/useTheme", () => ({ useTheme: () => themeState }));
vi.mock("@/api/settings", () => ({
  useGetWorkspaceSettings: () => ({ data: [] }),
  settingsArrayToMap: () => settings.value,
}));

function theme(): UserTheme {
  return { id: "vamp" } as UserTheme;
}

beforeEach(() => {
  vi.clearAllMocks();
  settings.value = {};
});

describe("useReleaseTheme", () => {
  it("puts the app back on the default when the theme it was wearing goes", () => {
    settings.value = { theme_current: "user:vamp" };
    const { result } = renderHook(() => useReleaseTheme());

    result.current(theme());

    expect(themeState.setTheme).toHaveBeenCalledWith("cadencr-dark");
  });

  it("empties whichever system slots held it", () => {
    settings.value = { theme_system_light: "user:vamp", theme_system_dark: "user:vamp" };
    const { result } = renderHook(() => useReleaseTheme());

    result.current(theme());

    expect(themeState.setSystemLightTheme).toHaveBeenCalledWith("cadencr-light");
    expect(themeState.setSystemDarkTheme).toHaveBeenCalledWith("cadencr-dark");
    expect(themeState.setTheme).not.toHaveBeenCalled();
  });

  it("leaves selections that point somewhere else alone", () => {
    settings.value = { theme_current: "dracula", theme_system_dark: "user:other" };
    const { result } = renderHook(() => useReleaseTheme());

    result.current(theme());

    expect(themeState.setTheme).not.toHaveBeenCalled();
    expect(themeState.setSystemDarkTheme).not.toHaveBeenCalled();
  });
});
