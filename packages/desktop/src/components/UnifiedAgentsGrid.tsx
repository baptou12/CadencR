import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { toast } from "sonner";
import type { UnifiedAgentEntry } from "@/api/generated";
import { UnifiedAgentCard } from "@/components/UnifiedAgentCard";
import { useFocusedUnifiedAgent } from "@/components/UnifiedAgentsGridFocus";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { popResize, pushResize } from "@/lib/resize-coordinator";

const ROW_HEIGHT = 640;
const MIN_ROW_HEIGHT = 420;
const MAX_ROW_HEIGHT = 1200;
// Override react-resizable-panels' inline `overflow: hidden`/`auto` so the
// active card's drop shadow isn't clipped at the panel bounds.
const SHADOW_FRIENDLY_OVERFLOW: CSSProperties = { overflow: "visible" };
// v3: rekey rows by *row index* instead of session IDs. Previously the key
// embedded the row's session IDs (`columns:3|sessions:42,17,89`), so any
// agent churn — creation, archive, pin, sort, filter — produced a brand-new
// key and the saved height/width was effectively unreachable. Row index is
// stable across that churn: row 0 stays row 0 no matter what's in it.
const ROW_HEIGHTS_KEY = "unified_agents_row_heights_v3";
const ROW_WIDTHS_KEY = "unified_agents_row_widths_v2";

type RowLayoutKey = string;
type RowHeightMap = Record<RowLayoutKey, number>;
type RowWidthLayouts = Record<RowLayoutKey, PanelLayout>;
type PanelLayout = Record<string, number>;

interface UnifiedAgentsGridProps {
  agents: UnifiedAgentEntry[];
  columns: number;
  activeIndex: number;
  focusVersion: number;
  onActivate: (index: number) => void;
}

export const UnifiedAgentsGrid = memo(function UnifiedAgentsGrid({
  agents,
  columns,
  activeIndex,
  focusVersion,
  onActivate,
}: UnifiedAgentsGridProps): ReactElement {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const { rowHeights, setRowHeight } = useRowHeights();
  const { rowWidths, setRowWidthLayout } = useRowWidths();
  const rows = useMemo(() => chunkAgents(agents, columns), [agents, columns]);
  const activeRow = Math.floor(activeIndex / columns);
  useFocusedUnifiedAgent({ activeIndex, activeRow, focusVersion, virtuosoRef });

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={rows}
      className="min-h-0 flex-1"
      overscan={900}
      itemContent={(rowIndex, rowAgents) => {
        const rowLayoutKey = getRowLayoutKey(rowIndex, columns);
        return (
          <UnifiedAgentsRow
            rowAgents={rowAgents}
            rowLayoutKey={rowLayoutKey}
            rowStartIndex={rowIndex * columns}
            rowIndex={rowIndex}
            rowHeight={rowHeights[rowLayoutKey] ?? ROW_HEIGHT}
            rowWidthLayout={getStoredRowWidthLayout(rowAgents, rowWidths[rowLayoutKey])}
            activeIndex={activeIndex}
            onRowHeightChange={setRowHeight}
            onRowWidthLayoutChange={setRowWidthLayout}
            onActivate={onActivate}
          />
        );
      }}
    />
  );
});

function UnifiedAgentsRow({
  rowAgents,
  rowLayoutKey,
  rowStartIndex,
  rowIndex,
  rowHeight,
  rowWidthLayout,
  activeIndex,
  onRowHeightChange,
  onRowWidthLayoutChange,
  onActivate,
}: {
  rowAgents: UnifiedAgentEntry[];
  rowLayoutKey: RowLayoutKey;
  rowStartIndex: number;
  rowIndex: number;
  rowHeight: number;
  rowWidthLayout: PanelLayout | undefined;
  activeIndex: number;
  onRowHeightChange: (rowLayoutKey: RowLayoutKey, height: number, persist: boolean) => void;
  onRowWidthLayoutChange: (rowLayoutKey: RowLayoutKey, layout: PanelLayout) => void;
  onActivate: (index: number) => void;
}): ReactElement {
  const onLayoutChanged = useCallback(
    (layout: PanelLayout): void => onRowWidthLayoutChange(rowLayoutKey, layout),
    [onRowWidthLayoutChange, rowLayoutKey],
  );

  return (
    <div className={cn("px-1.5", rowIndex === 0 && "pt-2")}>
      <div style={{ height: rowHeight }} className="min-h-[420px]">
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-full"
          onLayoutChanged={onLayoutChanged}
          style={SHADOW_FRIENDLY_OVERFLOW}
        >
          {rowAgents.map((entry, offset) => {
            const index = rowStartIndex + offset;
            const panelId = getAgentPanelId(entry);
            return (
              <RowPanel
                key={panelId}
                entry={entry}
                panelId={panelId}
                defaultSize={rowWidthLayout?.[panelId]}
                index={index}
                isActive={index === activeIndex}
                isLast={offset === rowAgents.length - 1}
                onActivate={onActivate}
              />
            );
          })}
        </ResizablePanelGroup>
      </div>
      <RowResizeHandle
        rowLayoutKey={rowLayoutKey}
        rowIndex={rowIndex}
        rowHeight={rowHeight}
        onRowHeightChange={onRowHeightChange}
      />
    </div>
  );
}

