import { memo } from "react";
import { CheckIcon, GitBranchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorktreeButtonGroup } from "./WorktreePopover";
import { META_BAR_CHIP, WORKTREE_ACTIVE_CHIP } from "./meta-bar-chip-styles";

export interface WorktreeChipProps {
  useWorktree?: boolean;
  onToggleWorktree?: () => void;
  /**
   * When the embedder provides `worktreeProjectId` + branch state, the richer
   * two-chip group (Branch picker + Use-worktree toggle) replaces the legacy
   * on/off button. Embedders that don't supply these fall back to the toggle.
   */
  worktreeProjectId?: number;
  worktreeDefaultBranch?: string;
  worktreeSelectedBranch?: string | null;
  onWorktreeBranchChange?: (next: string | null) => void;
}

/**
 * Branch + worktree selection chip. Shared by `MetaBar` (inline, wide screens)
 * and `MetaBarSecondary` (below the prompt on narrow/mobile widths) so the two
 * placements stay identical. Memoized like the sibling chips — it sits next to
 * the agent stream, so it must not re-render on every streamed token.
 */
export const WorktreeChip = memo(function WorktreeChip({
  useWorktree,
  onToggleWorktree,
  worktreeProjectId,
  worktreeDefaultBranch,
  worktreeSelectedBranch,
  onWorktreeBranchChange,
}: WorktreeChipProps) {
  if (worktreeProjectId != null && onWorktreeBranchChange && onToggleWorktree) {
    return (
      <WorktreeButtonGroup
        projectId={worktreeProjectId}
        defaultBranch={worktreeDefaultBranch}
        useWorktree={!!useWorktree}
        onToggleWorktree={onToggleWorktree}
        selectedBranch={worktreeSelectedBranch ?? null}
        onSelectedBranchChange={onWorktreeBranchChange}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={onToggleWorktree}
      className={cn(
        META_BAR_CHIP,
        useWorktree ? WORKTREE_ACTIVE_CHIP : "bg-muted/50 text-muted-foreground hover:bg-muted/80",
      )}
    >
      <GitBranchIcon className="size-3" />
      Use worktree
      {useWorktree && <CheckIcon className="size-3" />}
    </button>
  );
});
