import {
  ExternalLinkIcon,
  GitCompareArrowsIcon,
  Loader2Icon,
  MessageSquareIcon,
  RefreshCwIcon,
  Settings2Icon,
} from "lucide-react";
import { memo, useCallback, useId, useState, type ReactElement } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { CommentThread } from "@/api/generated";
import { AuthorInitials, PrViewError, relativeTime } from "@/components/FeaturePrViewParts";
import { Markdown } from "@/components/Markdown";
import { PrCommentsFilterToggle, type PrCommentFilter } from "@/components/PrCommentsFilter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { openExternalUrl } from "@/lib/open-external";
import { isThreadAnchored, threadExternalHost } from "@/lib/pr-review-threads";
import { cn } from "@/lib/utils";

/**
 * One review thread in the PR timeline.
 *
 * The header line carries everything that decides whether the thread still
 * needs work: where it points, whether the diff has moved out from under it,
 * and whether the forge considers it settled.
 */
export const PrCommentThread = memo(function PrCommentThread({
  thread,
  selected = false,
  onSelectedChange,
  onViewThread,
}: {
  thread: CommentThread;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  onViewThread?: (thread: CommentThread) => void;
}): ReactElement {
  const context = thread.file
    ? `${thread.file}${thread.line != null ? `:${thread.line}` : ""}${
        thread.side === "old" ? " (removed side)" : ""
      }`
    : null;
  const selectable = thread.resolved !== true && onSelectedChange != null;
  const selectionId = useId();
  const contextLabel = (
    <span className="min-w-0 truncate font-mono text-muted-foreground" title={context ?? undefined}>
      {context ?? "Review thread"}
    </span>
  );
  return (
    <article
      data-selected={selected || undefined}
      className={cn(
        "mx-4 mb-3 overflow-hidden rounded-md border bg-card transition-[border-color,box-shadow]",
        selected ? "border-primary/60 ring-1 ring-primary/20" : "border-border",
        thread.resolved && "opacity-70",
      )}
    >
      {(context || thread.resolved != null || selectable) && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-[11px]">
          {selectable ? (
            <label
              htmlFor={selectionId}
              className="-my-1.5 flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5"
              title="Include this review thread when sending to the agent"
            >
              <Checkbox
                id={selectionId}
                checked={selected}
                onCheckedChange={(checked) => onSelectedChange(checked === true)}
                aria-label={`Select ${context ? `${context} ` : ""}review thread for the agent`}
                className="mr-0.5"
              />
              {contextLabel}
            </label>
          ) : (
            contextLabel
          )}
          <span className="flex shrink-0 items-center gap-1">
            {thread.outdated && (
              <Badge
                variant="outline"
                className="rounded-md px-1.5 py-0 text-[10px] font-medium text-muted-foreground"
                title="The diff moved since this comment was written, so its line no longer points at the current code"
              >
                outdated
              </Badge>
            )}
            {thread.resolved != null && (
              <Badge
                variant="outline"
                className={cn(
                  "rounded-md px-1.5 py-0 text-[10px] font-medium capitalize",
                  thread.resolved
                    ? "border-[var(--acc-green)]/40 bg-[var(--acc-green)]/10 text-[var(--acc-green)]"
                    : "border-[var(--acc-orange)]/40 bg-[var(--acc-orange)]/10 text-[var(--acc-orange)]",
                )}
              >
                {thread.resolved ? "resolved" : "open"}
              </Badge>
            )}
          </span>
        </div>
      )}
      <div className="divide-y divide-border">
        {thread.comments.map((comment, index) => (
          <div key={`${comment.created_at}:${index}`} className="space-y-2 px-3 py-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <AuthorInitials name={comment.author.display_name ?? comment.author.username} />
              <span className="truncate font-medium text-foreground">
                {comment.author.display_name ?? comment.author.username}
              </span>
              <span className="shrink-0 tabular-nums">{relativeTime(comment.created_at)}</span>
            </div>
            <Markdown
              content={comment.body_markdown}
              cacheKey={`${thread.id}:${comment.created_at}:${index}`}
              className="max-w-prose text-[13px] leading-relaxed"
            />
          </div>
        ))}
      </div>
      <ThreadActions thread={thread} onViewThread={onViewThread} />
    </article>
  );
});