function RowResizeHandle({
  rowLayoutKey,
  rowIndex,
  rowHeight,
  onRowHeightChange,
}: {
  rowLayoutKey: RowLayoutKey;
  rowIndex: number;
  rowHeight: number;
  onRowHeightChange: (rowLayoutKey: RowLayoutKey, height: number, persist: boolean) => void;
}): ReactElement {
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.preventDefault();
      dragRef.current = { startY: event.clientY, startHeight: rowHeight };
      pushResize();
      const onMove = (moveEvent: PointerEvent): void => {
        const drag = dragRef.current;
        if (!drag) return;
        const next = clampRowHeight(drag.startHeight + moveEvent.clientY - drag.startY);
        onRowHeightChange(rowLayoutKey, next, false);
      };
      const onEnd = (endEvent: PointerEvent): void => {
        const drag = dragRef.current;
        dragRef.current = null;
        cleanupRef.current?.();
        cleanupRef.current = null;
        if (!drag) return;
        const next = clampRowHeight(drag.startHeight + endEvent.clientY - drag.startY);
        onRowHeightChange(rowLayoutKey, next, true);
      };
      cleanupRef.current = () => {
        popResize();
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    },
    [onRowHeightChange, rowHeight, rowLayoutKey],
  );
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={`Resize agent row ${rowIndex + 1}`}
      className={cn(
        "group relative mt-1 flex h-3 cursor-row-resize items-center justify-center",
        "before:absolute before:left-0 before:right-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:opacity-0 before:transition-opacity",
        "before:[background:repeating-linear-gradient(to_right,var(--border)_0_4px,transparent_4px_8px)]",
        "before:[mask-image:linear-gradient(to_right,transparent,black_20%,black_80%,transparent)]",
        "hover:before:opacity-100",
      )}
      onPointerDown={onPointerDown}
    >
      <div className="pointer-events-none z-10 h-1 w-8 rounded-full bg-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}

function RowPanel({
  entry,
  panelId,
  defaultSize,
  index,
  isActive,
  isLast,
  onActivate,
}: {
  entry: UnifiedAgentEntry;
  panelId: string;
  defaultSize: number | undefined;
  index: number;
  isActive: boolean;
  isLast: boolean;
  onActivate: (index: number) => void;
}): ReactElement {
  return (
    <>
      <ResizablePanel
        id={panelId}
        defaultSize={defaultSize}
        minSize={12}
        className="min-w-0 px-1.5"
        style={SHADOW_FRIENDLY_OVERFLOW}
      >
        <UnifiedAgentCard entry={entry} index={index} isActive={isActive} onActivate={onActivate} />
      </ResizablePanel>
      {!isLast && <ResizableHandle className="bg-transparent" />}
    </>
  );
}

function chunkAgents(entries: UnifiedAgentEntry[], columns: number): UnifiedAgentEntry[][] {
  const rows: UnifiedAgentEntry[][] = [];
  for (let index = 0; index < entries.length; index += columns) {
    rows.push(entries.slice(index, index + columns));
  }
  return rows;
}

function useRowHeights(): {
  rowHeights: RowHeightMap;
  setRowHeight: (rowLayoutKey: RowLayoutKey, height: number, persist: boolean) => void;
} {
  const [rowHeights, setRowHeights] = useState<RowHeightMap>(loadRowHeights);
  const setRowHeight = useCallback(
    (rowLayoutKey: RowLayoutKey, height: number, persist: boolean): void => {
      const nextHeight = clampRowHeight(height);
      setRowHeights((current) => {
        const next = { ...current, [rowLayoutKey]: nextHeight };
        if (persist) saveRowHeights(next);
        return next;
      });
    },
    [],
  );
  return { rowHeights, setRowHeight };
}

