import type { ReactElement, ReactNode, RefObject } from "react";
import type {
  AllocatedPort,
  Feature,
  FeatureWorktreeInfo,
  GitStats,
  PrStatusSnapshot,
} from "@/api/generated";
import { FeatureRowTitleLine } from "@/components/FeatureRowTitleLine";
import { FeatureRowMetaLine, type FeatureLabelEditing } from "@/components/ProjectFeatureRowParts";
import { SidebarPendingRequestLine } from "@/components/SidebarPendingRequestLine";
import type { Attention } from "@/lib/sidebar-attention";

export interface FeatureRowBodyProps {
  feature: Feature;
  liveTitle: string | undefined;
  isAutoNaming: boolean;
  isArchived: boolean;
  hasWorktree: boolean;
  worktree: FeatureWorktreeInfo | undefined;
  attention: Attention;
  isActive: boolean;
  badgeRef?: RefObject<HTMLSpanElement | null>;
  onOpenConversation: () => void;
  /** The hover actions, in the title line before the time they replace. */
  actions?: ReactNode;
  prStatus: PrStatusSnapshot | undefined;
  gitStats: GitStats | undefined;
  shellCount: number;
  browserCount: number;
  downloadCount: number;
  ports: readonly AllocatedPort[];
  labelEditor?: FeatureLabelEditing;
  onOpenPort: (port: number) => void;
}

/**
 * What a conversation row shows, wherever it is: the title line, what a
 * waiting conversation asks for, and the meta line. Takes plain values, so the
 * project tree, the blocks above it and the display options preview render the
 * exact same row from their own data.
 */
export function FeatureRowBody({
  feature,
  liveTitle,
  isAutoNaming,
  isArchived,
  hasWorktree,
  worktree,
  attention,
  isActive,
  badgeRef,
  onOpenConversation,
  actions,
  prStatus,
  gitStats,
  shellCount,
  browserCount,
  downloadCount,
  ports,
  labelEditor,
  onOpenPort,
}: FeatureRowBodyProps): ReactElement {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <FeatureRowTitleLine
        feature={feature}
        liveTitle={liveTitle}
        isAutoNaming={isAutoNaming}
        isArchived={isArchived}
        hasWorktree={hasWorktree}
        worktree={worktree}
        attention={attention}
        isActive={isActive}
        badgeRef={badgeRef}
        onOpenConversation={onOpenConversation}
      >
        {actions}
      </FeatureRowTitleLine>
      <SidebarPendingRequestLine attention={attention} />
      <FeatureRowMetaLine
        feature={feature}
        worktree={worktree}
        prStatus={prStatus}
        gitStats={gitStats}
        shellCount={shellCount}
        browserCount={browserCount}
        downloadCount={downloadCount}
        ports={ports}
        labelEditor={labelEditor}
        onOpenPort={onOpenPort}
      />
    </div>
  );
}
