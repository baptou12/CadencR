import { useEffect, useRef, useState } from "react";

import { type TabKind } from "@/stores/feature-layout-schema";
import {
  activateFeatureTab,
  getFocusedTab,
  useFeatureLayoutStore,
} from "@/stores/feature-layout-store";

export function useRequestedFeatureFocus(
  featureId: number,
  requestedTab: TabKind | null | undefined,
  enabled = true,
): boolean {
  const hasLayoutState = useFeatureLayoutStore((s) => s.features[featureId] !== undefined);
  const requestKey = enabled && requestedTab ? `${featureId}:${requestedTab}` : null;
  const completedRequestKeyRef = useRef<string | null>(null);
  const [completedRequestKey, setCompletedRequestKey] = useState<string | null>(null);

  useEffect((): void => {
    if (requestKey === null || !requestedTab) {
      completedRequestKeyRef.current = null;
      setCompletedRequestKey(null);
      return;
    }
    if (completedRequestKeyRef.current === requestKey) return;

    const current = useFeatureLayoutStore.getState().features[featureId];
    if (!current) return;

    const alreadyFocused = getFocusedTab(current) === requestedTab;
    if (!alreadyFocused) activateFeatureTab(featureId, requestedTab);

    completedRequestKeyRef.current = requestKey;
    setCompletedRequestKey(requestKey);
  }, [featureId, hasLayoutState, requestKey, requestedTab]);

  return requestKey !== null && completedRequestKey !== requestKey;
}
