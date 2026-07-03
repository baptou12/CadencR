import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { getGetFeatureSettingsQueryKey, useSetFeatureSetting } from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { LAYOUT_STATE_KEY, serializeCurrentLayoutState } from "@/stores/feature-layout-schema";
import { useFeatureLayoutStore } from "@/stores/feature-layout-store";

const PERSIST_DEBOUNCE_MS = 500;

/**
 * Persists the current per-feature tab/split layout into `feature_settings`.
 * The first observed state is treated as the hydrated baseline and is not
 * written back immediately, which prevents fallback/default hydration from
 * clobbering a server value before the user changes anything.
 */
export function useFeatureLayoutPersistence(
  featureId: number,
  options: { enabled?: boolean } = {},
): void {
  const enabled = options.enabled ?? true;
  const queryClient = useQueryClient();
  const { mutate } = useSetFeatureSetting();
  const serializedLayout = useFeatureLayoutStore((s) => {
    const state = s.features[featureId];
    return state ? serializeCurrentLayoutState(state) : null;
  });
  const lastSeenRef = useRef<string | null>(null);
  const lastScheduledRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);
  const hasBaselineRef = useRef(false);

  useEffect((): void => {
    hasBaselineRef.current = false;
    lastSeenRef.current = null;
    lastScheduledRef.current = null;
    requestSeqRef.current = 0;
  }, [featureId]);

  useEffect((): (() => void) | void => {
    if (!enabled || serializedLayout === null) return;

    if (!hasBaselineRef.current) {
      hasBaselineRef.current = true;
      lastSeenRef.current = serializedLayout;
      lastScheduledRef.current = serializedLayout;
      return;
    }

    if (serializedLayout === lastSeenRef.current || serializedLayout === lastScheduledRef.current) {
      return;
    }

    lastScheduledRef.current = serializedLayout;
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;

    const timeoutId = window.setTimeout((): void => {
      mutate(
        { id: featureId, data: { key: LAYOUT_STATE_KEY, value: serializedLayout } },
        {
          onSuccess: (): void => {
            if (requestSeqRef.current !== requestSeq) return;
            lastSeenRef.current = serializedLayout;
            void queryClient.invalidateQueries({
              queryKey: getGetFeatureSettingsQueryKey(featureId),
            });
          },
          onError: (err: unknown): void => {
            if (requestSeqRef.current !== requestSeq) return;
            const message = apiErrorMessage(err, "Unknown error");
            toast.error(`Could not save layout: ${message}`);
          },
        },
      );
    }, PERSIST_DEBOUNCE_MS);

    return (): void => window.clearTimeout(timeoutId);
  }, [enabled, featureId, serializedLayout, mutate, queryClient]);
}
