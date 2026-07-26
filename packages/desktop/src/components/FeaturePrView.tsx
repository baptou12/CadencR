import { ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { memo, useCallback, useRef, useState, type ReactElement, type WheelEvent } from "react";
import { Virtuoso } from "react-virtuoso";
import { useNavigate } from "@tanstack/react-router";
import {
  useGetPr,
  type CommentThread,
  type PrStatusSnapshot,
  type ReviewState,
} from "@/api/generated";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DEFAULT_PR_COMMENT_FILTER, type PrCommentFilter } from "@/components/PrCommentsFilter";
import type { PrReviewThreads } from "@/hooks/usePrReviewThreads";
import { apiErrorMessage } from "@/lib/api-errors";
import { FORGE_SETTINGS_ANCHOR } from "@/lib/settings-anchors";
import { openPullRequestExternally } from "@/lib/open-pull-request";
import { selectPrStatus, usePrStatusStore } from "@/stores/usePrStatusStore";
import { cn } from "@/lib/utils";
import { PrCommentThread } from "@/components/FeaturePrComments";
import {
  AuthorInitials,
  ChecksPanel,
  EmptyState,
  PrEmptyIcon,
  PrViewError,
  PrViewLoading,
  relativeTime,
} from "@/components/FeaturePrViewParts";
import {
  TIMELINE_COMPONENTS,
  useTimelineContext,
  type TimelineHeaderSource,
} from "@/components/PrTimelineSlots";
import {
  PR_TONE_BADGE,
  prIndicatorTone,
  type PrIndicatorTone,
} from "@/components/PrStatusIndicators";

interface FeaturePrViewProps {
  featureId: number;
  reviews: PrReviewThreads;
  selectedThreadIds?: ReadonlySet<string>;
  onThreadSelectedChange?: (threadId: string, selected: boolean) => void;
  onAllThreadsSelectedChange?: (selected: boolean) => void;
  onViewThread?: (thread: CommentThread) => void;
}

export function reviewStateLabel(reviewState: ReviewState): string | null {
  if (reviewState === "none") return null;
  if (reviewState === "changes_requested") return "changes requested";
  if (reviewState === "pending") return "review pending";
  return "approved";
}

function reviewTone(reviewState: ReviewState): PrIndicatorTone {
  if (reviewState === "changes_requested" || reviewState === "pending") return "blocked";
  if (reviewState === "approved") return "ready";
  return "neutral";
}

export const FeaturePrView = memo(function FeaturePrView({
  featureId,
  reviews,
  selectedThreadIds,
  onThreadSelectedChange,
  onAllThreadsSelectedChange,
  onViewThread,
}: FeaturePrViewProps): ReactElement {
  const cached = usePrStatusStore(selectPrStatus(featureId));
  const summaryQuery = useGetPr(
    { feature_id: featureId },
    { query: { enabled: cached === undefined, retry: false } },
  );
  const status = cached ?? summaryQuery.data;
  const [filter, setFilter] = useState<PrCommentFilter>(DEFAULT_PR_COMMENT_FILTER);

  if (summaryQuery.isLoading && !status) return <PrViewLoading />;
  if (summaryQuery.isError && !status) {
    return (
      <PrViewError
        message={apiErrorMessage(summaryQuery.error, "Could not load pull request status")}
      />
    );
  }
  if (status?.setup_required) return <ForgeConnectEmptyState reason={status.error} />;
  if (status?.error && !status.pr) return <PrViewError message={status.error} />;
  if (!status?.pr) return <NoPrEmptyState />;

  return (
    <PrTimeline
      status={status}
      threads={filter === "unresolved" ? reviews.unresolved : reviews.threads}
      unresolvedCount={reviews.unresolvedCount}
      totalCount={reviews.threads.length}
      filter={filter}
      onFilterChange={setFilter}
      commentsLoading={reviews.isLoading}
      commentsRefreshing={reviews.isRefreshing}
      commentsError={reviews.errorMessage}
      onCommentsRetry={reviews.retry}
      selectedThreadIds={selectedThreadIds}
      onThreadSelectedChange={onThreadSelectedChange}
      onAllThreadsSelectedChange={onAllThreadsSelectedChange}
      onViewThread={onViewThread}
    />
  );
});

/**
 * A wheel delta in the scroller's own units. Browsers report lines (Firefox) or
 * pages as readily as pixels, and treating a 3-line scroll as 3px would leave
 * the band feeling dead — the very thing forwarding the gesture is there to fix.
 */
function wheelPixels(deltaY: number, deltaMode: number, viewportHeight: number): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * viewportHeight;
  return deltaY;
}

interface PrTimelineProps extends TimelineHeaderSource {
  onViewThread?: (thread: CommentThread) => void;
}

/**
 * Identity (title, state, author, branches) and the check rollup stay pinned
 * above the scroller — reading the 40th comment thread shouldn't cost you the
 * answer to "which PR is this, and is it green?". Only the description and the
 * threads scroll. The checks list folds itself away as soon as you leave the
 * top so the pinned band stays a band, and unfolds when you come back.
 */
