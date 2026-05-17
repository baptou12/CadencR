import { describe, it, expect, beforeEach, vi } from "vitest";
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

function renderDialog(overrides: { hasLiveWorktree?: boolean } = {}) {
  const onArchive = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ArchiveFeatureDialog
      open
      feature={feature}
      projectId={1}
      hasLiveWorktree={overrides.hasLiveWorktree ?? false}
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
      data: { branch: "feature/one", target_branch: "main", merged: true },
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
});
