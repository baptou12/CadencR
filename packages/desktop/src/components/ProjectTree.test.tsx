import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { ProjectTree } from "./ProjectTree";
import { resetMockIds } from "@/test-fixtures";

const mockNavigate = vi.fn();
const mockCreateProject = vi.fn();
const mockDeleteProject = vi.fn();
const mockCreateFeature = vi.fn();
const _mockCreateSession = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../api/generated", () => ({
  useListProjects: vi.fn(() => ({
    data: [
      { id: 1, name: "Alpha Project", path: "/alpha" },
      { id: 2, name: "Beta Project", path: "/beta" },
    ],
  })),
  useCreateProject: vi.fn((opts?: { onSuccess?: () => void }) => ({
    mutate: (data: unknown) => {
      mockCreateProject(data);
      opts?.onSuccess?.();
    },
    isLoading: false,
  })),
  useDeleteProject: vi.fn((opts?: { onSuccess?: () => void }) => ({
    mutate: (data: unknown) => {
      mockDeleteProject(data);
      opts?.onSuccess?.();
    },
  })),
  getListProjectsQueryKey: vi.fn(() => ["projects"]),
  useListFeatures: vi.fn(() => ({
    data: [
      {
        id: 10,
        title: "Feature One",
        status: "active",
        type: "ws-session",
        project_id: 1,
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
  })),
  useCreateFeature: vi.fn((opts?: { onSuccess?: (r: unknown) => void }) => ({
    mutate: (data: unknown) => {
      mockCreateFeature(data);
      opts?.onSuccess?.({ id: 99 });
    },
  })),
  useUpdateFeatureStatus: vi.fn(() => ({ mutate: vi.fn() })),
  useDeleteFeature: vi.fn(() => ({ mutate: vi.fn() })),
  useUpdateFeatureLabel: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  getListFeaturesQueryKey: vi.fn((id: number) => ["features", "list", id]),
  getGetFeatureQueryKey: (id: number) => ["features", "detail", id],
  getGetFeatureSettingsQueryKey: (id: number) => ["features", "settings", id],
  useSetProjectSetting: vi.fn(() => ({ mutate: vi.fn() })),
  useListProjectWorktrees: vi.fn(() => ({ data: [] })),
  useListFeatureWorktrees: vi.fn(() => ({ data: [] })),
  useGetStats: vi.fn(() => ({ data: undefined })),
}));

vi.mock("@/stores/ws-session-store", () => ({
  useWsSessionStore: vi.fn((selector: (s: { sessions: Record<string, unknown> }) => unknown) =>
    selector({ sessions: {} }),
  ),
}));

vi.mock("@/hooks/useProjectColor", () => ({
  ProjectColorDot: ({ projectId }: { projectId: number }) => {
    const React = require("react");
    return React.createElement("span", { "data-testid": `color-dot-${projectId}` });
  },
}));

// Mock ProjectSettingsDialog
vi.mock("./ProjectSettingsDialog", () => ({
  ProjectSettingsDialog: () => null,
}));

function visibleShortcutBadgeTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-nav-shortcut-badge]"))
    .map((badge) => badge.textContent ?? "")
    .filter(Boolean);
}

