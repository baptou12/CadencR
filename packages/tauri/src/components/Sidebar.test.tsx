import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import { Sidebar } from "./Sidebar";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: vi.fn(() => Promise.resolve()),
    toggleMaximize: vi.fn(() => Promise.resolve()),
  }),
}));

const mockNavigate = vi.fn();

let mockLocation: { pathname: string; search?: Record<string, unknown> } = {
  pathname: "/",
};

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouterState: () => ({
    location: mockLocation,
  }),
  Link: ({ children, to }: { children: unknown; to: string }) => {
    const React = require("react");
    return React.createElement("a", { href: to }, children);
  },
}));

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));

vi.mock("@/logo.svg", () => ({ default: "logo.svg" }));

vi.mock("../api/generated", () => ({
  useListProjects: vi.fn(() => ({
    data: [{ id: 1, name: "My Project", path: "/my-project" }],
  })),
  useCreateProject: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
  useDeleteProject: vi.fn(() => ({ mutate: vi.fn() })),
  getListProjectsQueryKey: vi.fn(() => ["projects"]),
  useListFeatures: vi.fn(() => ({ data: [] })),
  useCreateFeature: vi.fn(() => ({ mutate: vi.fn() })),
  useDeleteFeature: vi.fn(() => ({ mutate: vi.fn() })),
  useUpdateFeatureStatus: vi.fn(() => ({ mutate: vi.fn() })),
  getListFeaturesQueryKey: vi.fn((id: number) => ["features", "list", id]),
  getGetFeatureQueryKey: (id: number) => ["features", "detail", id],
  getGetFeaturePrdQueryKey: (id: number) => ["features", "prd", id],
  getGetFeaturePlanQueryKey: (id: number) => ["features", "plan", id],
  getGetFeaturePlanProgressQueryKey: (id: number) => ["features", "planProgress", id],
  getGetFeatureSettingsQueryKey: (id: number) => ["features", "settings", id],
  useGetFeatureEmpty: vi.fn(() => ({ data: { empty: false } })),
  useSetProjectSetting: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock("@/hooks/useProjectColor", () => ({
  ProjectColorDot: () => null,
}));

// Mock ProjectSettingsDialog
vi.mock("./ProjectSettingsDialog", () => ({
  ProjectSettingsDialog: () => null,
}));

// Mock UsageIndicator
vi.mock("./UsageIndicator", () => ({
  UsageIndicator: () => {
    const React = require("react");
    return React.createElement("div", { "data-testid": "usage-indicator" });
  },
}));

const mockSetCollapsed = vi.fn();

vi.mock("@/components/SidebarContext", () => ({
  useSidebarCollapsed: () => ({ collapsed: false, setCollapsed: mockSetCollapsed }),
}));

describe("Sidebar", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockSetCollapsed.mockClear();
    mockLocation = { pathname: "/" };
  });

  it("renders the app name", () => {
    render(<Sidebar />);
    expect(screen.getByText("Cadence")).toBeInTheDocument();
  });

  it("renders the logo", () => {
    render(<Sidebar />);
    expect(screen.getByAltText("Cadence")).toBeInTheDocument();
  });

  it("renders settings link", () => {
    render(<Sidebar />);
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders collapse sidebar button", () => {
    render(<Sidebar />);
    expect(screen.getByTitle("Collapse sidebar (⌘B)")).toBeInTheDocument();
  });

  it("calls setCollapsed when collapse button is clicked", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(screen.getByTitle("Collapse sidebar (⌘B)"));
    expect(mockSetCollapsed).toHaveBeenCalledWith(true);
  });

  it("renders ProjectTree with projects", () => {
    render(<Sidebar />);
    expect(screen.getByText("My Project")).toBeInTheDocument();
  });

  it("renders UsageIndicator", () => {
    render(<Sidebar />);
    expect(screen.getByTestId("usage-indicator")).toBeInTheDocument();
  });

  it("renders without crashing on any route", () => {
    render(<Sidebar />);
    expect(screen.getByText("Cadence")).toBeInTheDocument();
  });

  it("renders on ws-session route with search params", () => {
    mockLocation = {
      pathname: "/ws-session/abc123",
      search: { projectId: 1, featureId: 3 },
    };
    render(<Sidebar />);
    expect(screen.getByText("Cadence")).toBeInTheDocument();
  });
});
