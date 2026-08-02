import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserTheme } from "@/api/generated";
import { createTestQueryClient } from "@/test-utils";
import { useOpenThemeProject } from "./useOpenThemeProject";

const navigate = vi.hoisted(() => vi.fn());
const workspace = vi.hoisted(() => vi.fn());
const themeState = vi.hoisted(() => ({
  followSystemTheme: false,
  setTheme: vi.fn(),
  setSystemLightTheme: vi.fn(),
  setSystemDarkTheme: vi.fn(),
}));
const systemAppearance = vi.hoisted(() => ({ value: "dark" as "light" | "dark" }));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/api/generated", () => ({ useThemeWorkspace: () => ({ mutateAsync: workspace }) }));
vi.mock("@/hooks/useTheme", () => ({ useTheme: () => themeState }));
vi.mock("@/hooks/useSystemAppearance", () => ({
  useSystemAppearance: () => ({ appearance: systemAppearance.value, error: null }),
}));

function theme(overrides: Partial<UserTheme> = {}): UserTheme {
  return {
    id: "vamp",
    path: "/themes/vamp/theme.json",
    content: "{}",
    label: "Vamp",
    theme: { label: "Vamp", appearance: "dark", cssVars: {}, xterm: {} },
    issues: [],
    ...overrides,
  } as UserTheme;
}

function renderOpen() {
  const client = createTestQueryClient();
  return renderHook(() => useOpenThemeProject(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  themeState.followSystemTheme = false;
  systemAppearance.value = "dark";
  workspace.mockResolvedValue({ project_id: 7, feature_id: 12, cwd: "/themes/vamp" });
});

describe("useOpenThemeProject", () => {
  it("goes to the theme's own project", async () => {
    const { result } = renderOpen();
    result.current.open(theme());

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith({
      to: "/projects/$projectId/features/$featureId",
      params: { projectId: "7", featureId: "12" },
    });
  });

  it("puts the theme on, so editing it is visible everywhere", async () => {
    const { result } = renderOpen();
    result.current.open(theme());

    await waitFor(() => expect(themeState.setTheme).toHaveBeenCalledWith("user:vamp"));
  });

  it("fills the matching system slot when the user follows their system", async () => {
    themeState.followSystemTheme = true;
    const { result } = renderOpen();
    result.current.open(theme());

    await waitFor(() => expect(themeState.setSystemDarkTheme).toHaveBeenCalledWith("user:vamp"));
    expect(themeState.setTheme).not.toHaveBeenCalled();
    expect(themeState.setSystemLightTheme).not.toHaveBeenCalled();
  });

  it("opens a broken theme without trying to wear it", async () => {
    const { result } = renderOpen();
    result.current.open(theme({ theme: null, issues: [{ token: null, message: "bad" }] }));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(themeState.setTheme).not.toHaveBeenCalled();
  });

  it("stays put when the project can't be opened", async () => {
    workspace.mockRejectedValue(new Error("nope"));
    const { result } = renderOpen();
    result.current.open(theme());

    await waitFor(() => expect(result.current.openingId).toBeNull());
    expect(navigate).not.toHaveBeenCalled();
    expect(themeState.setTheme).not.toHaveBeenCalled();
  });
});
