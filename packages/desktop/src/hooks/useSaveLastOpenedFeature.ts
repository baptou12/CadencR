import { useEffect } from "react";
import { useSetWorkspaceSetting } from "@/api/generated";
import type { TabKind } from "@/stores/feature-layout-schema";

/**
 * Persists the current projectId/featureId/activeTab as the last-opened feature,
 * so the app can restore it on next startup.
 */
export function useSaveLastOpenedFeature(
  projectId: number,
  featureId: number,
  activeTab?: TabKind,
  skip = false,
) {
  const { mutate } = useSetWorkspaceSetting();
  useEffect(() => {
    if (skip) return;
    mutate({
      key: "lastOpenedFeature",
      data: {
        value: JSON.stringify({ projectId, featureId, activeTab: activeTab ?? "agent" }),
      },
    });
  }, [projectId, featureId, activeTab, skip, mutate]);
}
