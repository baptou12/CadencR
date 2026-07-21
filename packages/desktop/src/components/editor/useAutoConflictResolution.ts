import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { FileStageState, useGetChangedFiles } from "@/api/generated";
import { useEditorStore } from "@/stores/editor-store";
import type { EditorFeatureState } from "@/stores/editor-store-types";
import { resolvedStageState } from "@/components/diff/useGitDiffFileTreeModel";
import { apiErrorMessage } from "@/lib/api-errors";

/**
 * A stable signal of which files are open and whether each is dirty — but NOT
 * their resolver flag. Reconciliation must re-run when a tab is opened or its
 * dirtiness changes, yet flipping `resolveConflict` (what reconcile itself
 * does) must not retrigger it, or the effect would loop.
 */
function openTabsSignal(feature: EditorFeatureState | undefined): string {
  if (!feature) return "";
  const tabs: Array<[paneId: string, filePath: string, isDirty: boolean]> = [];
  for (const [paneId, pane] of Object.entries(feature.panes)) {
    for (const tab of pane.tabs) tabs.push([paneId, tab.filePath, tab.isDirty]);
  }
  // JSON encoding keeps unusual literal paths collision-free. A hand-built
  // delimiter signal could make one path such as `a:0|b` indistinguishable
  // from multiple tabs, preventing reconciliation on a legitimate open.
  return JSON.stringify(tabs);
}

/**
 * Drives automatic conflict resolution for a feature's editor. Whenever Git
 * (backend-confirmed, exact-path) reports a file as unmerged, opening it drops
 * straight into the resolver; once the watcher confirms it left the unmerged
 * set, the resolver clears. Mount once per feature at the editor-panel root so
 * a single `changed-files` subscription (shared with the Git tab) covers every
 * pane. See {@link EditorStore.reconcileConflictResolution}.
 */
export function useAutoConflictResolution(featureId: number): void {
  const changedFiles = useGetChangedFiles(
    { feature_id: featureId, mode: "worktree" },
    { query: { refetchOnMount: false, refetchOnWindowFocus: false } },
  );
  const reconcile = useEditorStore((s) => s.reconcileConflictResolution);
  const openSignal = useEditorStore((s) => openTabsSignal(s.features[featureId]));

  const files = changedFiles.data;
  const conflictedKey = useMemo(() => {
    if (!files) return null;
    return files
      .filter((file) => resolvedStageState(file) === FileStageState.conflicted)
      .map((file) => file.file)
      .sort()
      .join("\0");
  }, [files]);

  useEffect(() => {
    if (!changedFiles.isError) return;
    toast.error("Could not detect Git conflicts", {
      description: apiErrorMessage(changedFiles.error, "Git status is unavailable"),
    });
  }, [changedFiles.error, changedFiles.isError]);

  useEffect(() => {
    if (conflictedKey == null) return;
    reconcile(featureId, conflictedKey === "" ? [] : conflictedKey.split("\0"));
  }, [featureId, conflictedKey, openSignal, reconcile]);
}
