import { memo, type ReactElement, type ReactNode } from "react";
import { FeaturePrView } from "@/components/FeaturePrView";
import type { CommentThread } from "@/api/generated";
import type { PrReviewThreads } from "@/hooks/usePrReviewThreads";
import type { PrThreadLine, ReviewNavigationTarget } from "@/lib/pr-review-threads";
import { DiffViewer } from "./DiffViewer";
import { GitBranchesView } from "./GitBranchesView";
import { GitGraphView } from "./GitGraphView";
import { StashesView } from "./StashesView";
import type { GitViewMode } from "./GitTabToggle";
import type { DiffMode } from "./useDiffData";
import type { GitNavigationAdapterRegistrar } from "./gitNavigation";

export interface GitTabBodyProps {
  viewMode: GitViewMode;
  featureId: number;
  projectId: number;
  diffMode: DiffMode;
  diffTargetBranch: string | undefined;
  fileListCollapsed: boolean;
  onFileListCollapsedChange: (collapsed: boolean) => void;
  onRequestUncommitted: () => void;
  registerNavigationAdapter?: GitNavigationAdapterRegistrar;
  recoveryRegion: ReactNode;
  reviewThreads: PrReviewThreads;
  remoteThreadLinesByFile: Map<string, PrThreadLine[]> | undefined;
  reviewCountsByFile: ReadonlyMap<string, number>;
  reviewTarget: ReviewNavigationTarget | null;
  selectedReviewThreadIds: ReadonlySet<string>;
  onReviewThreadSelectedChange?: (threadId: string, selected: boolean) => void;
  onAllReviewThreadsSelectedChange?: (selected: boolean) => void;
  onViewReviewThread: (thread: CommentThread) => void;
}

/** Picks the pane for the active Git sub-view. */
export const GitTabBody = memo(function GitTabBody({
  viewMode,
  featureId,
  projectId,
  diffMode,
  diffTargetBranch,
  fileListCollapsed,
  onFileListCollapsedChange,
  onRequestUncommitted,
  registerNavigationAdapter,
  recoveryRegion,
  reviewThreads,
  remoteThreadLinesByFile,
  reviewCountsByFile,
  reviewTarget,
  selectedReviewThreadIds,
  onReviewThreadSelectedChange,
  onAllReviewThreadsSelectedChange,
  onViewReviewThread,
}: GitTabBodyProps): ReactElement {
  if (viewMode === "pr") {
    return (
      <FeaturePrView
        featureId={featureId}
        reviews={reviewThreads}
        selectedThreadIds={selectedReviewThreadIds}
        onThreadSelectedChange={onReviewThreadSelectedChange}
        onAllThreadsSelectedChange={onAllReviewThreadsSelectedChange}
        onViewThread={onViewReviewThread}
      />
    );
  }
  if (viewMode === "graph") {
    return (
      <GitGraphView featureId={featureId} registerNavigationAdapter={registerNavigationAdapter} />
    );
  }
  if (viewMode === "branches") {
    return (
      <GitBranchesView
        key={`${projectId}:${featureId}`}
        featureId={featureId}
        projectId={projectId}
        registerNavigationAdapter={registerNavigationAdapter}
      />
    );
  }
  if (viewMode === "stashes") {
    return (
      <StashesView
        featureId={featureId}
        onConflicts={onRequestUncommitted}
        registerNavigationAdapter={registerNavigationAdapter}
      />
    );
  }
  const reviewDiff = viewMode === "vs-target";
  return (
    <DiffViewer
      featureId={featureId}
      mode={diffMode}
      targetBranch={diffTargetBranch}
      fileListCollapsed={fileListCollapsed}
      onFileListCollapsedChange={onFileListCollapsedChange}
      registerNavigationAdapter={registerNavigationAdapter}
      afterToolbar={recoveryRegion}
      remoteThreadLinesByFile={reviewDiff ? remoteThreadLinesByFile : undefined}
      reviewCountsByFile={reviewDiff ? reviewCountsByFile : undefined}
      reviewTarget={reviewDiff ? reviewTarget : null}
      selectedReviewThreadIds={reviewDiff ? selectedReviewThreadIds : undefined}
      onReviewThreadSelectedChange={reviewDiff ? onReviewThreadSelectedChange : undefined}
    />
  );
});
