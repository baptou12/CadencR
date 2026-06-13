/**
 * Header chip rendering `currentBranch → targetBranch`. The target span is
 * a popover trigger that opens `BranchPicker` to swap the target ref.
 *
 * - Reads through narrow store selectors, memoized so other features pushing
 *   status updates don't trigger re-renders here.
 * - The target span is click-only. `⌘B` is owned globally by the sidebar
 *   toggle; the branch picker intentionally has no hotkey so the two don't
 *   collide inside a feature workspace.
 */
import { memo, useCallback, useState, type ReactElement } from "react";
import { ArrowRight, GitBranch, Users } from "lucide-react";
import { HoverCard } from "radix-ui";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { selectGitStatus, useGitStatusStore } from "@/stores/useGitStatusStore";
import { BranchPicker } from "./BranchPicker";

interface BranchChipProps {
  featureId: number;
  projectId: number;
}

export const BranchChip = memo(function BranchChip({
  featureId,
  projectId,
}: BranchChipProps): ReactElement | null {
  const snapshot = useGitStatusStore(selectGitStatus(featureId));
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  if (!snapshot || !snapshot.current_branch) {
    // No snapshot yet, or a degraded one (worktree path doesn't exist on
    // disk). Render a placeholder so the chip slot is visible rather than
    // collapsed — "—" is enough to signal "not available right now".
    return (
      <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <GitBranch className="size-3" />
        <span>—</span>
      </div>
    );
  }

  const sharedWith = snapshot.shared_with ?? [];

  return (
    <div className="inline-flex items-center gap-1 text-xs">
      <GitBranch className="size-3 text-muted-foreground" />
      <span className="font-mono truncate max-w-[140px]" title={snapshot.current_branch}>
        {snapshot.current_branch}
      </span>
      <ArrowRight className="size-3 text-muted-foreground" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={handleOpen}
            className="font-mono truncate max-w-[140px] hover:bg-accent rounded px-1 py-0.5"
            title={`Change target branch (currently ${snapshot.target_branch})`}
          >
            {snapshot.target_branch}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[28rem] max-w-[calc(100vw-2rem)] p-0" align="end">
          <BranchPicker
            featureId={featureId}
            projectId={projectId}
            currentTarget={snapshot.target_branch}
            onPicked={handleClose}
          />
        </PopoverContent>
      </Popover>
      {sharedWith.length > 0 && (
        <HoverCard.Root openDelay={150} closeDelay={100}>
          <HoverCard.Trigger asChild>
            <span
              className="ml-1 inline-flex items-center gap-0.5 rounded border border-[var(--chip-shared-worktree-fg)]/20 bg-[var(--chip-shared-worktree-bg)] px-1 py-0.5 text-[var(--chip-shared-worktree-fg)]"
              aria-label="Worktree shared with other features"
              data-testid="shared-worktree-indicator"
            >
              <Users className="size-3" />
              <span className="font-medium">{sharedWith.length}</span>
            </span>
          </HoverCard.Trigger>
          <HoverCard.Portal>
            <HoverCard.Content
              side="bottom"
              align="end"
              className="z-50 w-72 rounded-md border bg-popover p-3 text-popover-foreground shadow-md"
            >
              <p className="font-medium text-xs mb-1">Shared worktree</p>
              <p className="text-xs text-muted-foreground mb-1">
                This branch is checked out in the same directory as:
              </p>
              <ul className="text-xs space-y-0.5">
                {sharedWith.map((s) => (
                  <li key={s.feature_id} className="truncate">
                    • {s.title}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground mt-1">
                Changes here will affect their view too.
              </p>
            </HoverCard.Content>
          </HoverCard.Portal>
        </HoverCard.Root>
      )}
    </div>
  );
});
