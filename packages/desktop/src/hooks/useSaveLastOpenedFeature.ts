import { useEffect, useRef } from "react";
import { useSetWorkspaceSetting } from "@/api/generated";
import type { TabKind } from "@/stores/feature-layout-schema";

/**
 * Persists the current projectId/featureId/activeTab as the last-opened feature,
 * so the app can restore it on next startup.
 *
 * Belt-and-suspenders dedupe: even if a parent re-renders rapidly (e.g.
 * during route transition), we only fire the `PUT` when the persisted tuple
 * changes. The hook is intentionally route-level so callers don't have to
 * worry about double-mounting it inside a child component.
 */
export function useSaveLastOpenedFeature(
  projectId: number,
  featureId: number,
  activeTab?: TabKind,
  skip = false,
): void {
  const { mutate } = useSetWorkspaceSetting();
  const lastPersistedRef = useRef<string | null>(null);
  useEffect(() => {
    if (skip) return;
    const tab: TabKind = activeTab ?? "agent";
    const key = `${projectId}:${featureId}:${tab}`;
    if (lastPersistedRef.current === key) return;
    lastPersistedRef.current = key;
    mutate({
      key: "lastOpenedFeature",
      data: {
        value: JSON.stringify({ projectId, featureId, activeTab: tab }),
      },
    });
  }, [projectId, featureId, activeTab, skip, mutate]);
}