describe("ProjectTree", () => {
  beforeEach(() => {
    resetMockIds();
    mockNavigate.mockClear();
    mockCreateFeature.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders project list", () => {
    render(<ProjectTree activeProjectId={null} activeFeatureId={null} onSelectFeature={vi.fn()} />);
    expect(screen.getByText("Alpha Project")).toBeInTheDocument();
    expect(screen.getByText("Beta Project")).toBeInTheDocument();
  });

  it("renders color dots for each project", () => {
    render(<ProjectTree activeProjectId={null} activeFeatureId={null} onSelectFeature={vi.fn()} />);
    expect(screen.getByTestId("color-dot-1")).toBeInTheDocument();
    expect(screen.getByTestId("color-dot-2")).toBeInTheDocument();
  });

  it("renders Projects heading", () => {
    render(<ProjectTree activeProjectId={null} activeFeatureId={null} onSelectFeature={vi.fn()} />);
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });

  it("shows add project button", () => {
    render(<ProjectTree activeProjectId={null} activeFeatureId={null} onSelectFeature={vi.fn()} />);
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });

  it("expands active project to show features", () => {
    render(<ProjectTree activeProjectId={1} activeFeatureId={null} onSelectFeature={vi.fn()} />);
    expect(screen.getByText("Feature One")).toBeInTheDocument();
  });

  it("toggles project expansion on click", async () => {
    const user = userEvent.setup();
    render(<ProjectTree activeProjectId={null} activeFeatureId={null} onSelectFeature={vi.fn()} />);
    // Click project button to expand
    await user.click(screen.getByText("Alpha Project"));
    expect(screen.getByText("Feature One")).toBeInTheDocument();
    // Click again to collapse
    await user.click(screen.getByText("Alpha Project"));
    expect(screen.queryByText("Feature One")).not.toBeInTheDocument();
  });

  it("uses command-number to activate visible sidebar rows", async () => {
    const onSelectFeature = vi.fn();
    render(
      <ProjectTree
        activeProjectId={null}
        activeFeatureId={null}
        onSelectFeature={onSelectFeature}
      />,
    );

    fireEvent.keyDown(window, { key: "1", metaKey: true });
    expect(screen.getByText("Feature One")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "2", metaKey: true });
    expect(onSelectFeature).toHaveBeenCalledWith(10);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/ws-session/$sessionId",
        params: { sessionId: "ws-feature-10" },
      }),
    );
  });

  it("shows visible command-number hints while command is held", () => {
    const { container } = render(
      <ProjectTree activeProjectId={1} activeFeatureId={null} onSelectFeature={vi.fn()} />,
    );
    const badges = (): string[] => visibleShortcutBadgeTexts(container);

    expect(badges()).toEqual([]);

    fireEvent.keyDown(window, { key: "Meta", metaKey: true });

    expect(badges()).toEqual(["1", "2", "3"]);

    fireEvent.keyUp(window, { key: "Meta", metaKey: false });

    expect(badges()).toEqual([]);
  });

  it("hides command-number hints when Cmd+Tab opens the app switcher", () => {
    const { container } = render(
      <ProjectTree activeProjectId={1} activeFeatureId={null} onSelectFeature={vi.fn()} />,
    );
    const badges = (): string[] => visibleShortcutBadgeTexts(container);

    fireEvent.keyDown(window, { key: "Meta", metaKey: true });
    expect(badges()).toEqual(["1", "2", "3"]);

    fireEvent.keyDown(window, { key: "Tab", metaKey: true });

    expect(badges()).toEqual([]);
  });

  it("clears command-number hints when window focus returns without Meta keyup", () => {
    const { container } = render(
      <ProjectTree activeProjectId={1} activeFeatureId={null} onSelectFeature={vi.fn()} />,
    );
    const badges = (): string[] => visibleShortcutBadgeTexts(container);

    fireEvent.keyDown(window, { key: "Meta", metaKey: true });
    expect(badges()).toEqual(["1", "2", "3"]);

    fireEvent.focus(window);

    expect(badges()).toEqual([]);
  });

  it("clears stale command-number hints when macOS swallows Meta keyup", () => {
    vi.useFakeTimers();
    const { container } = render(
      <ProjectTree activeProjectId={1} activeFeatureId={null} onSelectFeature={vi.fn()} />,
    );
    const badges = (): string[] => visibleShortcutBadgeTexts(container);

    fireEvent.keyDown(window, { key: "Meta", metaKey: true });
    expect(badges()).toEqual(["1", "2", "3"]);

    act(() => vi.runOnlyPendingTimers());

    expect(badges()).toEqual([]);
  });
});
