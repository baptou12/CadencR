import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import type { BranchInfo } from "@/api/generated";
import { WorktreeButtonGroup } from "./WorktreePopover";

const mocks = vi.hoisted(() => ({
  mockUseListBranches: vi.fn(),
  mockUseValidateCheckout: vi.fn(),
}));

vi.mock("@/api/generated", () => ({
  useListBranches: mocks.mockUseListBranches,
  useValidateCheckout: mocks.mockUseValidateCheckout,
}));

function branch(name: string, attached?: string | null): BranchInfo {
  return {
    name,
    is_local: true,
    attached_worktree_path: attached ?? null,
    attached_feature_id: attached ? 7 : null,
  } as unknown as BranchInfo;
}

function renderGroup(args: {
  branches: BranchInfo[];
  selectedBranch: string | null;
  useWorktree: boolean;
  onToggleWorktree: () => void;
}): ReturnType<typeof render> {
  mocks.mockUseListBranches.mockReturnValue({
    data: args.branches,
    isLoading: false,
    isError: false,
    error: null,
  });
  mocks.mockUseValidateCheckout.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ success: true }),
    isPending: false,
  });
  return render(
    <WorktreeButtonGroup
      projectId={1}
      defaultBranch="main"
      useWorktree={args.useWorktree}
      onToggleWorktree={args.onToggleWorktree}
      selectedBranch={args.selectedBranch}
      onSelectedBranchChange={vi.fn()}
    />,
  );
}

describe("WorktreeButtonGroup", () => {
  it("does not let users turn off worktree mode for an attached selected branch", async () => {
    const onToggleWorktree = vi.fn();
    const { user } = renderGroup({
      branches: [branch("feat/attached", "/tmp/feat-attached")],
      selectedBranch: "feat/attached",
      useWorktree: true,
      onToggleWorktree,
    });

    await user.click(screen.getByRole("button", { name: /use worktree/i }));

    expect(onToggleWorktree).not.toHaveBeenCalled();
  });

  it("explains that locked worktree mode reuses the existing worktree", async () => {
    const { user } = renderGroup({
      branches: [branch("feat/attached", "/tmp/feat-attached")],
      selectedBranch: "feat/attached",
      useWorktree: true,
      onToggleWorktree: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: /use worktree/i }));

    expect(await screen.findByText("Existing worktree selected")).toBeInTheDocument();
    expect(screen.getByText(/Cadencr will reuse that existing worktree/i)).toBeInTheDocument();
    expect(screen.getByText(/No new branch will be created/i)).toBeInTheDocument();
  });

  it("still lets users turn off worktree mode for an unattached selected branch", async () => {
    const onToggleWorktree = vi.fn();
    const { user } = renderGroup({
      branches: [branch("feat/unattached")],
      selectedBranch: "feat/unattached",
      useWorktree: true,
      onToggleWorktree,
    });

    await user.click(screen.getByRole("button", { name: /use worktree/i }));

    expect(onToggleWorktree).toHaveBeenCalledTimes(1);
  });
});