function PrTimeline(props: PrTimelineProps): ReactElement {
  const [scrolledPastTop, setScrolledPastTop] = useState(false);
  const band = usePinnedBandWheel();
  const { selectedThreadIds, onThreadSelectedChange, onViewThread, status, threads } = props;
  const listContext = useTimelineContext(props);
  const itemContent = useCallback(
    (_index: number, thread: CommentThread) => (
      <div className="pb-3">
        <PrCommentThread
          thread={thread}
          selected={selectedThreadIds?.has(thread.id) ?? false}
          onSelectedChange={
            onThreadSelectedChange
              ? (selected) => onThreadSelectedChange(thread.id, selected)
              : undefined
          }
          onViewThread={onViewThread}
        />
      </div>
    ),
    [onThreadSelectedChange, onViewThread, selectedThreadIds],
  );
  const handleAtTopStateChange = useCallback((atTop: boolean) => setScrolledPastTop(!atTop), []);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="shrink-0 space-y-3 border-b border-border bg-card/40 px-4 py-3"
        onWheel={band.onWheel}
      >
        {status.error && <PrViewError message={status.error} compact />}
        <PrHeader status={status} />
        <ChecksPanel status={status} collapsedByScroll={scrolledPastTop} />
      </div>
      <Virtuoso
        className="min-h-0 flex-1"
        data={threads}
        context={listContext}
        components={TIMELINE_COMPONENTS}
        itemContent={itemContent}
        increaseViewportBy={400}
        atTopThreshold={8}
        atTopStateChange={handleAtTopStateChange}
        scrollerRef={band.scrollerRef}
      />
    </div>
  );
}

/**
 * The pinned band is not scrollable, so a wheel gesture over it would land
 * nowhere and read as a frozen pane. Forwarding it to the list's scroller keeps
 * the whole pane feeling like one surface.
 */
function usePinnedBandWheel(): {
  scrollerRef: (element: HTMLElement | Window | null) => void;
  onWheel: (event: WheelEvent<HTMLDivElement>) => void;
} {
  const scroller = useRef<HTMLElement | null>(null);
  const scrollerRef = useCallback((element: HTMLElement | Window | null) => {
    scroller.current = element instanceof HTMLElement ? element : null;
  }, []);
  const onWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const element = scroller.current;
    if (!element || event.deltaY === 0) return;
    element.scrollTop += wheelPixels(event.deltaY, event.deltaMode, element.clientHeight);
  }, []);
  return { scrollerRef, onWheel };
}

function PrHeader({ status }: { status: PrStatusSnapshot }): ReactElement {
  const pr = status.pr!;
  const reviewLabel = reviewStateLabel(pr.review_state);
  const stateTone = prIndicatorTone(status);
  const [opening, setOpening] = useState(false);
  const handleOpen = useCallback(async (): Promise<void> => {
    setOpening(true);
    await openPullRequestExternally(pr);
    setOpening(false);
  }, [pr]);
  const branchTitle = `${pr.source_branch} → ${pr.target_branch}`;

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn("rounded-md", PR_TONE_BADGE[stateTone])}>
            {pr.state}
          </Badge>
          {reviewLabel && (
            <Badge
              variant="outline"
              className={cn("rounded-md", PR_TONE_BADGE[reviewTone(pr.review_state)])}
            >
              {reviewLabel}
            </Badge>
          )}
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {pr.pr_label} #{pr.number}
          </span>
          <span aria-hidden className="text-[11px] text-border">
            ·
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            updated {relativeTime(pr.updated_at)}
          </span>
        </div>
        <h2 className="text-base font-semibold leading-snug text-balance text-foreground">
          {pr.title}
        </h2>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <AuthorInitials name={pr.author.display_name ?? pr.author.username} />
          <span className="truncate">{pr.author.display_name ?? pr.author.username}</span>
          <span aria-hidden className="text-border">
            ·
          </span>
          <span
            className="inline-flex min-w-0 max-w-full items-center gap-1 font-mono"
            title={branchTitle}
          >
            <span className="truncate">{pr.source_branch}</span>
            <span aria-hidden className="shrink-0">
              →
            </span>
            <span className="shrink-0 truncate">{pr.target_branch}</span>
          </span>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-8 shrink-0 gap-1.5"
        disabled={opening}
        onClick={() => void handleOpen()}
      >
        {opening ? (
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <ExternalLinkIcon className="size-3.5" aria-hidden />
        )}
        Open
      </Button>
    </div>
  );
}

/**
 * The pane's onboarding state: this feature has a remote, but the forge behind
 * it isn't usable yet. The button is the point — the fix lives in a card partway
 * down a different route, which nobody finds from an error saying "in Settings".
 *
 * `reason` goes in the detail slot rather than the description because it is not
 * always prose: a rejected call carries the forge's own body, which can be JSON.
 */
function ForgeConnectEmptyState({ reason }: { reason?: string | null }): ReactElement {
  const navigate = useNavigate();
  return (
    <EmptyState
      title="Connect this remote"
      // Deliberately not a second "…to load pull requests, checks, and comments":
      // the backend's reason already says that, and the two stacked read as a
      // stutter. This line states the situation, `detail` gives the specifics.
      description="Cadencr can't reach the forge behind this remote yet."
      detail={reason}
      icon={<PrEmptyIcon />}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void navigate({ to: "/settings", search: { section: FORGE_SETTINGS_ANCHOR } })
          }
        >
          Connect a provider
        </Button>
      }
    />
  );
}

function NoPrEmptyState(): ReactElement {
  return (
    <EmptyState
      title="No open pull request"
      description="Push this branch and open a pull request or merge request to see its summary here."
      icon={<PrEmptyIcon />}
    />
  );
}
