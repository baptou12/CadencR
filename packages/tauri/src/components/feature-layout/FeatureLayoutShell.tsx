import { useState, type ReactNode } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";

import { useFeatureLayoutHotkeys } from "@/hooks/useFeatureLayoutHotkeys";
import { useFeatureLayoutHydration } from "@/hooks/useFeatureLayoutHydration";
import { useFeatureLayoutPersistence } from "@/hooks/useFeatureLayoutPersistence";
import { selectFeatureLayout, useFeatureLayoutStore } from "@/stores/feature-layout-store";

import { DragChip } from "./DragChip";
import { SplitTreeRenderer } from "./SplitTreeRenderer";
import { TabContentRegistry } from "./TabContentRegistry";
import type { DragSource, FeatureTabActivationHandlers, FeatureTabs } from "./types";
import { useFeatureDnd } from "./useFeatureDnd";

interface FeatureLayoutShellProps extends FeatureTabActivationHandlers {
  featureId: number;
  tabs: FeatureTabs;
}

/**
 * Top-level component consumed by ws-session and FeatureWorkflowView. Owns:
 *   - DnD context (one per page) with sensors, collision detection, overlay.
 *   - Tab content registry (mounts every tab body once, portals it).
 *   - Layout hydration on mount (`useFeatureLayoutHydration`).
 *   - Keyboard shortcuts (preserves meta+shift+A/T/G/E).
 *   - The split-tree renderer.
 */
export function FeatureLayoutShell({
  featureId,
  tabs,
  onTerminalActivate,
  onEditorActivate,
}: FeatureLayoutShellProps): ReactNode {
  useFeatureLayoutHydration(featureId);
  useFeatureLayoutPersistence(featureId);
  useFeatureLayoutHotkeys(featureId, { onTerminalActivate, onEditorActivate });

  const splitRoot = useFeatureLayoutStore((s) => selectFeatureLayout(featureId)(s).splitRoot);

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
      <TabContentRegistry featureId={featureId} tabs={tabs} />
      <div className="relative h-full min-h-0 flex-1 overflow-hidden">
        <SplitTreeRenderer
          featureId={featureId}
          node={splitRoot}
          path={[]}
          tabs={tabs}
          onTerminalActivate={onTerminalActivate}
          onEditorActivate={onEditorActivate}
        />
      </div>
      <DragOverlay dropAnimation={null}>
        {activeSource ? <DragChip tab={activeSource.tab} tabs={tabs} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
