/**
 * Returns the live WS-pushed feature title (from auto-naming), or null if
 * no rename has been received yet. Reads from the ws-session store.
 *
 * Consumers should fall back to the HTTP-fetched title when this returns null.
 */
import { useMemo } from "react";

import { useWsSessionStore } from "@/stores/ws-session-store";
import { wsSessionIdFromFeature } from "@/lib/ws-session-id";

export interface FeatureTitleState {
  title: string | null;
  isAutoNaming: boolean;
}

export function useFeatureTitle(featureId: number): FeatureTitleState {
  const sessionTitle = useWsSessionStore(
    (s) => s.sessions[wsSessionIdFromFeature(featureId)]?.featureTitle ?? null,
  );
  const sessionAutoNaming = useWsSessionStore(
    (s) => s.sessions[wsSessionIdFromFeature(featureId)]?.isAutoNaming ?? false,
  );
  return useMemo(
    () => ({
      title: sessionTitle,
      isAutoNaming: sessionAutoNaming,
    }),
    [sessionTitle, sessionAutoNaming],
  );
}
