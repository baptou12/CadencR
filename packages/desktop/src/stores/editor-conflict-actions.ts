import {
  type EditorPaneState,
  type EditorSet,
  type EditorStore,
  type EditorTab,
} from "./editor-store-types";
import { updateFeature } from "./editor-helpers";

type EditorConflictActions = Pick<EditorStore, "reconcileConflictResolution">;

/**
 * Decide a tab's next `resolveConflict` flag from backend-confirmed status.
 * A dirty buffer keeps whatever mode it is in — auto-activation must never
 * remount over unsaved edits, and a watcher clear must not drop a Result the
 * user is still editing. Otherwise the flag simply mirrors "is this exact path
 * unmerged right now".
 */
function nextResolveFlag(tab: EditorTab, isConflicted: boolean): boolean {
  const current = tab.resolveConflict ?? false;
  if (tab.isDirty) return current;
  return isConflicted;
}

export function createEditorConflictActions(set: EditorSet): EditorConflictActions {
  return {
    reconcileConflictResolution: (featureId, conflictedPaths) =>
      set((state) => {
        const feature = state.features[featureId];
        if (!feature) return state;
        // Exact-path membership only — never prefix or normalize, so linked
        // worktrees and unusual literal paths match by identity or not at all.
        const conflicted = new Set(conflictedPaths);
        let anyChanged = false;
        const panes: Record<string, EditorPaneState> = {};
        for (const [paneId, pane] of Object.entries(feature.panes)) {
          let paneChanged = false;
          const tabs = pane.tabs.map((tab) => {
            const next = nextResolveFlag(tab, conflicted.has(tab.filePath));
            if (next === (tab.resolveConflict ?? false)) return tab;
            paneChanged = true;
            return { ...tab, resolveConflict: next };
          });
          panes[paneId] = paneChanged ? { ...pane, tabs } : pane;
          anyChanged ||= paneChanged;
        }
        return anyChanged ? updateFeature(state, featureId, { ...feature, panes }) : state;
      }),
  };
}
