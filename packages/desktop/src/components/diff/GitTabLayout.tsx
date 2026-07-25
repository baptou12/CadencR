import type { ReactElement, ReactNode } from "react";
import { GitReviewStatus } from "./GitReviewStatus";
import { GitSendCommentsBar, type GitSendCommentsBarProps } from "./GitSendCommentsBar";
import { GitTabBody, type GitTabBodyProps } from "./GitTabBody";
import { GitTabToolbar, type GitTabToolbarProps } from "./GitTabToolbar";
import type { GitTabReviews } from "./useGitTabReviews";

export interface GitTabLayoutProps {
  toolbar: GitTabToolbarProps;
  body: GitTabBodyProps;
  send: GitSendCommentsBarProps;
  reviews: GitTabReviews;
  /** Rendered above the body for the list views, which have no diff toolbar. */
  recoveryRegion: ReactNode;
}

/** Toolbar, review status, active pane, send bar — top to bottom. */
export function GitTabLayout({
  toolbar,
  body,
  send,
  reviews,
  recoveryRegion,
}: GitTabLayoutProps): ReactElement {
  return (
    <div className="flex h-full flex-col">
      <GitTabToolbar {...toolbar} />
      {/* The PR view reports its own comment state inline; only the branch diff
          needs this strip, to keep a pending or failed fetch from reading as a
          review with nothing left to address. */}
      {body.viewMode === "vs-target" && reviews.visible && (
        <GitReviewStatus
          isLoading={reviews.isLoading}
          isRefreshing={reviews.isRefreshing}
          errorMessage={reviews.errorMessage}
          summary={reviews.summary}
          activePosition={reviews.activePosition}
          targetCount={reviews.targetCount}
          onRetry={reviews.retry}
          onPrevious={reviews.previousThread}
          onNext={reviews.nextThread}
        />
      )}
      {toolbar.isListView && recoveryRegion}
      <div className="min-h-0 flex-1 overflow-hidden">
        <GitTabBody {...body} />
      </div>
      <GitSendCommentsBar {...send} />
    </div>
  );
}
