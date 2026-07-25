import { useMemo } from "react";
import { useGetStats } from "@/api/generated";
import type { GitViewMode } from "./GitTabToggle";
import type { DiffMode } from "./useDiffData";

export interface GitTabPanes {
  /** Views that drive their own list body and per-row stats. */
  isListView: boolean;
  isPr: boolean;
  diffMode: DiffMode;
  diffTargetBranch: string | undefined;
  stats: { isLoading: boolean; isError: boolean; additions?: number; deletions?: number };
}

/**
 * Translates the active sub-view into the parameters the diff endpoints want,
 * and fetches the diff-wide stat line the toolbar shows.
 */
export function useGitTabPanes(
  featureId: number,
  viewMode: GitViewMode,
  targetBranch: string | undefined,
): GitTabPanes {
  const isPr = viewMode === "pr";
  const isListView =
    isPr || viewMode === "graph" || viewMode === "branches" || viewMode === "stashes";
  // "uncommitted" hits the working-tree path on the server (an alias of the
  // legacy "worktree" mode); "vs-target" pins the diff to the resolved branch.
  const diffMode: DiffMode = viewMode === "vs-target" ? "branch" : "uncommitted";
  const diffTargetBranch = viewMode === "vs-target" ? targetBranch : undefined;
  // Stats are byte-identical for "worktree" and "uncommitted" on the backend,
  // so label the working-tree query "worktree" — the value ProjectFeatureRow and
  // the prefetch use — to share one cache entry instead of firing a duplicate
  // under the "uncommitted" key while the Git tab is open.
  const statsQuery = useGetStats(
    {
      feature_id: featureId,
      mode: viewMode === "vs-target" ? "branch" : "worktree",
      target_branch: diffTargetBranch,
    },
    // The list views carry their own per-row stats, so skip the request.
    { query: { enabled: !isListView } },
  );

  return useMemo(
    () => ({
      isListView,
      isPr,
      diffMode,
      diffTargetBranch,
      stats: {
        isLoading: statsQuery.isLoading,
        isError: statsQuery.isError,
        additions: statsQuery.data?.insertions,
        deletions: statsQuery.data?.deletions,
      },
    }),
    [
      diffMode,
      diffTargetBranch,
      isListView,
      isPr,
      statsQuery.data?.deletions,
      statsQuery.data?.insertions,
      statsQuery.isError,
      statsQuery.isLoading,
    ],
  );
}
