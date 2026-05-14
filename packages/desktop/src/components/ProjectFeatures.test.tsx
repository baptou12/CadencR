import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { ProjectFeatures } from "./ProjectFeatures";
import { shouldIgnoreFeatureRowKeyDown } from "./ProjectFeatureRow";
import { resetMockIds } from "@/test-fixtures";
import { ROOT_LEAF_ID } from "@/stores/feature-layout-schema";
import { useFeatureLayoutStore } from "@/stores/feature-layout-store";

type UserEvent = ReturnType<typeof userEvent.setup>;

async function openLabelEditor(user: UserEvent, featureText: string): Promise<void> {
  const row = screen.getByText(featureText).closest("[role=button]");
  if (!row) throw new Error(`Feature row not found for "${featureText}"`);
  fireEvent.contextMenu(row);
  await user.click(await screen.findByText("Set label"));
  await screen.findByText("Set feature label");
}

const mockNavigate = vi.fn();
const _mockInvalidate = vi.fn();
const mockUpdateLabel = vi.fn();
const mockUpdateStatus = vi.fn();
const mockDelete = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

const mockFeatures = [
  {
    id: 1,
    title: "Feature One",
    status: "active",
    label: "Review",
    type: "ws-session",
    project_id: 1,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: 2,
    title: "Feature Two",
    status: "active",
    label: "Blocked",
    type: "ws-session",
    project_id: 1,
    created_at: "2026-01-02T00:00:00Z",
  },
  {
    id: 3,
    title: "Session One",
    status: "active",
    type: "ws-session",
    project_id: 1,
    created_at: "2026-01-03T00:00:00Z",
  },
  {
    id: 4,
    title: "Archived Session",
    status: "archived",
    type: "ws-session",
    project_id: 1,
    created_at: "2026-01-04T00:00:00Z",
  },
];

vi.mock("@/api/generated", () => ({
  FeatureStatus: { active: "active", archived: "archived" },
  useListFeatures: vi.fn(() => ({ data: mockFeatures })),
  useUpdateFeatureLabel: vi.fn(
    (opts?: { onSuccess?: (data: unknown, variables: unknown) => void }) => ({
      mutate: (data: unknown) => {
        mockUpdateLabel(data);
        opts?.onSuccess?.({}, data);
      },
      isPending: false,
    }),
  ),
  useUpdateFeatureStatus: vi.fn((opts?: { mutation?: { onSuccess?: () => void } }) => ({
    mutate: (data: unknown) => {
      mockUpdateStatus(data);
      opts?.mutation?.onSuccess?.();
    },
  })),
  useDeleteFeature: vi.fn((opts?: { onSuccess?: () => void }) => ({
    mutate: (data: unknown) => {
      mockDelete(data);
      opts?.onSuccess?.();
    },
  })),
  getListFeaturesQueryKey: vi.fn((id: number) => ["features", "list", id]),
  getGetFeatureQueryKey: vi.fn((id: number) => ["features", "detail", id]),
  getGetFeatureSettingsQueryKey: vi.fn((id: number) => ["features", "settings", id]),
  useListProjectWorktrees: vi.fn(() => ({ data: [] })),
  useListFeatureWorktrees: vi.fn(() => ({ data: [] })),
  useGetStats: vi.fn(() => ({ data: undefined })),
  getFeatureAgentState: vi.fn(() => Promise.resolve({ sessions: [] })),
  getGetFeatureAgentStateQueryKey: (id: number) => [`/api/features/${id}/agent-state`] as const,
  getBranch: vi.fn(() => Promise.resolve({ branch: "main" })),
  getGetBranchQueryKey: (params: unknown) => [`/api/git/branch`, params] as const,
  getStats: vi.fn(() => Promise.resolve({ insertions: 0, deletions: 0 })),
  getGetStatsQueryKey: (params: unknown) => [`/api/git/stats`, params] as const,
}));

vi.mock("@/stores/ws-session-store", () => ({
  useWsSessionStore: vi.fn((selector: (s: { sessions: Record<string, unknown> }) => unknown) =>
    selector({ sessions: {} }),
  ),
}));

