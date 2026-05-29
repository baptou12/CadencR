import { describe, it, expect, beforeEach, vi } from "vitest";
import { useState, type ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@/test-utils";
import { ArchiveFeatureDialog } from "./ArchiveFeatureDialog";
import type { Feature, GitStatusSnapshot } from "@/api/generated";

const { mockDeleteWorktree, mockDeleteBranch, mockBranchCheck, mockGitStatus } = vi.hoisted(() => ({
  mockDeleteWorktree: vi.fn(),
  mockDeleteBranch: vi.fn(),
  mockBranchCheck: vi.fn(),
  mockGitStatus: vi.fn(),
}));

vi.mock("@/api/generated", () => ({
  useDeleteWorktree: vi.fn(() => ({ mutateAsync: mockDeleteWorktree })),
  useDeleteFeatureBranch: vi.fn(() => ({ mutateAsync: mockDeleteBranch })),
  useCheckBranchDelete: mockBranchCheck,
  useGetGitStatus: mockGitStatus,
}));

vi.mock("sonner", () => ({
  toast: {
    promise: vi.fn((promise: Promise<unknown>) => promise),
    error: vi.fn(),
  },
}));

const feature: Feature = {
  id: 1,
  title: "Feature One",
  status: "active",
  type: "ws-session",
  project_id: 1,
  created_at: "2026-01-01T00:00:00Z",
};

const nextFeature: Feature = {
  ...feature,
  id: 2,
  title: "Feature Two",
  created_at: "2026-01-02T00:00:00Z",
};

function dirtyStatus(overrides: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return {
    feature_id: 1,
    current_branch: "feature/one",
    target_branch: "main",
    uncommitted_count: 2,
    staged_count: 0,
    unstaged_count: 1,
    untracked_count: 1,
    ahead_of_remote: 0,
    behind_remote: 0,
    ahead_of_target: 0,
    has_remote: true,
    shared_with: [],
    computed_at: 1,
    ...overrides,
  };
}

function renderDialog(
  overrides: {
    hasLiveWorktree?: boolean;
    showWorktreeRemoval?: boolean;
    showBranchRemoval?: boolean;
  } = {},
) {
  const onArchive = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ArchiveFeatureDialog
      open
      feature={feature}
      projectId={1}
      hasLiveWorktree={overrides.hasLiveWorktree ?? false}
      showWorktreeRemoval={overrides.showWorktreeRemoval ?? true}
      showBranchRemoval={overrides.showBranchRemoval ?? true}
      onOpenChange={onOpenChange}
      onArchive={onArchive}
    />,
  );
  return { onArchive, onOpenChange };
}

describe("ArchiveFeatureDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteWorktree.mockResolvedValue({ success: true });
    mockDeleteBranch.mockResolvedValue({ success: true });
    mockBranchCheck.mockReturnValue({
      data: {
        branch: "feature/one",
        current_branch: "feature/one",
        target_branch: "main",
        merged: true,
      },
      isLoading: false,
    });
    mockGitStatus.mockReturnValue({ data: undefined, isLoading: false });
  });

  it("uses Cmd+Enter, not plain Enter, to confirm archiving", async () => {
    const user = userEvent.setup();
    const { onArchive } = renderDialog();

    await user.keyboard("{Enter}");

    expect(onArchive).not.toHaveBeenCalled();

    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(onArchive).toHaveBeenCalledWith(1);
  });

  it("ignores repeated confirm keys while the archive dialog is closing", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn();

    function DelayedCloseHarness(): ReactElement {
      const [dialogFeature, setDialogFeature] = useState(feature);
      return (
        <ArchiveFeatureDialog
          open
          feature={dialogFeature}
          projectId={1}
          hasLiveWorktree={false}
          showWorktreeRemoval
          showBranchRemoval
          onOpenChange={vi.fn()}
          onArchive={(featureId) => {
            onArchive(featureId);
            setDialogFeature(nextFeature);
          }}
        />
      );
    }

    render(<DelayedCloseHarness />);

    screen.getByRole("button", { name: /archive/i }).focus();
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await user.keyboard("{Enter}");

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledWith(1);
  });

  it("warns and force-removes dirty worktrees", async () => {
    mockGitStatus.mockReturnValue({ data: dirtyStatus(), isLoading: false });
    const user = userEvent.setup();
    renderDialog({ hasLiveWorktree: true });

    await user.click(screen.getByText("Remove worktree"));

    expect(screen.getByText(/permanently lose local changes/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /archive/i }));

    expect(mockDeleteWorktree).toHaveBeenCalledWith({
      params: { project_id: 1, feature_id: 1, force: true },
    });
  });

  it("does not allow branch removal when a no-worktree session is on the target branch", async () => {
    mockBranchCheck.mockReturnValue({
      data: { branch: "main", current_branch: "main", target_branch: "main", merged: true },
      isLoading: false,
    });
    const user = userEvent.setup();
    renderDialog({ showWorktreeRemoval: false });

    await user.click(screen.getByText("Remove branch"));

    expect(screen.getByRole("checkbox", { name: /remove branch/i })).not.toBeChecked();
    expect(screen.getByText(/cannot remove the target branch/i)).toBeInTheDocument();
  });

  it("explains no-worktree branch removal checks out the target before deleting", async () => {
    const user = userEvent.setup();
    renderDialog({ showWorktreeRemoval: false });

    await user.click(screen.getByText("Remove branch"));

    expect(screen.getByRole("checkbox", { name: /remove branch/i })).toBeChecked();
    expect(screen.getByText(/checkout main before deleting feature\/one/i)).toBeInTheDocument();
  });

  it("does not allow removing the default branch", async () => {
    mockBranchCheck.mockReturnValue({
      data: {
        branch: "main",
        current_branch: "feature/one",
        target_branch: "develop",
        default_branch: "main",
        is_default_branch: true,
        merged: true,
      },
      isLoading: false,
    });
    const user = userEvent.setup();
    renderDialog({ showWorktreeRemoval: false });

    await user.click(screen.getByText("Remove branch"));

    expect(screen.getByRole("checkbox", { name: /remove branch/i })).not.toBeChecked();
    expect(screen.getByText(/cannot remove the default branch/i)).toBeInTheDocument();
  });

  it("shows only archive confirmation when branch and worktree cleanup are unavailable", () => {
    renderDialog({ showWorktreeRemoval: false, showBranchRemoval: false });

    expect(screen.queryByText("Remove worktree")).not.toBeInTheDocument();
    expect(screen.queryByText("Remove branch")).not.toBeInTheDocument();
    expect(mockBranchCheck).toHaveBeenCalledWith(
      { project_id: 1, feature_id: 1 },
      { query: { enabled: false, retry: false } },
    );
  });
});
