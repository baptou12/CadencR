import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "./CommandPalette";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

const generatedMocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  createFeature: vi.fn(),
  setProjectSetting: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../api/generated", () => ({
  useListProjects: vi.fn(() => ({
    data: [{ id: 1, name: "Test Project", path: "/test/project" }],
  })),
  useListFeatures: vi.fn(() => ({ data: [] })),
  useListBranches: vi.fn(() => ({
    data: [
      { name: "main", is_local: true },
      { name: "feature/foo", is_local: true, attached_feature_id: 42 },
      { name: "origin/remote-only", is_local: false },
    ],
    isLoading: false,
    isError: false,
    error: null,
  })),
  useCreateProject: vi.fn(() => ({ mutate: generatedMocks.createProject })),
  useCreateFeature: vi.fn(() => ({ mutate: generatedMocks.createFeature })),
  useGetProjectSettings: vi.fn(() => ({ data: [] })),
  useSetProjectSetting: vi.fn(() => ({ mutateAsync: generatedMocks.setProjectSetting })),
  getListProjectsQueryKey: vi.fn(() => ["/api/projects"] as const),
  getListFeaturesQueryKey: vi.fn(
    (params?: { project_id?: number }) => ["/api/features", params] as const,
  ),
}));

describe("CommandPalette", () => {
  const onOpenChange = vi.fn();

  beforeEach(() => {
    onOpenChange.mockClear();
    mockNavigate.mockClear();
    generatedMocks.createProject.mockClear();
    generatedMocks.createFeature.mockClear();
    generatedMocks.setProjectSetting.mockClear();
  });

  it("renders when open", () => {
    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        activeProjectId={null}
        activeFeatureId={null}
      />,
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("does not render dialog content when closed", () => {
    render(
      <CommandPalette
        open={false}
        onOpenChange={onOpenChange}
        activeProjectId={null}
        activeFeatureId={null}
      />,
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows New Project and New Feature commands", () => {
    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        activeProjectId={1}
        activeFeatureId={null}
      />,
    );
    expect(screen.getByText("New Project")).toBeInTheDocument();
    expect(screen.getByText("New Feature")).toBeInTheDocument();
  });

  it("shows Settings command", () => {
    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        activeProjectId={null}
        activeFeatureId={null}
      />,
    );
    const settingsEls = screen.getAllByText(/Settings/);
    expect(settingsEls.length).toBeGreaterThan(0);
  });

  it("clicking Settings navigates to /settings", async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        activeProjectId={null}
        activeFeatureId={null}
      />,
    );
    const settingsEl = screen.getAllByText(/Settings/)[0];
    await user.click(settingsEl);
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/settings" });
  });

  it("New Feature opens worktree-choice step and submits with mode=new by default", async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        activeProjectId={1}
        activeFeatureId={null}
      />,
    );
    await user.click(screen.getByText("New Feature"));
    expect(await screen.findByText("New feature: choose worktree")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create feature" }));
    expect(generatedMocks.createFeature).toHaveBeenCalledWith({
      data: {
        project_id: 1,
        title: "Untitled Feature",
        worktree_mode: "new",
      },
    });
  });

  it("worktree-choice 'reuse' disables submit until a branch is picked", async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        activeProjectId={1}
        activeFeatureId={null}
      />,
    );
    await user.click(screen.getByText("New Feature"));
    await user.click(screen.getByText("Reuse existing branch"));
    const submitBtn = screen.getByRole("button", { name: "Create feature" });
    expect(submitBtn).toBeDisabled();
    await user.click(await screen.findByText("main"));
    expect(submitBtn).toBeEnabled();
    await user.click(submitBtn);
    expect(generatedMocks.createFeature).toHaveBeenCalledWith({
      data: {
        project_id: 1,
        title: "Untitled Feature",
        worktree_mode: "reuse",
        reuse_branch: "main",
      },
    });
  });

  it("shows New Session command", () => {
    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        activeProjectId={1}
        activeFeatureId={null}
      />,
    );
    expect(screen.getByText("New Session")).toBeInTheDocument();
  });
});
