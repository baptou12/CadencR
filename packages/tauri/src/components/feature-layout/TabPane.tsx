import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { XIcon } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ROOT_LEAF_ID, type LayoutLeaf, type TabKind } from "@/stores/feature-layout-schema";
import { useFeatureLayoutStore } from "@/stores/feature-layout-store";
import { useTabHostRegistry } from "@/stores/tab-host-registry";
import { cn } from "@/lib/utils";

import { LayoutMenu } from "./LayoutMenu";
import type { DragSource, FeatureTabs } from "./types";

interface TabPaneProps {
  featureId: number;
  leaf: LayoutLeaf;
  tabs: FeatureTabs;
}

/**
 * One pane in the split grid. Owns:
 *   - A line-style tab strip (shadcn Tabs).
 *   - A content host `<div>` registered into `tab-host-registry` so portals
 *     can target it.
 *   - 5 drop zones (4 edges + 1 center) overlaid on the content area when a
 *     drag is active. Each zone is a `useDroppable` with edge metadata.
 *   - For the root pane, the LayoutMenu trailing the strip.
 */
export function TabPane({ featureId, leaf, tabs }: TabPaneProps): ReactNode {
  const setHost = useTabHostRegistry((s) => s.setHost);
  const setPaneActiveTab = useFeatureLayoutStore((s) => s.setPaneActiveTab);
  const dockTab = useFeatureLayoutStore((s) => s.dockTab);
  const setFocusedPane = useFeatureLayoutStore((s) => s.setFocusedPane);
  const focusedPaneId = useFeatureLayoutStore((s) => s.features[featureId]?.focusedPaneId);

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const setContentRef = useCallback(
    (el: HTMLDivElement | null) => {
      contentRef.current = el;
      setHost(leaf.id, el);
    },
    [leaf.id, setHost],
  );
  // Unregister on unmount so portals can't target a detached node.
  useEffect(() => {
    return () => setHost(leaf.id, null);
  }, [leaf.id, setHost]);

  const isRoot = leaf.id === ROOT_LEAF_ID;
  const isFocused = focusedPaneId === leaf.id;

  // Non-root panes are presented as "floating blocks": a small inset padding
  // separates them from the resize handles + viewport edges, plus rounded
  // corners, a soft border and a drop shadow. The root pane stays flat
  // (full-bleed) so the agent feels like the page's primary surface and the
  // other tabs feel like cards floating around it.
  //
  // Strip alignment: when root and non-root panes sit side by side in a
  // horizontal split, their tab-strip underlines must be at the same y. A
  // non-root strip is offset down by its outer top-padding *and* the inner
  // wrapper's `border-t`. We zero the top padding (drop the 6 px) and
  // compensate the remaining 1 px border on the root via a `pt-px` so both
  // strips start at exactly y = 1.
  return (
    <div className={cn("h-full w-full", isRoot ? "pt-px" : "px-1.5 pb-1.5")}>
      <div
        ref={containerRef}
        data-pane-id={leaf.id}
        data-pane-focused={isFocused}
        className={cn(
          "relative flex h-full w-full flex-col bg-background outline-none",
          !isRoot && "overflow-hidden rounded-lg border border-border shadow-md",
        )}
        onMouseDown={() => setFocusedPane(featureId, leaf.id)}
      >
        <PaneTabStrip paneId={leaf.id}>
          <Tabs
            value={leaf.activeTabId ?? ""}
            onValueChange={(value) => setPaneActiveTab(featureId, leaf.id, value as TabKind)}
            className="flex min-w-0 flex-1"
          >
            <TabsList className="flex-1 overflow-x-auto border-b-0">
              {leaf.tabIds.length === 0 && (
                <span className="px-3 py-2 text-xs italic text-muted-foreground">
                  Drag tabs here
                </span>
              )}
              {leaf.tabIds.map((tab) => (
                <DraggableTabTrigger
                  key={tab}
                  featureId={featureId}
                  paneId={leaf.id}
                  tab={tab}
                  tabs={tabs}
                  isRootPane={isRoot}
                  onClose={() => {
                    if (isRoot) return;
                    dockTab(featureId, tab);
                  }}
                />
              ))}
            </TabsList>
          </Tabs>
          {isRoot && (
            <div className="ml-auto flex shrink-0 items-center pr-2">
              <LayoutMenu featureId={featureId} />
            </div>
          )}
        </PaneTabStrip>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div ref={setContentRef} className="h-full w-full" />
          <PaneEdgeDropZones paneId={leaf.id} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draggable tab trigger
// ---------------------------------------------------------------------------

interface DraggableTabTriggerProps {
  featureId: number;
  paneId: string;
  tab: TabKind;
  tabs: FeatureTabs;
  isRootPane: boolean;
  onClose: () => void;
}

function DraggableTabTrigger({
  paneId,
  tab,
  tabs,
  isRootPane,
  onClose,
}: DraggableTabTriggerProps): ReactNode {
  const def = tabs[tab];
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `tab:${paneId}:${tab}`,
    data: { kind: "pane", paneId, tab } as const,
  });

  return (
    <TabsTrigger
      ref={setNodeRef}
      value={tab}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : undefined,
      }}
      {...attributes}
      {...listeners}
      className="group cursor-grab active:cursor-grabbing"
    >
      <def.Icon className="size-4 shrink-0" />
      <span>{def.label}</span>
      {def.badge}
      {!isRootPane && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-1 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
          aria-label={`Return ${def.label} to the root tab strip`}
        >
          <XIcon className="size-3" />
        </button>
      )}
    </TabsTrigger>
  );
}

