import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useListFeatureActivity } from "@/api/generated";
import { showBrowserError } from "@/components/browser/browser-errors";
import { apiErrorMessage } from "@/lib/api-errors";
import { desktopBridge } from "@/lib/desktop-bridge";
import { useBrowserStore } from "@/stores/browser-store";

interface FeatureActivityCounts {
  shellCountsByFeatureId: Map<number, number>;
  browserCountsByFeatureId: Record<number, number>;
}

export function useFeatureActivityCounts(projectId: number): FeatureActivityCounts {
  const activityQuery = useListFeatureActivity(
    { project_id: projectId, include_archived: true },
    { query: { refetchInterval: 2000 } },
  );
  const browserCountsByFeatureId = useBrowserStore((state) => state.countsByScope);

  useEffect(() => {
    if (!activityQuery.error) return;
    toast.error(apiErrorMessage(activityQuery.error, "Failed to load sidebar activity"), {
      id: "sidebar-activity-load-error",
    });
  }, [activityQuery.error]);

  useEffect(() => {
    let alive = true;
    void desktopBridge
      .listBrowserTabCountsByScope()
      .then((counts) => {
        if (alive) useBrowserStore.getState().setCountsByScope(counts);
      })
      .catch((error: unknown) => {
        showBrowserError(error, "Failed to load browser tab counts");
      });
    const unsubscribe = desktopBridge.onBrowserTabCounts((counts) => {
      useBrowserStore.getState().setCountsByScope(counts);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const shellCountsByFeatureId = useMemo(() => {
    const counts = new Map<number, number>();
    for (const item of activityQuery.data ?? []) {
      counts.set(item.feature_id, item.shell_count);
    }
    return counts;
  }, [activityQuery.data]);

  return useMemo(
    () => ({ shellCountsByFeatureId, browserCountsByFeatureId }),
    [browserCountsByFeatureId, shellCountsByFeatureId],
  );
}
