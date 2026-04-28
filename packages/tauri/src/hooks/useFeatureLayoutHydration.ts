import { useEffect } from "react";
import { toast } from "sonner";

import { useListLayouts } from "@/api/generated";
import { flatLayoutState, parseLayoutState } from "@/stores/feature-layout-schema";
import { selectFeatureLayout, useFeatureLayoutStore } from "@/stores/feature-layout-store";

/**
 * One-shot hydrate of the in-memory `useFeatureLayoutStore` for a feature.
 *
 * The current per-feature layout is **purely in-memory**: drag/resize/move
 * changes never round-trip to the backend. Only explicit "Save as new" /
 * "Update X" actions in `<LayoutMenu>` write to the `feature_layouts` table.
 *
 * # Bootstrap order (first time we see this `featureId` in the session)
 *  1. Workspace default layout (the saved layout flagged `is_default`).
 *  2. Flat fallback (every tab in the root pane, agent active).
 *
 * If the feature already has state in the store (user already visited it this
 * session), we skip — the in-memory state is the source of truth.
 */
export function useFeatureLayoutHydration(featureId: number): void {
  const layoutsQuery = useListLayouts();
  const setStoreState = useFeatureLayoutStore((s) => s.setState);

  useEffect(() => {
    if (layoutsQuery.isLoading) return;
    // Already hydrated this feature in the current session — keep its state.
    if (useFeatureLayoutStore.getState().features[featureId]) return;

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
  }, [featureId, layoutsQuery.isLoading, layoutsQuery.data, setStoreState]);
}

/** Read-only selector hook — wraps the store with the right featureId. */
export function useFeatureLayoutState(featureId: number) {
  return useFeatureLayoutStore(selectFeatureLayout(featureId));
}
