import type { ReactNode } from "react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightIcon,
  FolderGit2Icon,
  GitBranchIcon,
  PinIcon,
  PinOffIcon,
  TagIcon,
  TrashIcon,
  TypeIcon,
  XIcon,
} from "lucide-react";
import { ContextMenuSeparator } from "@/components/ui/context-menu";
import { ContextMenuActionItem } from "@/components/ContextMenuActionItem";
import type { Feature, FeatureWorktreeInfo } from "@/api/generated";
import { closeFeatureActivityNoun } from "@/lib/feature-activity-close";
import { copyToClipboard } from "@/lib/clipboard";

interface ProjectFeatureContextMenuProps {
  feature: Feature;
  liveTitle: string | undefined;
  worktree: FeatureWorktreeInfo | undefined;
  isArchived: boolean;
  isPinned: boolean;
  hasActivity: boolean;
  shellCount: number;
  browserCount: number;
  archiveActionLabel: string;
  pinActionLabel: string;
  onNavigate: (feature: Feature) => void;
  onTogglePin: (featureId: number, pinned: boolean) => void;
  onStartLabelEditAfterMenuClose: () => void;
  onCloseActivity: (featureId: number, shellCount: number, browserCount: number) => void;
  onUnarchive: (featureId: number) => void;
  onArchiveOrDelete: (featureId: number) => void;
}

export function ProjectFeatureContextMenu({
  feature,
  liveTitle,
  worktree,
  isArchived,
  isPinned,
  hasActivity,
  shellCount,
  browserCount,
  archiveActionLabel,
  pinActionLabel,
  onNavigate,
  onTogglePin,
  onStartLabelEditAfterMenuClose,
  onCloseActivity,
  onUnarchive,
  onArchiveOrDelete,
}: ProjectFeatureContextMenuProps): ReactNode {
  const featureTitle = liveTitle ?? feature.title;
  const branch = worktree?.worktree_branch ?? "";
  const worktreePath = worktree?.worktree_path ?? "";
  return (
    <>
      <ContextMenuActionItem icon={ArrowRightIcon} onSelect={() => onNavigate(feature)}>
        Open
      </ContextMenuActionItem>
      {!isArchived && (
        <ContextMenuActionItem
          icon={isPinned ? PinOffIcon : PinIcon}
          onSelect={() => onTogglePin(feature.id, !isPinned)}
        >
          {pinActionLabel}
        </ContextMenuActionItem>
      )}
      <ContextMenuActionItem icon={TagIcon} onSelect={onStartLabelEditAfterMenuClose}>
        Set label
      </ContextMenuActionItem>
      {hasActivity && (
        <ContextMenuActionItem
          icon={XIcon}
          onSelect={() => onCloseActivity(feature.id, shellCount, browserCount)}
        >
          {`Close ${closeFeatureActivityNoun(shellCount, browserCount)}`}
        </ContextMenuActionItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuActionItem
        icon={GitBranchIcon}
        disabled={!branch}
        onSelect={() => void copyToClipboard(branch, "Branch copied")}
      >
        Copy branch
      </ContextMenuActionItem>
      <ContextMenuActionItem
        icon={FolderGit2Icon}
        disabled={!worktreePath}
        onSelect={() => void copyToClipboard(worktreePath, "Worktree path copied")}
      >
        Copy worktree path
      </ContextMenuActionItem>
      <ContextMenuActionItem
        icon={TypeIcon}
        disabled={!featureTitle}
        onSelect={() => void copyToClipboard(featureTitle, "Feature title copied")}
      >
        Copy feature title
      </ContextMenuActionItem>
      <ContextMenuSeparator />
      {isArchived && (
        <ContextMenuActionItem icon={ArchiveRestoreIcon} onSelect={() => onUnarchive(feature.id)}>
          Unarchive
        </ContextMenuActionItem>
      )}
      <ContextMenuActionItem
        icon={isArchived ? TrashIcon : ArchiveIcon}
        variant="destructive"
        onSelect={() => onArchiveOrDelete(feature.id)}
      >
        {archiveActionLabel}
      </ContextMenuActionItem>
    </>
  );
}
