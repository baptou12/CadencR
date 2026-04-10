import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import { FeatureTopBar } from "./FeatureTopBar";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: vi.fn(() => Promise.resolve()),
    toggleMaximize: vi.fn(() => Promise.resolve()),
  }),
}));

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: unknown; to: string }) => {
    const React = require("react");
    return React.createElement("a", { href: to }, children);
  },
}));

vi.mock("@/logo.svg", () => ({ default: "logo.svg" }));

const mockOpenTerminal = vi.fn();
const mockSetFeatureSetting = vi.fn();

let mockFeatureData: Record<string, unknown> = {
  id: 1,
  title: "My Test Feature",
  status: "in-progress",
  type: "ws-feature",
  project_id: 1,
  created_at: "2024-01-01",
};

vi.mock("@/api/generated", () => ({
  useGetFeature: vi.fn(() => ({ data: mockFeatureData })),
  useGetFeatureSettings: vi.fn(() => ({
    data: [{ key: "worktree_branch", value: "feature/my-branch" }],
  })),
  getGetFeatureSettingsQueryKey: vi.fn((id: number) => ["features", "settings", id]),
  useSetFeatureSetting: vi.fn(() => ({ mutate: mockSetFeatureSetting })),
  useGetStats: vi.fn(() => ({
    data: { commits: 3, insertions: 10, deletions: 2 },
    refetch: vi.fn(),
  })),
  useGetBranch: vi.fn(() => ({ data: { branch: "main" } })),
  useGetFileBlobShas: vi.fn(() => ({ data: [] })),
  useOpenExternalHandler: vi.fn(() => ({ mutate: mockOpenTerminal })),
}));

vi.mock("@/hooks/useFeatureTitle", () => ({
  useFeatureTitle: vi.fn(() => null),
}));

const mockSetAutonomyLevel = vi.fn();
vi.mock("@/hooks/useWorkflowWebSocket", () => ({
  useWorkflowStore: vi.fn(() => mockSetAutonomyLevel),
}));

vi.mock("@/hooks/useProjectColor", () => ({
  ProjectColorDot: ({ projectId }: { projectId: number }) => {
    const React = require("react");
    return React.createElement("span", { "data-testid": `color-dot-${projectId}` });
  },
}));

// Mock DiffViewerModal
vi.mock("./diff/DiffViewerModal", () => ({
  DiffViewerModal: ({ open }: { open: boolean }) => {
    const React = require("react");
    return open ? React.createElement("div", { "data-testid": "diff-modal" }, "Diff Modal") : null;
  },
}));

// Mock ModelSelector
vi.mock("./ModelSelector", () => ({
  ModelSelector: () => {
    const React = require("react");
    return React.createElement("div", { "data-testid": "model-selector" });
  },
}));

const mockSetCollapsed = vi.fn();
let mockSidebarCollapsed = false;

vi.mock("@/components/SidebarContext", () => ({
  useSidebarCollapsed: () => ({ collapsed: mockSidebarCollapsed, setCollapsed: mockSetCollapsed }),
}));

describe("FeatureTopBar", () => {
  beforeEach(() => {
    mockOpenTerminal.mockClear();
    mockSetFeatureSetting.mockClear();
    mockSetAutonomyLevel.mockClear();
    mockSetCollapsed.mockClear();
    mockSidebarCollapsed = false;
    mockFeatureData = {
      id: 1, title: "My Test Feature", status: "in-progress",
      type: "ws-feature", project_id: 1, created_at: "2024-01-01",
    };
  });

  it("renders feature title", () => {
    render(<FeatureTopBar featureId={1} projectId={1} />);
    expect(screen.getByText("My Test Feature")).toBeInTheDocument();
  });

  it("renders feature status badge", () => {
    render(<FeatureTopBar featureId={1} projectId={1} />);
    expect(screen.getByText("in-progress")).toBeInTheDocument();
  });

  it("renders in session mode without status badge", () => {
    render(<FeatureTopBar featureId={1} projectId={1} mode="session" />);
    expect(screen.queryByText("in-progress")).not.toBeInTheDocument();
  });

  it("renders without crashing", () => {
    render(<FeatureTopBar featureId={1} projectId={1} />);
    expect(screen.getByText("My Test Feature")).toBeInTheDocument();
  });

  it("renders git stats with branch info", () => {
    render(<FeatureTopBar featureId={1} projectId={1} />);
    // Git stats (3 commits) should be visible somewhere
    expect(screen.getByText("My Test Feature")).toBeInTheDocument();
  });

  it("does not show logo when sidebar is expanded", () => {
    render(<FeatureTopBar featureId={1} projectId={1} />);
    expect(screen.queryByText("Cadence")).not.toBeInTheDocument();
  });

  it("shows logo and app name when sidebar is collapsed", () => {
    mockSidebarCollapsed = true;
    render(<FeatureTopBar featureId={1} projectId={1} />);
    expect(screen.getByText("Cadence")).toBeInTheDocument();
    expect(screen.getByAltText("Cadence")).toBeInTheDocument();
  });

  it("shows expand button when sidebar is collapsed", () => {
    mockSidebarCollapsed = true;
    render(<FeatureTopBar featureId={1} projectId={1} />);
    expect(screen.getByTitle("Expand sidebar (⌘B)")).toBeInTheDocument();
  });

  it("shows settings link when sidebar is collapsed", () => {
    mockSidebarCollapsed = true;
    render(<FeatureTopBar featureId={1} projectId={1} />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders ModelSelector for ws-feature", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<FeatureTopBar featureId={1} projectId={1} />);
    await user.click(screen.getByTitle("Feature settings"));
    expect(screen.getByTestId("model-selector")).toBeInTheDocument();
  });

  it("calls setCollapsed(false) when expand button is clicked", async () => {
    mockSidebarCollapsed = true;
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<FeatureTopBar featureId={1} projectId={1} />);
    await user.click(screen.getByTitle("Expand sidebar (⌘B)"));
    expect(mockSetCollapsed).toHaveBeenCalledWith(false);
  });

});
