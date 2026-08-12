import { useEffect, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetFeatureAgentStateQueryKey, type FeatureAgentStateResponse } from "@/api/generated";
import { readAgentStateCache, writeAgentStateCache } from "@/lib/agentStateCache";

/**
 * Hydrate React Query's `agent-state` cache from IndexedDB on mount/feature
 * change so the agent stream paints before the network resolves, and persist
 * every successful fetch back to IDB (throttled) for the next cold open.
 *
 * The hydrate is read-only — we never write speculative state, only
 * re-seed a previously-successful server response (per
 * `.claude/rules/no-optimistic-updates.md`). The existing
 * `placeholderData` and `isLoading` indicators continue to drive the UI
 * (per `.claude/rules/explicit-state.md`).
 *
 * @param featureId The current feature id.
 * @param latestData The most recent successful query data, or `undefined`.
 * @param prevFeatureIdRef Ref tracked by the parent — guards against
 *   painting cached data for a feature the user already navigated away from.
 * @param initialLimit The `limit` param used by the initial fetch, so the
 *   seeded cache key matches the key React Query will look up.
 */
export function useAgentStateIdbCache(
  featureId: number,
  latestData: FeatureAgentStateResponse | undefined,
  prevFeatureIdRef: RefObject<number>,
  initialLimit: number,
): void {
  const queryClient = useQueryClient();

  // IDB hydrate: only seed when the query slot is empty AND the user is
  // still on the same feature by the time IDB resolves.
  useEffect(() => {
    let cancelled = false;
    const targetFeatureId = featureId;
    void readAgentStateCache(targetFeatureId).then((cached) => {
      if (cancelled || cached == null) return;
      if (prevFeatureIdRef.current !== targetFeatureId) return;
      const key = getGetFeatureAgentStateQueryKey(targetFeatureId, {
        after: undefined,
        limit: initialLimit,
      });
      const existing = queryClient.getQueryData<FeatureAgentStateResponse>(key);
      if (existing) return;
      queryClient.setQueryData<FeatureAgentStateResponse>(key, cached);
    });
    return () => {
      cancelled = true;
    };
  }, [featureId, initialLimit, prevFeatureIdRef, queryClient]);

  // Persist every successful response so the next cold open can hydrate.
  useEffect(() => {
    if (!latestData) return;
    void writeAgentStateCache(featureId, latestData);
  }, [featureId, latestData]);
}
