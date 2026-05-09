import { type TabKind } from "@/stores/feature-layout-schema";
import { getFocusedTab, useFeatureLayoutStore } from "@/stores/feature-layout-store";

export function getFocusedTabForFeature(featureId: number | null): TabKind | undefined {
  if (featureId == null) return undefined;
  const state = useFeatureLayoutStore.getState().features[featureId];
  if (!state) return undefined;
  return getFocusedTab(state) ?? undefined;
}
