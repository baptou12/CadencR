import type { FeatureWorktreeInfo } from "@/api/generated";

export interface ArchiveCleanupAvailability {
  hasLiveWorktree: boolean;
  hasResidualWorktreeDirectory: boolean;
  showBranchRemoval: boolean;
  showWorktreeRemoval: boolean;
}

export function getArchiveCleanupAvailability(
  worktree: FeatureWorktreeInfo | null | undefined,
): ArchiveCleanupAvailability {
  const showWorktreeRemoval = worktree != null && !worktree.is_main_worktree;
  return {
    hasLiveWorktree: Boolean(worktree?.live && showWorktreeRemoval),
    hasResidualWorktreeDirectory: Boolean(
      worktree?.directory_exists && !worktree.live && showWorktreeRemoval,
    ),
    showBranchRemoval: Boolean(
      worktree?.worktree_branch && worktree.branch_exists !== false && !worktree.is_default_branch,
    ),
    showWorktreeRemoval,
  };
}