function ThreadActions({
  thread,
  onViewThread,
}: {
  thread: CommentThread;
  onViewThread?: (thread: CommentThread) => void;
}): ReactElement | null {
  const url = thread.comments.find((comment) => comment.url)?.url ?? null;
  const host = threadExternalHost(thread);
  const [opening, setOpening] = useState(false);
  const open = useCallback(async (): Promise<void> => {
    if (!url) return;
    setOpening(true);
    await openExternalUrl(url, "Could not open this review thread.");
    setOpening(false);
  }, [url]);
  const canView = !!onViewThread && isThreadAnchored(thread) && thread.resolved !== true;
  if (!url && !canView) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1 border-t border-border bg-card/40 px-2 py-1.5">
      {canView && (
        <Button variant="ghost" size="xs" onClick={() => onViewThread(thread)}>
          <GitCompareArrowsIcon className="size-3" aria-hidden />
          View in diff
        </Button>
      )}
      {url && (
        <Button variant="ghost" size="xs" disabled={opening} onClick={() => void open()}>
          {opening ? (
            <Loader2Icon className="size-3 animate-spin" aria-hidden />
          ) : (
            <ExternalLinkIcon className="size-3" aria-hidden />
          )}
          Reply on {host ?? "remote"}
        </Button>
      )}
    </div>
  );
}

export function CommentsHeader({
  commentsLoading,
  commentsRefreshing,
  commentsError,
  onRetry,
  commentCount,
  unresolvedCount,
  totalCount,
  filter,
  onFilterChange,
  selectionEnabled = false,
}: {
  commentsLoading: boolean;
  commentsRefreshing: boolean;
  commentsError: string | undefined;
  onRetry: () => void;
  /** Threads currently listed, i.e. after the filter is applied. */
  commentCount: number;
  unresolvedCount: number;
  totalCount: number;
  filter: PrCommentFilter;
  onFilterChange: (next: PrCommentFilter) => void;
  selectionEnabled?: boolean;
}): ReactElement {
  const showFilter = !commentsLoading && !commentsError && totalCount > 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        <MessageSquareIcon className="size-3.5 text-muted-foreground" aria-hidden />
        <h3 className="text-[12.5px] font-semibold tracking-tight">Review threads</h3>
        {commentsLoading && (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
            role="status"
          >
            <Loader2Icon className="size-3 animate-spin" aria-hidden /> Loading…
          </span>
        )}
        {showFilter && (
          <PrCommentsFilterToggle
            value={filter}
            unresolvedCount={unresolvedCount}
            totalCount={totalCount}
            onChange={onFilterChange}
          />
        )}
      </div>
      {selectionEnabled && (
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Check the review threads you want to send to the agent, then click{" "}
          <span className="font-medium text-foreground">Send X threads</span> below.
        </p>
      )}
      {commentsError && (
        <CommentsError
          message={commentsError}
          isRefreshing={commentsRefreshing}
          onRetry={onRetry}
        />
      )}
      {!commentsLoading && !commentsError && commentCount === 0 && (
        <p className="pb-2 text-[12.5px] text-muted-foreground">
          {totalCount === 0
            ? "No review threads yet."
            : "Nothing unresolved — every review thread on this proposal is resolved."}
        </p>
      )}
    </div>
  );
}

function CommentsError({
  message,
  isRefreshing,
  onRetry,
}: {
  message: string;
  isRefreshing: boolean;
  onRetry: () => void;
}): ReactElement {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-56 flex-1">
        <PrViewError message={message} compact />
      </div>
      <Button variant="outline" size="xs" disabled={isRefreshing} onClick={onRetry}>
        {isRefreshing ? (
          <Loader2Icon className="size-3 animate-spin" aria-hidden />
        ) : (
          <RefreshCwIcon className="size-3" aria-hidden />
        )}
        Retry
      </Button>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => void navigate({ to: "/settings", search: { section: "git" } })}
      >
        <Settings2Icon className="size-3" aria-hidden />
        Git settings
      </Button>
    </div>
  );
}
