import { useEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getListFeatureActivityQueryOptions,
  getListFeatureWorktreesQueryOptions,
  type Feature,
  type FeatureActivity,
  type FeatureWorktreeInfo,
} from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import {
  FEATURE_ACTIVITY_ERROR_TOAST_ID,
  FEATURE_ACTIVITY_POLL_MS,
  FEATURE_WORKTREES_STALE_MS,
  featureActivityParams,
} from "@/lib/sidebar-queries";

interface QueryResult<T> {
  data?: T;
  error: unknown;
}

// Module-level so TanStack can memoize the combined result between renders.
function combineActivity(results: QueryResult<FeatureActivity[]>[]) {
  return {
    error: results.find((result) => result.error)?.error ?? null,
    counts: new Map(
      results.flatMap((result) =>
        (result.data ?? []).map((item) => [item.feature_id, item.shell_count] as const),
      ),
    ),
  };
}

function combineWorktrees(results: QueryResult<FeatureWorktreeInfo[]>[]) {
  return {
    error: results.find((result) => result.error)?.error ?? null,
    live: new Set(
      results.flatMap((result) =>
        (result.data ?? []).filter((worktree) => worktree.live).map((w) => w.feature_id),
      ),
    ),
  };
}

export interface PinnedActivity {
  shellCountByFeatureId: ReadonlyMap<number, number>;
  liveWorktreeFeatureIds: ReadonlySet<number>;
}

/**
 * Shell counts and live worktrees for the pinned section: one activity and one
 * worktrees query per distinct project, with the project sections' keys and
 * options so an expanded project shares the same cache entries.
 */
export function usePinnedActivity(pinned: readonly Feature[]): PinnedActivity {
  const projectIds = useMemo(
    () => [...new Set(pinned.map((feature) => feature.project_id))].sort((a, b) => a - b),
    [pinned],
  );
  const activity = useQueries({
    queries: projectIds.map((projectId) =>
      getListFeatureActivityQueryOptions(featureActivityParams(projectId), {
        query: { refetchInterval: FEATURE_ACTIVITY_POLL_MS },
      }),
    ),
    combine: combineActivity,
  });
  const worktrees = useQueries({
    queries: projectIds.map((projectId) =>
      getListFeatureWorktreesQueryOptions(
        { project_id: projectId },
        { query: { staleTime: FEATURE_WORKTREES_STALE_MS } },
      ),
    ),
    combine: combineWorktrees,
  });

  useEffect(() => {
    if (!activity.error) return;
    toast.error(apiErrorMessage(activity.error, "Failed to load sidebar activity"), {
      id: FEATURE_ACTIVITY_ERROR_TOAST_ID,
    });
  }, [activity.error]);
  useEffect(() => {
    if (!worktrees.error) return;
    toast.error(apiErrorMessage(worktrees.error, "Failed to load worktrees"), {
      id: "sidebar-worktrees-load-error",
    });
  }, [worktrees.error]);

  return useMemo(
    () => ({ shellCountByFeatureId: activity.counts, liveWorktreeFeatureIds: worktrees.live }),
    [activity.counts, worktrees.live],
  );
}