// ---------------------------------------------------------------------------
// Drop zones
// ---------------------------------------------------------------------------

/**
 * The pane's tab bar is itself the "merge into this pane" drop target. Drop a
 * dragged tab anywhere on the strip and it gets appended to this pane's tab
 * list — that's the natural gesture (matches how browsers move tabs between
 * windows). The strip only highlights when the source is *another* pane, so
 * dragging a tab over its own strip stays visually quiet.
 */
function PaneTabStrip({ paneId, children }: { paneId: string; children: ReactNode }): ReactNode {
  const { setNodeRef, isOver, active } = useDroppable({
    id: `strip:${paneId}`,
    data: { kind: "pane-strip", paneId } as const,
  });
  const sourcePaneId = (active?.data.current as DragSource | undefined)?.paneId;
  const showOver = isOver && sourcePaneId !== undefined && sourcePaneId !== paneId;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex shrink-0 items-stretch border-b border-border transition-colors",
        showOver && "bg-primary/15",
      )}
    >
      {children}
    </div>
  );
}

function PaneEdgeDropZones({ paneId }: { paneId: string }): ReactNode {
  return (
    <>
      <EdgeDropZone paneId={paneId} edge="top" />
      <EdgeDropZone paneId={paneId} edge="right" />
      <EdgeDropZone paneId={paneId} edge="bottom" />
      <EdgeDropZone paneId={paneId} edge="left" />
    </>
  );
}

const EDGE_THICKNESS = "30%";

function EdgeDropZone({
  paneId,
  edge,
}: {
  paneId: string;
  edge: "top" | "right" | "bottom" | "left";
}): ReactNode {
  const { setNodeRef, isOver, active } = useDroppable({
    id: `edge:${paneId}:${edge}`,
    data: { kind: "pane-edge", paneId, edge } as const,
  });
  if (!active) return null;
  // Thin strip along the matching edge, only active during a drag.
  const positional = {
    top: { top: 0, left: 0, right: 0, height: EDGE_THICKNESS },
    bottom: { bottom: 0, left: 0, right: 0, height: EDGE_THICKNESS },
    left: { top: 0, bottom: 0, left: 0, width: EDGE_THICKNESS },
    right: { top: 0, bottom: 0, right: 0, width: EDGE_THICKNESS },
  }[edge];
  return (
    <div
      ref={setNodeRef}
      aria-hidden
      style={positional}
      className={cn(
        "pointer-events-auto absolute z-20 transition-colors",
        isOver ? "bg-primary/40" : "bg-transparent",
      )}
    />
  );
}
