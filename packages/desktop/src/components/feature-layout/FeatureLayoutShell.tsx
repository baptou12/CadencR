import { useState, type ReactNode } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";

import { useFeatureLayoutHotkeys } from "@/hooks/useFeatureLayoutHotkeys";
import { useFeatureLayoutHydration } from "@/hooks/useFeatureLayoutHydration";
import { useFeatureLayoutPersistence } from "@/hooks/useFeatureLayoutPersistence";
import {
  getFocusedTab,
  selectFeatureLayout,
  useFeatureLayoutStore,
} from "@/stores/feature-layout-store";
import {
  ALL_TAB_KINDS,
  ROOT_LEAF_ID,
  type FeatureLayoutState,
} from "@/stores/feature-layout-schema";

import { DragChip } from "./DragChip";
import { SplitTreeRenderer } from "./SplitTreeRenderer";
import { TabContentRegistry } from "./TabContentRegistry";
import type { DragSource, FeatureTabActivationHandlers, FeatureTabs } from "./types";
import { useFeatureDnd } from "./useFeatureDnd";

interface FeatureLayoutShellProps extends FeatureTabActivationHandlers {
  featureId: number;
  tabs: FeatureTabs;
  splitsEnabled?: boolean;
  hotkeysEnabled?: boolean;
  mountInactiveTabs?: boolean;
}

/**
 * Top-level component consumed by ws-session and FeatureWorkflowView. Owns:
 *   - DnD context (one per page) with sensors, collision detection, overlay.
 *   - Tab content registry (mounts every tab body once, portals it).
 *   - Layout hydration on mount (`useFeatureLayoutHydration`).
 *   - Keyboard shortcuts (preserves meta+shift+A/T/G/E).
 *   - The split-tree renderer.
 */
function flatVisibleLayout(state: FeatureLayoutState): FeatureLayoutState {
  return {
    version: 1,
    splitRoot: {
      type: "leaf",
      id: ROOT_LEAF_ID,
      tabIds: [...ALL_TAB_KINDS],
      activeTabId: getFocusedTab(state) ?? "agent",
    },
    focusedPaneId: ROOT_LEAF_ID,
    appliedLayoutId: null,
  };
}

export function FeatureLayoutShell({
  featureId,
  tabs,
  onTerminalActivate,
  onEditorActivate,
  splitsEnabled = true,
  hotkeysEnabled = true,
  mountInactiveTabs = true,
}: FeatureLayoutShellProps): ReactNode {
  useFeatureLayoutHydration(featureId, { enabled: splitsEnabled });
  useFeatureLayoutPersistence(featureId, { enabled: splitsEnabled });
  useFeatureLayoutHotkeys(featureId, {
    onTerminalActivate,
    onEditorActivate,
    enabled: hotkeysEnabled,
  });

  const layoutState = useFeatureLayoutStore(selectFeatureLayout(featureId));
  const effectiveLayout = splitsEnabled ? layoutState : flatVisibleLayout(layoutState);
  const splitRoot = effectiveLayout.splitRoot;

  const [activeSource, setActiveSource] = useState<DragSource | null>(null);
  const dnd = useFeatureDnd({
    featureId,
    onDragStart: setActiveSource,
    onDragEnd: () => setActiveSource(null),
  });

  return (
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={dnd.collisionDetection}
      onDragStart={dnd.handleDragStart}
      onDragEnd={dnd.handleDragEnd}
      onDragCancel={dnd.handleDragCancel}
    >
      <TabContentRegistry
        featureId={featureId}
        tabs={tabs}
        layoutState={effectiveLayout}
        mountVisibleOnly={!mountInactiveTabs}
      />
      <div className="relative h-full min-h-0 flex-1 overflow-hidden">
        <SplitTreeRenderer
          featureId={featureId}
          node={splitRoot}
          path={[]}
          tabs={tabs}
          onTerminalActivate={onTerminalActivate}
          onEditorActivate={onEditorActivate}
          splitsEnabled={splitsEnabled}
        />
      </div>
      <DragOverlay dropAnimation={null}>
        {activeSource ? <DragChip tab={activeSource.tab} tabs={tabs} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
