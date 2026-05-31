import type { QueryClient } from "@tanstack/react-query";

import { getGetCustomActionRunsQueryKey, getListCustomActionsQueryKey } from "@/api/generated";

interface InvalidateCustomActionRunArgs {
  queryClient: QueryClient;
  projectId: number;
  actionId: number;
  featureId: number;
}

/**
 * Refresh the queries a custom-action run/cancel affects: the action's run
 * history and the project's action list (which carries the live status dot).
 * Shared by the inline run button, the details panel and the cancel flow so all
 * three surfaces update identically without waiting for the 2s poll.
 */
export function invalidateCustomActionRunQueries({
  queryClient,
  projectId,
  actionId,
  featureId,
}: InvalidateCustomActionRunArgs): void {
  queryClient.invalidateQueries({
    queryKey: getGetCustomActionRunsQueryKey(actionId, { feature_id: featureId }),
  });
  queryClient.invalidateQueries({
    queryKey: getListCustomActionsQueryKey({ project_id: projectId, feature_id: featureId }),
  });
}
