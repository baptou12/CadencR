/**
 * Shared handler for `feature.updated` WebSocket events.
 * Maps changed aspect names to React Query cache invalidations.
 */
import { queryClient } from "@/lib/queryClient";
import {
  getGetFeatureQueryKey,
  getGetFeaturePrdQueryKey,
  getGetFeaturePlanQueryKey,
  getGetFeaturePlanProgressQueryKey,
  getGetFeatureSettingsQueryKey,
} from "@/api/generated";

/** Valid values for the `changed` array in a `feature.updated` payload. */
export type FeatureChangedField = "title" | "plan" | "prd" | "phases" | "progress" | "settings" | "status";

const FIELD_TO_QUERY_KEY: Record<FeatureChangedField, (id: number) => readonly unknown[]> = {
  title: getGetFeatureQueryKey,
  plan: getGetFeaturePlanQueryKey,
  prd: getGetFeaturePrdQueryKey,
  phases: getGetFeaturePlanQueryKey,
  progress: getGetFeaturePlanProgressQueryKey,
  settings: getGetFeatureSettingsQueryKey,
  status: getGetFeatureQueryKey,
};

/**
 * Invalidate React Query caches for the given feature based on which aspects changed.
 * Deduplicates query keys so each is invalidated at most once.
 */
export function invalidateFeatureQueries(featureId: number, changed: string[]): void {
  const seen = new Set<string>();
  for (const field of changed) {
    const getKey = FIELD_TO_QUERY_KEY[field as FeatureChangedField];
    if (!getKey) continue;
    const queryKey = getKey(featureId);
    const keyStr = JSON.stringify(queryKey);
    if (seen.has(keyStr)) continue;
    seen.add(keyStr);
    queryClient.invalidateQueries({ queryKey });
  }
  // When the feature status changes, also invalidate the feature list so the
  // sidebar/project view picks up the new status badge.
  if (changed.includes("status")) {
    void queryClient.invalidateQueries({ queryKey: ["features", "list"], exact: false });
  }
}
