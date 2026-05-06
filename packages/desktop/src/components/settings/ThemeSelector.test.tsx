import { render, screen, within } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeSelector } from "./ThemeSelector";
import { DEFAULT_SYSTEM_DARK_THEME_ID, DEFAULT_SYSTEM_LIGHT_THEME_ID } from "@/lib/themes";

const mockSetTheme = vi.fn();
const mockSetFollowSystemTheme = vi.fn();
const mockSetSystemLightTheme = vi.fn();
const mockSetSystemDarkTheme = vi.fn();

const mockThemeState = vi.hoisted(() => ({
  followSystemTheme: false,
}));

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    themeId: mockThemeState.followSystemTheme ? DEFAULT_SYSTEM_LIGHT_THEME_ID : "dracula",
    manualThemeId: "dracula",
    systemLightThemeId: DEFAULT_SYSTEM_LIGHT_THEME_ID,
    systemDarkThemeId: DEFAULT_SYSTEM_DARK_THEME_ID,
    followSystemTheme: mockThemeState.followSystemTheme,
    setTheme: mockSetTheme,
    setFollowSystemTheme: mockSetFollowSystemTheme,
    setSystemLightTheme: mockSetSystemLightTheme,
    setSystemDarkTheme: mockSetSystemDarkTheme,
    isLoading: false,
  }),
}));

describe("ThemeSelector", () => {
  beforeEach(() => {
    mockThemeState.followSystemTheme = false;
    mockSetTheme.mockClear();
    mockSetFollowSystemTheme.mockClear();
    mockSetSystemLightTheme.mockClear();
    mockSetSystemDarkTheme.mockClear();
  });

  it("shows one all-UI theme picker when follow-system is off", () => {
    render(<ThemeSelector />);

    expect(screen.getByRole("switch", { name: /follow system theme/i })).not.toBeChecked();
    expect(screen.getByText("All UI theme")).toBeInTheDocument();
    expect(screen.queryByText("Light system theme")).not.toBeInTheDocument();
    expect(screen.queryByText("Dark system theme")).not.toBeInTheDocument();
  });

  it("shows separate light and dark pickers when follow-system is on", () => {
    mockThemeState.followSystemTheme = true;

    render(<ThemeSelector />);

    expect(screen.getByRole("switch", { name: /follow system theme/i })).toBeChecked();
    expect(screen.getByText("Light system theme")).toBeInTheDocument();
    expect(screen.getByText("Dark system theme")).toBeInTheDocument();
    expect(screen.queryByText("All UI theme")).not.toBeInTheDocument();
  });

  it("allows any theme to be selected for either system appearance", () => {
    mockThemeState.followSystemTheme = true;

    render(<ThemeSelector />);

    const lightPicker = screen.getByRole("radiogroup", { name: "Light system theme" });
    const darkPicker = screen.getByRole("radiogroup", { name: "Dark system theme" });

    expect(within(lightPicker).getByRole("radio", { name: /dracula/i })).toBeInTheDocument();
    expect(within(lightPicker).getByRole("radio", { name: /aurora/i })).toBeInTheDocument();
    expect(within(darkPicker).getByRole("radio", { name: /dracula/i })).toBeInTheDocument();
    expect(within(darkPicker).getByRole("radio", { name: /aurora/i })).toBeInTheDocument();
  });

  it("persists the follow-system toggle through the theme hook", async () => {
    const user = userEvent.setup();

    render(<ThemeSelector />);

    await user.click(screen.getByRole("switch", { name: /follow system theme/i }));

    expect(mockSetFollowSystemTheme).toHaveBeenCalledWith(true);
  });
});
