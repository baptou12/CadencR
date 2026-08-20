import { type ComponentType, type ReactNode, useCallback, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@/test-utils";
import { useSidebarCollapsed } from "@/components/SidebarContext";

/**
 * Guards the 0.11.3 regression where `Cmd+B` faded the sidebar out but left its
 * panel reserving the width. Mounts the real `ui/resizable` — the mock in
 * `__root.test.tsx` cannot show it — and toggles through `SidebarContext`.
 */
const mocks = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  createRootRoute: (opts: { component: unknown }) => ({ options: opts }),
  Outlet: () => {
    const { collapsed, setCollapsed } = useSidebarCollapsed();
    return (
      <button type="button" data-testid="toggle" onClick={() => setCollapsed(!collapsed)}>
        toggle
      </button>
    );
  },
  useNavigate: () => mocks.mockNavigate,
  useRouterState: () => ({ location: { pathname: "/" } }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@tanstack/react-hotkeys", () => ({ useHotkeys: vi.fn() }));

vi.mock("@/hooks/useDebouncedSetting", () => ({
  useDebouncedSetting: (key: string) => {
    const [value, setStored] = useState<string | null>(key === "sidebar_left_width" ? "256" : null);
    const setValue = useCallback((next: string) => setStored(next), []);
    return { value, setValue, isLoading: false, isSaving: false };
  },
  useDebouncedSettingFromMap: () => ({ value: "256", setValue: vi.fn(), isLoading: false }),
}));

vi.mock("@/api/settings", () => ({
  useGetWorkspaceSettings: vi.fn(() => ({ data: [], isLoading: false })),
  settingsArrayToMap: vi.fn(() => ({})),
  getWorkspaceSettingsQueryKey: () => ["workspace", "settings"] as const,
}));

vi.mock("@/components/Sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar">Sidebar</div>,
}));

vi.mock("@/components/CommandPalette", () => ({ CommandPalette: () => null }));

import { Route } from "./__root";

const GROUP_WIDTH = 800;
const GROUP_HEIGHT = 600;

function RootLayout() {
  const Component = (Route as unknown as { options: { component: ComponentType } }).options
    .component;
  return <Component />;
}

function sidebarPanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>("#sidebar");
  if (!panel) throw new Error("sidebar panel not rendered");
  return panel;
}

describe("global sidebar collapse", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hands the sidebar's width back to the main panel and takes it back", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, GROUP_WIDTH, GROUP_HEIGHT),
    );
    render(<RootLayout />);
    const expandedGrow = sidebarPanel().style.flexGrow;
    expect(Number(expandedGrow)).toBeGreaterThan(0);

    act(() => screen.getByTestId("toggle").click());
    expect(sidebarPanel().style.flexGrow).toBe("0");

    act(() => screen.getByTestId("toggle").click());
    expect(sidebarPanel().style.flexGrow).toBe(expandedGrow);
  });
});
