import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeSelector } from "./ThemeSelector";
import { useLastScreenStore } from "@/stores/last-screen-store";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    themeId: "dracula",
    isLoading: false,
  }),
}));

describe("ThemeSelector", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    useLastScreenStore.setState({ lastScreen: null });
  });

  afterEach(() => {
    useLastScreenStore.setState({ lastScreen: null });
  });

  it("renders a Change theme trigger with the active theme name", () => {
    render(<ThemeSelector />);

    expect(screen.getByRole("button", { name: /change theme/i })).toBeInTheDocument();
    expect(screen.getByText(/dracula/i)).toBeInTheDocument();
  });

  it("navigates to the last screen with theme-selector=true on click", async () => {
    const user = userEvent.setup();
    useLastScreenStore.setState({
      lastScreen: { pathname: "/agents", search: {} },
    });

    render(<ThemeSelector />);
    await user.click(screen.getByRole("button", { name: /change theme/i }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/agents",
      search: { "theme-selector": true },
    });
  });

  it("preserves the last screen's search params so strict routes don't throw", async () => {
    const user = userEvent.setup();
    useLastScreenStore.setState({
      lastScreen: {
        pathname: "/ws-session/ws-feature-7",
        search: { cwd: "/Users/foo/proj", featureId: 7, projectId: 1 },
      },
    });

    render(<ThemeSelector />);
    await user.click(screen.getByRole("button", { name: /change theme/i }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/ws-session/ws-feature-7",
      search: {
        cwd: "/Users/foo/proj",
        featureId: 7,
        projectId: 1,
        "theme-selector": true,
      },
    });
  });

  it("falls back to the home route when no meaningful screen is recorded", async () => {
    const user = userEvent.setup();

    render(<ThemeSelector />);
    await user.click(screen.getByRole("button", { name: /change theme/i }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/",
      search: { "theme-selector": true },
    });
  });
});
