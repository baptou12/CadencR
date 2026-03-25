import { useEffect } from "react";
import { useSetWorkspaceSetting } from "@/api/generated";

/**
 * Persists the current projectId/featureId as the last-opened feature,
 * so the app can restore it on next startup.
 */
export function useSaveLastOpenedFeature(projectId: number, featureId: number, skip = false) {
  const { mutate } = useSetWorkspaceSetting();
  useEffect(() => {
    if (skip) return;
    mutate({
      key: "lastOpenedFeature",
      value: JSON.stringify({ projectId, featureId }),
    });
  }, [projectId, featureId, skip, mutate]);
}
