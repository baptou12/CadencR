import { useEffect, useRef, useState } from "react";

import { type TabKind } from "@/stores/feature-layout-schema";
import {
  activateFeatureTab,
  getFocusedTab,
  useFeatureLayoutStore,
} from "@/stores/feature-layout-store";

const REQUEST_FOCUS_RETRY_DELAYS_MS = [50, 250, 1000] as const;

export function useRequestedFeatureFocus(
  featureId: number,
  requestedTab: TabKind | null | undefined,
  enabled = true,
): boolean {
  const hasLayoutState = useFeatureLayoutStore((s) => s.features[featureId] !== undefined);
  const requestKey = enabled && requestedTab ? `${featureId}:${requestedTab}` : null;
  const completedRequestKeyRef = useRef<string | null>(null);
  const [completedRequestKey, setCompletedRequestKey] = useState<string | null>(null);

  useEffect((): (() => void) | void => {
    if (requestKey === null || !requestedTab) {
      completedRequestKeyRef.current = null;
      setCompletedRequestKey(null);
      return;
    }
    if (completedRequestKeyRef.current === requestKey) {
      return;
    }

    const completeRequest = (): void => {
      if (completedRequestKeyRef.current === requestKey) return;
      completedRequestKeyRef.current = requestKey;
      setCompletedRequestKey(requestKey);
    };

    const applyRequestedFocus = (): boolean => {
      const current = useFeatureLayoutStore.getState().features[featureId];
      if (!current) return false;
      if (getFocusedTab(current) === requestedTab) return true;
      if (!activateFeatureTab(featureId, requestedTab)) return true;
      const next = useFeatureLayoutStore.getState().features[featureId];
      return next ? getFocusedTab(next) === requestedTab : false;
    };

    const tryApplyRequestedFocus = (): void => {
      if (applyRequestedFocus()) completeRequest();
    };

    tryApplyRequestedFocus();
    const timeoutIds = REQUEST_FOCUS_RETRY_DELAYS_MS.map((delay) =>
      window.setTimeout(tryApplyRequestedFocus, delay),
    );
    return () => {
      for (const timeoutId of timeoutIds) window.clearTimeout(timeoutId);
    };
  }, [featureId, hasLayoutState, requestKey, requestedTab]);

  return requestKey !== null && completedRequestKey !== requestKey;
}
