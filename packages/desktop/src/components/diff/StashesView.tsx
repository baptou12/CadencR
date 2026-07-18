import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { Virtuoso } from "react-virtuoso";
import { Loader2Icon, ArchiveIcon } from "lucide-react";
import { useListStashes, type StashEntry } from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { GitRevisionDiffView } from "./GitRevisionDiffView";
import { useOpenDiffInEditor } from "./OpenDiffInEditorContext";
import { StashRow, STASH_ROW_HEIGHT } from "./StashRow";
import type { StashConflictHandler, StashConflictOpenHandler } from "./stash-contracts";
import { useStashMutationCoordinator } from "./useStashMutationCoordinator";

export interface StashesViewProps {
  featureId: number;
  /** Route a recoverable apply/pop outcome to the Uncommitted Git view. */
  onConflicts?: StashConflictHandler;
  /** Optional Editor handoff override; defaults to the existing diff Editor context. */
  onOpenConflict?: StashConflictOpenHandler;
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
  onConflicts,
  onOpenConflict,
}: StashesViewProps): ReactElement {
  const [openedStash, setOpenedStash] = useState<StashEntry | null>(null);
  const handleCloseStash = useCallback((): void => setOpenedStash(null), []);
  const contextOpenConflict = useOpenDiffInEditor();
  const openConflict = onOpenConflict ?? contextOpenConflict;
  const mutationCoordinator = useStashMutationCoordinator();

  const { data, isLoading, isError, error, refetch } = useListStashes({
    feature_id: featureId,
  });
  const stashes = useMemo<StashEntry[]>(() => data ?? [], [data]);
  // The confirmed backend WS status follows the merged invalidation path. This
  // explicit refetch only lets the row wait for deterministic reflog ordinals;
  // it never writes or removes cached stashes itself.
  const refreshStashes = useCallback(async (): Promise<void> => {
    await refetch({ throwOnError: true });
  }, [refetch]);

  const itemContent = useCallback(
    (index: number): ReactElement => {
      const stash = stashes[index];
      if (!stash) return <div style={{ height: STASH_ROW_HEIGHT }} />;
      return (
        <StashRow
          featureId={featureId}
          stash={stash}
          onOpen={setOpenedStash}
          onConflicts={onConflicts}
          onOpenConflict={openConflict}
          onRefresh={refreshStashes}
          coordinator={mutationCoordinator}
        />
      );
    },
    [featureId, mutationCoordinator, onConflicts, openConflict, refreshStashes, stashes],
  );

  if (openedStash) {
    return (
      <GitRevisionDiffView
        featureId={featureId}
        revision={openedStash.sha}
        backLabel="Stashes"
        label={openedStash.ref_name}
        message={openedStash.message}
        onBack={handleCloseStash}
      />
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
