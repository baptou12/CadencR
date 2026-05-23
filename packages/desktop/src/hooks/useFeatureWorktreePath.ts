import { useMemo } from "react";
import { useGetFeatureSettings } from "@/api/generated";

/**
 * Worktree path for a feature, or `null` when the feature works directly in
 * the project root. Backed by the `worktree_path` entry in the feature's
 * settings — the `feature.updated` WS event invalidates this query when a
 * worktree is created or removed, so the value stays reactive without extra
 * wiring.
 *
 * Two-or-more call sites pattern: kept here so callers don't re-do the
 * `settings.find(...).value` lookup (and don't need to mock the generated
 * client in their tests).
 */
export function useFeatureWorktreePath(featureId: number): string | null {
  const { data } = useGetFeatureSettings(featureId);
  return useMemo(() => data?.find((s) => s.key === "worktree_path")?.value ?? null, [data]);
}
