import { useCallback } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import {
  findPaneContaining,
  selectFeatureLayout,
  useFeatureLayoutStore,
} from "@/stores/feature-layout-store";
import type { TabKind } from "@/stores/feature-layout-schema";
import type { FeatureTabActivationHandlers } from "@/components/feature-layout/types";

type FeatureLayoutHotkeysOptions = FeatureTabActivationHandlers;

const HOTKEY_OPTIONS = { enableOnFormTags: true, enableOnContentEditable: true } as const;

/**
 * Preserves the existing meta+shift+A/T/G/E shortcuts. Each hotkey:
 *   1. Locates the pane currently hosting the requested tab.
 *   2. Sets that pane's active tab.
 *   3. Records the pane as `focusedPaneId` so the renderer can give it focus.
 *
 * If the tab isn't placed yet (shouldn't happen — every tab is always in
 * exactly one pane), the hotkey is a no-op rather than crashing.
 */
export function useFeatureLayoutHotkeys(
  featureId: number,
  options: FeatureLayoutHotkeysOptions = {},
): void {
  const setPaneActiveTab = useFeatureLayoutStore((s) => s.setPaneActiveTab);
  const { onTerminalActivate, onEditorActivate } = options;

  const activate = useCallback(
    (tab: TabKind) => {
      const state = selectFeatureLayout(featureId)(useFeatureLayoutStore.getState());
      const leaf = findPaneContaining(state.splitRoot, tab);
      if (!leaf) return;
      setPaneActiveTab(featureId, leaf.id, tab);
      if (tab === "terminal") onTerminalActivate?.();
      if (tab === "editor") onEditorActivate?.();
    },
    [featureId, setPaneActiveTab, onTerminalActivate, onEditorActivate],
  );

  useHotkeys(
    "meta+shift+a",
    (e) => {
      e.preventDefault();
      activate("agent");
    },
    HOTKEY_OPTIONS,
  );
  useHotkeys(
    "meta+shift+t",
    (e) => {
      e.preventDefault();
      activate("terminal");
    },
    HOTKEY_OPTIONS,
  );
  useHotkeys(
    "meta+shift+g",
    (e) => {
      e.preventDefault();
      activate("git");
    },
    HOTKEY_OPTIONS,
  );
  useHotkeys(
    "meta+shift+e",
    (e) => {
      e.preventDefault();
      activate("editor");
    },
    HOTKEY_OPTIONS,
  );
}
