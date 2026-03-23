import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import React from "react";

const mocks = vi.hoisted(() => {
  const mockNavigate = vi.fn();
  const mockStopAllMutation = vi.fn(() => ({ mutate: vi.fn() }));
  const mockCreateFeatureMutation = vi.fn(() => ({ mutate: vi.fn(), isLoading: false }));
  const mockCreateSessionMutation = vi.fn(() => ({ mutate: vi.fn(), isLoading: false }));
  const mockDeleteFeatureMutation = vi.fn(() => ({ mutate: vi.fn() }));
  const mockUpdateStatusMutation = vi.fn(() => ({ mutate: vi.fn() }));
  return {
    mockNavigate,
    mockStopAllMutation,
    mockCreateFeatureMutation,
    mockCreateSessionMutation,
    mockDeleteFeatureMutation,
    mockUpdateStatusMutation,
  };
});

vi.mock("@tanstack/react-router", () => ({
  createRootRoute: (opts: { component: unknown }) => ({ options: opts }),
  Outlet: () => <div data-testid="outlet">outlet content</div>,
  useNavigate: () => mocks.mockNavigate,
  useRouterState: () => ({
    location: { pathname: "/" },
  }),
  Link: ({ children, to }: { children: unknown; to: string }) => {
    const React = require("react");
    return React.createElement("a", { href: to }, children);
  },
}));

vi.mock("react-hotkeys-hook", () => ({ useHotkeys: vi.fn() }));
vi.mock("@/hooks/useDebouncedSetting", () => ({
  useDebouncedSetting: vi.fn(() => ({ value: "256", setValue: vi.fn() })),
}));

vi.mock("@/components/Sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar">Sidebar</div>,
}));

vi.mock("@/components/CommandPalette", () => ({
  CommandPalette: ({ open }: { open: boolean }) =>
    open ? <div data-testid="command-palette">CommandPalette</div> : null,
}));

vi.mock("@/components/FocusRing", () => ({
  FocusRing: () => <div data-testid="focus-ring" />,
}));

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="panel-group">{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="panel">{children}</div>
  ),
  ResizableHandle: () => <div data-testid="resize-handle" />,
}));

import { Route } from "./__root";

function RootLayout() {
  const Component = (Route as unknown as { options: { component: React.ComponentType } }).options?.component;
  if (!Component) return null;
  return <Component />;
}

describe("__root route (RootLayout)", () => {
  beforeEach(() => {
    mocks.mockNavigate.mockClear();
  });

  it("renders sidebar", () => {
    render(<RootLayout />);
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
  });

  it("renders outlet for main content", () => {
    render(<RootLayout />);
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });

  it("renders resizable panel group", () => {
    render(<RootLayout />);
    expect(screen.getByTestId("panel-group")).toBeInTheDocument();
  });
});
