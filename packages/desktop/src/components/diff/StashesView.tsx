import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { Virtuoso } from "react-virtuoso";
import { Loader2Icon, ArchiveIcon, ArrowLeftIcon } from "lucide-react";
import { useListStashes, type StashEntry } from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { DiffViewer } from "./DiffViewer";
import { StashRow, STASH_ROW_HEIGHT } from "./StashRow";

interface StashesViewProps {
  featureId: number;
}

/**
 * Stashes view for the Git tab: the `git stash list` entries (reflog selector,
 * description, date and numstat). Clicking a stash opens its diff by reusing the
 * shared `commit_sha` diff pipeline — a stash is a commit, so `DiffViewer` with
 * `commitSha={stash.sha}` renders `git diff <sha>^..<sha>`, exactly the stashed
 * changes. Virtualized so a long stash list can't jank the streaming area.
 */
export const StashesView = memo(function StashesView({
  featureId,
}: StashesViewProps): ReactElement {
  const [openedStash, setOpenedStash] = useState<StashEntry | null>(null);

  const { data, isLoading, isError, error } = useListStashes({ feature_id: featureId });
  const stashes = useMemo<StashEntry[]>(() => data ?? [], [data]);

  const itemContent = useCallback(
    (index: number): ReactElement => {
      const stash = stashes[index];
      if (!stash) return <div style={{ height: STASH_ROW_HEIGHT }} />;
      return <StashRow stash={stash} onOpen={setOpenedStash} />;
    },
    [stashes],
  );

  // ---- Single-stash diff overlay ----
  if (openedStash) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <button
            type="button"
            onClick={() => setOpenedStash(null)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            Stashes
          </button>
          <span className="shrink-0 font-mono text-xs text-primary">{openedStash.ref_name}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">
            {openedStash.message}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <DiffViewer featureId={featureId} mode="worktree" commitSha={openedStash.sha} />
        </div>
      </div>
    );
  }

  if (isLoading && stashes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        Loading stashes…
      </div>
    );
  }

  if (isError) {
    const message = apiErrorMessage(error, "Could not load stashes");
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">
        {message}
      </div>
    );
  }

  if (stashes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <ArchiveIcon className="size-5" />
        No stashes.
      </div>
    );
  }

  return (
    <div className="h-full">
      <Virtuoso
        style={{ height: "100%" }}
        totalCount={stashes.length}
        itemContent={itemContent}
        increaseViewportBy={STASH_ROW_HEIGHT * 6}
      />
    </div>
  );
});
