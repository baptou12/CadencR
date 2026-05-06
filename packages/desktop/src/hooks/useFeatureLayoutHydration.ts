import { useEffect } from "react";
import { toast } from "sonner";

import { useGetFeatureSettings, useListLayouts } from "@/api/generated";
import {
  LAYOUT_STATE_KEY,
  flatLayoutState,
  parseLayoutState,
} from "@/stores/feature-layout-schema";
import { selectFeatureLayout, useFeatureLayoutStore } from "@/stores/feature-layout-store";

/**
 * One-shot hydrate of the in-memory `useFeatureLayoutStore` for a feature.
 *
 * The current per-feature layout is persisted in `feature_settings` under
 * `layout_state`. Named rows in `feature_layouts` remain explicit templates.
 *
 * # Bootstrap order (first time we see this `featureId` in the session)
 *  1. Feature-specific `layout_state`.
 *  2. Workspace default layout (the saved layout flagged `is_default`).
 *  3. Flat fallback (every tab in the root pane, agent active).
 *
 * If the feature already has state in the store (user already visited it this
 * session), we skip — the in-memory state is the source of truth.
 */
export function useFeatureLayoutHydration(
  featureId: number,
  options: { enabled?: boolean } = {},
): void {
  const enabled = options.enabled ?? true;
  const layoutsQuery = useListLayouts({ query: { enabled } });
  const settingsQuery = useGetFeatureSettings(featureId, { query: { enabled } });
  const setStoreState = useFeatureLayoutStore((s) => s.setState);

  useEffect(() => {
    if (!enabled || layoutsQuery.isLoading || settingsQuery.isLoading) return;
    // Already hydrated this feature in the current session — keep its state.
    if (useFeatureLayoutStore.getState().features[featureId]) return;

    const savedCurrent = settingsQuery.data?.find((setting) => setting.key === LAYOUT_STATE_KEY);
    if (savedCurrent) {
      const parsed = parseLayoutState(savedCurrent.value);
      if (parsed) {
        setStoreState(featureId, parsed);
        return;
      }
      toast.error("Saved feature layout is malformed and was skipped.");
    }

    const defaultLayout = layoutsQuery.data?.find((l) => l.is_default);
    if (defaultLayout) {
      const parsed = parseLayoutState(defaultLayout.config);
      if (parsed) {
        setStoreState(featureId, { ...parsed, appliedLayoutId: defaultLayout.id });
        return;
      }
      toast.error(`Default layout "${defaultLayout.name}" is malformed and was skipped.`);
    }
    setStoreState(featureId, flatLayoutState());
  }, [
    enabled,
    featureId,
    layoutsQuery.isLoading,
    layoutsQuery.data,
    settingsQuery.isLoading,
    settingsQuery.data,
    setStoreState,
  ]);
}

/** Read-only selector hook — wraps the store with the right featureId. */
export function useFeatureLayoutState(featureId: number) {
  return useFeatureLayoutStore(selectFeatureLayout(featureId));
}