function useRowWidths(): {
  rowWidths: RowWidthLayouts;
  setRowWidthLayout: (rowLayoutKey: RowLayoutKey, layout: PanelLayout) => void;
} {
  const [rowWidths, setRowWidths] = useState<RowWidthLayouts>(loadRowWidths);
  const setRowWidthLayout = useCallback((rowLayoutKey: RowLayoutKey, layout: PanelLayout): void => {
    setRowWidths((current) => {
      const next = { ...current, [rowLayoutKey]: layout };
      saveRowWidths(next);
      return next;
    });
  }, []);
  return { rowWidths, setRowWidthLayout };
}

function loadRowHeights(): RowHeightMap {
  return loadJson(ROW_HEIGHTS_KEY, parseUnifiedAgentsRowHeights, "heights");
}

function loadRowWidths(): RowWidthLayouts {
  return loadJson(ROW_WIDTHS_KEY, parseUnifiedAgentsRowWidths, "widths");
}

function loadJson<T>(key: string, parse: (value: unknown) => T, label: string): T {
  const fallback = parse(undefined);
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? parse(JSON.parse(raw) as unknown) : fallback;
  } catch (error: unknown) {
    notifyPersistenceError(`Could not load saved agent grid ${label}.`, error);
    return fallback;
  }
}

function saveRowHeights(rowHeights: RowHeightMap): void {
  saveJson(ROW_HEIGHTS_KEY, rowHeights, "heights");
}

function saveRowWidths(rowWidths: RowWidthLayouts): void {
  saveJson(ROW_WIDTHS_KEY, rowWidths, "widths");
}

function saveJson(key: string, value: unknown, label: string): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error: unknown) {
    notifyPersistenceError(`Could not save agent grid ${label}.`, error);
  }
}

function clampRowHeight(height: number): number {
  return Math.max(MIN_ROW_HEIGHT, Math.min(MAX_ROW_HEIGHT, Math.round(height)));
}

function getRowLayoutKey(rowIndex: number, columns: number): RowLayoutKey {
  return buildUnifiedAgentsRowLayoutKey(columns, rowIndex);
}

function getAgentPanelId(entry: UnifiedAgentEntry): string {
  return buildUnifiedAgentPanelId(entry.project.id, entry.feature.id, entry.session.sessionDbId);
}

function getStoredRowWidthLayout(
  rowAgents: UnifiedAgentEntry[],
  layout: PanelLayout | undefined,
): PanelLayout | undefined {
  if (!layout) return undefined;
  const panelIds = rowAgents.map(getAgentPanelId);
  return panelIds.every((panelId) => typeof layout[panelId] === "number") ? layout : undefined;
}

function notifyPersistenceError(message: string, error: unknown): void {
  console.error(message, error);
  window.queueMicrotask(() => toast.error(message));
}

export function buildUnifiedAgentsRowLayoutKey(columns: number, rowIndex: number): string {
  return `columns:${columns}|row:${rowIndex}`;
}

export function buildUnifiedAgentPanelId(
  projectId: number,
  featureId: number,
  sessionDbId: number,
): string {
  return `agent-${projectId}-${featureId}-${sessionDbId}`;
}

export function parseUnifiedAgentsRowHeights(value: unknown): RowHeightMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value).reduce<RowHeightMap>((accumulator, [key, height]) => {
    if (typeof height === "number" && Number.isFinite(height)) {
      accumulator[key] = clampRowHeight(height);
    }
    return accumulator;
  }, {});
}

export function parseUnifiedAgentsRowWidths(value: unknown): RowWidthLayouts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value).reduce<RowWidthLayouts>((accumulator, [rowKey, layout]) => {
    const parsedLayout = parsePanelLayout(layout);
    if (parsedLayout) accumulator[rowKey] = parsedLayout;
    return accumulator;
  }, {});
}

function parsePanelLayout(value: unknown): PanelLayout | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const layout = Object.entries(value).reduce<PanelLayout>((accumulator, [panelId, size]) => {
    if (typeof size === "number" && Number.isFinite(size) && size >= 0 && size <= 100) {
      accumulator[panelId] = size;
    }
    return accumulator;
  }, {});
  return Object.keys(layout).length > 0 ? layout : undefined;
}
