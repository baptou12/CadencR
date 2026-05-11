import { useQueryClient } from "@tanstack/react-query";
import {
  getFeatureAgentState,
  getGetFeatureAgentStateQueryKey,
  getBranch,
  getGetBranchQueryKey,
  getStats,
  getGetStatsQueryKey,
} from "@/api/generated";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";

/**
 * Debounced prefetch for the small, always-fetched-on-open queries of a
 * feature row: agent-state, git branch (per project), git stats. Wire onto
 * `onMouseEnter` and `onFocus` so keyboard users get the same warm-cache
 * benefit (per `keyboard-shortcuts.md`).
 *
 * The 150 ms debounce stops a fast cursor sweep across the sidebar from
 * firing dozens of requests; a single prefetch lands once the user pauses
 * on a row.
 */
export function useFeaturePrefetch(
  featureId: number | undefined,
  projectId: number | undefined,
): () => void {
  const queryClient = useQueryClient();

  return useDebouncedCallback(() => {
    if (featureId == null) return;
    void queryClient.prefetchQuery({
      queryKey: getGetFeatureAgentStateQueryKey(featureId),
      queryFn: ({ signal }) => getFeatureAgentState(featureId, undefined, signal),
    });
    void queryClient.prefetchQuery({
      queryKey: getGetStatsQueryKey({ feature_id: featureId }),
      queryFn: ({ signal }) => getStats({ feature_id: featureId }, signal),
    });
    if (projectId != null) {
      void queryClient.prefetchQuery({
        queryKey: getGetBranchQueryKey({ project_id: projectId }),
        queryFn: ({ signal }) => getBranch({ project_id: projectId }, signal),
      });
    }
  }, 150);
}