describe("ProjectFeatures", () => {
  beforeEach(() => {
    resetMockIds();
    mockNavigate.mockClear();
    mockUpdateLabel.mockClear();
    mockUpdateStatus.mockClear();
    mockDelete.mockClear();
    useFeatureLayoutStore.setState({ features: {} });
  });

  it("renders feature list", () => {
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={null}
        onSelectFeature={vi.fn()}
      />,
    );
    expect(screen.getByText("Feature One")).toBeInTheDocument();
    expect(screen.getByText("Feature Two")).toBeInTheDocument();
    expect(screen.getByText("Session One")).toBeInTheDocument();
    expect(screen.queryByText("Archived Session")).not.toBeInTheDocument();
  });

  it("renders active features and a collapsed archived section", () => {
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={null}
        onSelectFeature={vi.fn()}
      />,
    );
    expect(screen.getByText("Feature One")).toBeInTheDocument();
    expect(screen.getByText("Feature Two")).toBeInTheDocument();
    expect(screen.getByText("Session One")).toBeInTheDocument();
    expect(screen.queryByText("Archived Session")).not.toBeInTheDocument();
    expect(screen.getByText("Archived (1)")).toBeInTheDocument();
  });

  it("expands archived features when the archived section is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={null}
        onSelectFeature={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Archived (1)"));

    expect(screen.getByText("Archived Session")).toBeInTheDocument();
  });

  it("auto-expands the archived section for the active archived session", () => {
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={4}
        onSelectFeature={vi.fn()}
      />,
    );

    expect(screen.getByText("Archived Session")).toBeInTheDocument();
  });

  it("archives active features through the status mutation", async () => {
    const user = userEvent.setup();
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={null}
        onSelectFeature={vi.fn()}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: "Archive" })[0]);
    await screen.findByText("Archive session?");
    const archiveButtons = screen.getAllByRole("button", { name: "Archive" });
    await user.click(archiveButtons[archiveButtons.length - 1]);

    expect(mockUpdateStatus).toHaveBeenCalledWith({ id: 1, data: { status: "archived" } });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes archived features from the archived section", async () => {
    const user = userEvent.setup();
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={null}
        onSelectFeature={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Archived (1)"));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("Delete archived session?");
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    await user.click(deleteButtons[deleteButtons.length - 1]);

    expect(mockDelete).toHaveBeenCalledWith({ id: 4 });
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it("highlights active feature", () => {
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={1}
        onSelectFeature={vi.fn()}
      />,
    );
    // Feature One should have active styling
    const featureEl = screen.getByText("Feature One").closest("[role=button]");
    expect(featureEl).toHaveClass("bg-accent");
  });

  it("navigates to feature on click", async () => {
    const user = userEvent.setup();
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={null}
        onSelectFeature={vi.fn()}
      />,
    );
    await user.click(screen.getByText("Feature One"));
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/ws-session/$sessionId",
      }),
    );
  });

  it("passes the currently focused tab when navigating to another feature", async () => {
    const user = userEvent.setup();
    useFeatureLayoutStore.getState().setState(1, {
      version: 1,
      splitRoot: {
        type: "leaf",
        id: ROOT_LEAF_ID,
        tabIds: ["agent", "terminal", "git", "editor"],
        activeTabId: "terminal",
      },
      focusedPaneId: ROOT_LEAF_ID,
      appliedLayoutId: null,
    });
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={1}
        onSelectFeature={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Feature Two"));

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ focusTab: "terminal" }),
      }),
    );
  });

  it("calls onSelectFeature when feature clicked", async () => {
    const user = userEvent.setup();
    const onSelectFeature = vi.fn();
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={null}
        onSelectFeature={onSelectFeature}
      />,
    );
    await user.click(screen.getByText("Feature One"));
    expect(onSelectFeature).toHaveBeenCalledWith(1);
  });

  it("does not render auto-rename controls in the sidebar", () => {
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={null}
        onSelectFeature={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Auto-rename" })).not.toBeInTheDocument();
  });

  it("renders status badges for features", () => {
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={null}
        onSelectFeature={vi.fn()}
      />,
    );
    // Features with different statuses render without crashing
    expect(screen.getByText("Feature Two")).toBeInTheDocument();
  });

  it("renders feature labels in the sidebar metadata line", () => {
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={null}
        onSelectFeature={vi.fn()}
      />,
    );

    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("opens the label editor popover from the context menu and saves with Enter", async () => {
    const user = userEvent.setup();
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={null}
        onSelectFeature={vi.fn()}
      />,
    );

    await openLabelEditor(user, "Feature One");
    const input = screen.getByDisplayValue("Review");
    await user.clear(input);
    await user.type(input, "QA{Enter}");

    expect(mockUpdateLabel).toHaveBeenCalledWith({ id: 1, data: { label: "QA" } });
  });

  it("opens the active feature label editor with Cmd+Shift+L", () => {
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={1}
        onSelectFeature={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { code: "KeyL", key: "L", metaKey: true, shiftKey: true });

    expect(screen.getByText("Set feature label")).toBeInTheDocument();
  });

  it("does not save when the label is unchanged", async () => {
    const user = userEvent.setup();
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={null}
        onSelectFeature={vi.fn()}
      />,
    );

    await openLabelEditor(user, "Feature One");
    await user.keyboard("{Enter}");

    expect(mockUpdateLabel).not.toHaveBeenCalled();
  });

  it("opens the label editor popover from the context menu", async () => {
    const user = userEvent.setup();
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={1}
        onSelectFeature={vi.fn()}
      />,
    );

    const featureRow = screen.getByText("Feature One").closest("[role=button]");
    expect(featureRow).not.toBeNull();
    fireEvent.contextMenu(featureRow as HTMLElement);
    await user.click(await screen.findByText("Set label"));

    expect(screen.getByText("Set feature label")).toBeInTheDocument();
  });

  it("does not navigate when typing spaces in the label editor", async () => {
    const user = userEvent.setup();
    render(
      <ProjectFeatures
        projectId={1}
        projectPath="/test/path"
        activeFeatureId={null}
        onSelectFeature={vi.fn()}
      />,
    );

    await openLabelEditor(user, "Feature One");
    const callsBeforeTyping = mockNavigate.mock.calls.length;
    const input = screen.getByDisplayValue("Review");
    await user.clear(input);
    await user.type(input, "In progress");

    expect(mockNavigate).toHaveBeenCalledTimes(callsBeforeTyping);
  });

  it("ignores row keyboard navigation from interactive descendants", () => {
    const input = document.createElement("input");
    const textbox = document.createElement("div");
    const plainRowTarget = document.createElement("div");
    textbox.setAttribute("role", "textbox");

    expect(shouldIgnoreFeatureRowKeyDown(input)).toBe(true);
    expect(shouldIgnoreFeatureRowKeyDown(textbox)).toBe(true);
    expect(shouldIgnoreFeatureRowKeyDown(plainRowTarget)).toBe(false);
  });
});
