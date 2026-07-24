import { ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { Virtuoso } from "react-virtuoso";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import {
  useGetPr,
  useGetPrComments,
  type CommentThread,
  type PrStatusSnapshot,
  type ReviewState,
} from "@/api/generated";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiErrorMessage } from "@/lib/api-errors";
import { desktopBridge } from "@/lib/desktop-bridge";
import { selectPrStatus, usePrStatusStore } from "@/stores/usePrStatusStore";
import { cn } from "@/lib/utils";
import {
  AuthorInitials,
  ChecksPanel,
  CommentsHeader,
  EmptyState,
  PrCommentThread,
  PrDescription,
  PrEmptyIcon,
  PrViewError,
  PrViewLoading,
  relativeTime,
} from "@/components/FeaturePrViewParts";
import {
  PR_TONE_BADGE,
  prIndicatorTone,
  type PrIndicatorTone,
} from "@/components/PrStatusIndicators";

interface FeaturePrViewProps {
  featureId: number;
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
}: FeaturePrViewProps): ReactElement {
  const cached = usePrStatusStore(selectPrStatus(featureId));
  const summaryQuery = useGetPr(
    { feature_id: featureId },
    { query: { enabled: cached === undefined, retry: false } },
  );
  const status = cached ?? summaryQuery.data;
  const commentsQuery = useGetPrComments(
    { feature_id: featureId },
    { query: { enabled: status?.pr != null, retry: false } },
  );
  const threads = commentsQuery.data?.threads ?? [];

  if (summaryQuery.isLoading && !status) return <PrViewLoading />;
  if (summaryQuery.isError && !status) {
    return (
      <PrViewError message={apiErrorMessage(summaryQuery.error, "Could not load PR status")} />
    );
  }
  if (status?.auth_required) return <ForgeConnectEmptyState />;
  if (status?.error && !status.pr) return <PrViewError message={status.error} />;
  if (!status?.pr) return <NoPrEmptyState />;

  return (
    <PrTimeline
      status={status}
      threads={threads}
      commentsLoading={commentsQuery.isLoading}
      commentsError={
        commentsQuery.isError
          ? apiErrorMessage(commentsQuery.error, "Could not load comments")
          : undefined
      }
    />
  );
});

function PrTimeline({
  status,
  threads,
  commentsLoading,
  commentsError,
}: {
  status: PrStatusSnapshot;
  threads: CommentThread[];
  commentsLoading: boolean;
  commentsError: string | undefined;
}): ReactElement {
  const itemContent = useCallback(
    (_index: number, thread: CommentThread) => <PrCommentThread thread={thread} />,
    [],
  );
  const components = useMemo(
    () => ({
      Header: () => (
        <PrOverview
          status={status}
          commentsLoading={commentsLoading}
          commentsError={commentsError}
          commentCount={threads.length}
        />
      ),
    }),
    [commentsError, commentsLoading, status, threads.length],
  );
  return (
    <Virtuoso
      className="h-full"
      data={threads}
      components={components}
      itemContent={itemContent}
      increaseViewportBy={400}
    />
  );
}

function PrOverview({
  status,
  commentsLoading,
  commentsError,
  commentCount,
}: {
  status: PrStatusSnapshot;
  commentsLoading: boolean;
  commentsError: string | undefined;
  commentCount: number;
}): ReactElement {
  return (
    <div className="space-y-4 p-4">
      {status.error && <PrViewError message={status.error} compact />}
      <PrHeader status={status} />
      <ChecksPanel status={status} />
      <PrDescription status={status} />
      <CommentsHeader
        commentsLoading={commentsLoading}
        commentsError={commentsError}
        commentCount={commentCount}
      />
    </div>
  );
}

function PrHeader({ status }: { status: PrStatusSnapshot }): ReactElement {
  const pr = status.pr!;
  const reviewLabel = reviewStateLabel(pr.review_state);
  const stateTone = prIndicatorTone(status);
  const [opening, setOpening] = useState(false);
  const handleOpen = useCallback(async (): Promise<void> => {
    setOpening(true);
    try {
      await desktopBridge.openExternal(pr.url);
    } catch (error) {
      toast.error(`Could not open ${pr.pr_label}.`, {
        description: apiErrorMessage(error, "External link failed"),
      });
    } finally {
      setOpening(false);
    }
  }, [pr.pr_label, pr.url]);
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
            {pr.pr_label} {pr.number}
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
          <span aria-hidden className="text-border">
            ·
          </span>
          <span className="shrink-0 tabular-nums">updated {relativeTime(pr.updated_at)}</span>
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

function ForgeConnectEmptyState(): ReactElement {
  const navigate = useNavigate();
  return (
    <EmptyState
      title="Connect this forge"
      description="Add an API token before Cadencr can load pull requests, checks, and comments."
      icon={<PrEmptyIcon />}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void navigate({ to: "/settings", search: { section: "forges" } })}
        >
          Open Forge settings
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
