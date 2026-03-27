import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { SplitSquareHorizontal, SplitSquareVertical, X } from "lucide-react";
import { useHotkeys } from "react-hotkeys-hook";
import { XTermInstance, type XTermInstanceHandle } from "./XTermInstance";
import {
  type TerminalPanelState,
  type SplitOrientation,
  type SplitNode,
  getLeaves,
  useTerminalStore,
} from "@/hooks/useTerminalState";
import { getActiveFocusZone } from "@/lib/focus-zones";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

// ---------------------------------------------------------------------------
// Props & handle
// ---------------------------------------------------------------------------

interface TerminalPanelProps {
  featureId: number;
  projectId: number;
  state: TerminalPanelState;
  splitPane: (leafId: string | undefined, orientation: SplitOrientation) => void;
  removePane: (paneId: string) => void;
}

const ICON_BTN = "flex size-6 items-center justify-center rounded text-[#565f89] transition-colors hover:bg-[#292e42] hover:text-[#c0caf5]";

export interface TerminalPanelHandle {
  focusActivePane: () => void;
}

// ---------------------------------------------------------------------------
// Persistent slot management — DOM elements that outlive React reconciliation
// ---------------------------------------------------------------------------

function createSlotElement(id: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.width = "100%";
  el.style.height = "100%";
  el.setAttribute("data-pane-slot", id);
  return el;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(function TerminalPanel({
  featureId,
  projectId,
  state,
  splitPane,
  removePane,
}, ref) {
  const { isMinimized, root } = state;
  const leaves = useMemo(() => (root ? getLeaves(root) : []), [root]);
  const paneRefs = useRef<Map<string, XTermInstanceHandle>>(new Map());
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const setPtyId = useTerminalStore((s) => s.setPtyId);
  const clearInitialCommand = useTerminalStore((s) => s.clearInitialCommand);

  // Persistent slot DOM elements — one per leaf, never recreated
  const slotsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const placeholderRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const getSlot = useCallback((id: string): HTMLDivElement => {
    let slot = slotsRef.current.get(id);
    if (!slot) {
      slot = createSlotElement(id);
      slotsRef.current.set(id, slot);
    }
    return slot;
  }, []);

  // Ensure slots exist for current leaves (called during render so portals have targets)
  const activeSlots = leaves.map((leaf) => ({ leaf, slot: getSlot(leaf.id) }));

  // Cleanup removed slots and full unmount cleanup
  useEffect(() => {
    const activeIds = new Set(leaves.map((l) => l.id));
    for (const [id, el] of [...slotsRef.current]) {
      if (!activeIds.has(id)) {
        el.remove();
        slotsRef.current.delete(id);
      }
    }
    return () => {
      for (const el of slotsRef.current.values()) el.remove();
      slotsRef.current.clear();
    };
  }, [leaves]);

  const setPaneRef = useCallback((paneId: string, handle: XTermInstanceHandle | null) => {
    if (handle) paneRefs.current.set(paneId, handle);
    else paneRefs.current.delete(paneId);
  }, []);

  /** Blur all terminals except the given one, and update active state */
  const setActivePane = useCallback((paneId: string) => {
    setActivePaneId(paneId);
    for (const [id, handle] of paneRefs.current) {
      if (id !== paneId) handle.blur();
    }
  }, []);

  const focusPane = useCallback((paneId: string) => {
    paneRefs.current.get(paneId)?.focus();
    setActivePane(paneId);
  }, [setActivePane]);

  const focusPaneByIndex = useCallback((index: number) => {
    if (leaves.length === 0) return;
    const clamped = Math.max(0, Math.min(leaves.length - 1, index));
    const leaf = leaves[clamped];
    if (leaf) focusPane(leaf.id);
  }, [leaves, focusPane]);

  const focusFirstPane = useCallback(() => focusPaneByIndex(0), [focusPaneByIndex]);

  const activeIndex = Math.max(0, leaves.findIndex((l) => l.id === activePaneId));
  const resolvedActivePaneId = leaves[activeIndex]?.id ?? null;

  useImperativeHandle(ref, () => ({
    focusActivePane: () => focusPaneByIndex(activeIndex),
  }), [activeIndex, focusPaneByIndex]);

  // -- Keyboard shortcuts --

  useHotkeys("meta+d", (e) => {
    if (getActiveFocusZone() !== "terminal") return;
    e.preventDefault();
    splitPane(resolvedActivePaneId ?? undefined, "horizontal");
  }, { enableOnFormTags: true, enableOnContentEditable: true }, [splitPane, resolvedActivePaneId]);

  useHotkeys("meta+shift+d", (e) => {
    if (getActiveFocusZone() !== "terminal") return;
    e.preventDefault();
    splitPane(resolvedActivePaneId ?? undefined, "vertical");
  }, { enableOnFormTags: true, enableOnContentEditable: true }, [splitPane, resolvedActivePaneId]);

  useHotkeys("meta+alt+left", (e) => {
    if (getActiveFocusZone() !== "terminal") return;
    e.preventDefault();
    focusPaneByIndex(activeIndex - 1);
  }, { enableOnFormTags: true, enableOnContentEditable: true }, [activeIndex, focusPaneByIndex]);

  useHotkeys("meta+alt+right", (e) => {
    if (getActiveFocusZone() !== "terminal") return;
    e.preventDefault();
    focusPaneByIndex(activeIndex + 1);
  }, { enableOnFormTags: true, enableOnContentEditable: true }, [activeIndex, focusPaneByIndex]);

  // Use ref for leaves so closePane stays stable
  const leavesRef = useRef(leaves);
  leavesRef.current = leaves;

  const closePane = useCallback((paneId: string) => {
    paneRefs.current.get(paneId)?.markForKill();
    const currentLeaves = leavesRef.current;
    const idx = currentLeaves.findIndex((l) => l.id === paneId);
    const neighborIndex = idx > 0 ? idx - 1 : idx + 1;
    const neighbor = currentLeaves[neighborIndex];
    removePane(paneId);
    if (neighbor) {
      requestAnimationFrame(() => focusPane(neighbor.id));
    }
  }, [removePane, focusPane]);

  const handlePaneExit = useCallback(
    (_ptyId: string, paneId: string) => {
      setTimeout(() => closePane(paneId), 500);
    },
    [closePane],
  );

  // -- Tree layout (empty placeholders — no XTermInstances) --

  const renderTreeNode = useCallback((node: SplitNode): React.ReactNode => {
    if (node.type === "leaf") {
      return (
        <div
          ref={(el) => {
            if (el) placeholderRefs.current.set(node.id, el);
            else placeholderRefs.current.delete(node.id);
          }}
          className="h-full w-full"
          onClick={() => focusPane(node.id)}
        />
      );
    }
    const [a, b] = node.children;
    const isVertical = node.orientation === "vertical";
    return (
      <ResizablePanelGroup orientation={node.orientation} className="h-full">
        <ResizablePanel minSize={10}>
          {renderTreeNode(a)}
        </ResizablePanel>
        <ResizableHandle
          className={
            isVertical
              ? "!h-0.5 !w-full bg-[#292e42] hover:bg-[#3b4261] transition-colors"
              : "bg-[#292e42] hover:bg-[#3b4261] transition-colors"
          }
        />
        <ResizablePanel minSize={10}>
          {renderTreeNode(b)}
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }, [focusPane]);

  // Move persistent slots into placeholders before paint
  useLayoutEffect(() => {
    for (const { leaf, slot } of activeSlots) {
      const placeholder = placeholderRefs.current.get(leaf.id);
      if (placeholder && slot.parentNode !== placeholder) {
        placeholder.appendChild(slot);
      }
    }
  }, [activeSlots]);

  return (
    <div
      className="relative flex h-full flex-col"
      data-focus-zone="terminal"
      tabIndex={0}
      onFocus={(e) => {
        if (e.target === e.currentTarget) focusFirstPane();
      }}
    >
      {/* Floating action buttons */}
      <div className="absolute right-2 top-1 z-10 flex items-center gap-0.5">
        <ShortcutTooltip label="Split vertical" keys={["cmd", "D"]}>
          <button
            type="button"
            onClick={() => splitPane(resolvedActivePaneId ?? undefined, "horizontal")}
            className={ICON_BTN}
          >
            <SplitSquareHorizontal className="size-3.5" />
          </button>
        </ShortcutTooltip>
        <ShortcutTooltip label="Split horizontal" keys={["cmd", "shift", "D"]}>
          <button
            type="button"
            onClick={() => splitPane(resolvedActivePaneId ?? undefined, "vertical")}
            className={ICON_BTN}
          >
            <SplitSquareVertical className="size-3.5" />
          </button>
        </ShortcutTooltip>
        {leaves.length > 0 && (
          <ShortcutTooltip label="Close terminal">
            <button
              type="button"
              onClick={() => { if (resolvedActivePaneId) closePane(resolvedActivePaneId); }}
              className={ICON_BTN}
            >
              <X className="size-3" />
            </button>
          </ShortcutTooltip>
        )}
      </div>

      {/* Split tree layout — provides resizable placeholders */}
      <div
        className="min-h-0 flex-1 overflow-hidden transition-[height] duration-150 ease-in-out"
        style={isMinimized ? { height: 0, minHeight: 0 } : undefined}
      >
        {root && renderTreeNode(root)}
      </div>

      {/* XTermInstances via portals into persistent slot elements — never unmount */}
      {activeSlots.map(({ leaf, slot }) =>
        createPortal(
          <XTermInstance
            key={leaf.id}
            ref={(handle) => setPaneRef(leaf.id, handle)}
            featureId={featureId}
            projectId={projectId}
            existingPtyId={leaf.ptyId}
            initialCommand={leaf.initialCommand}
            onInitialCommandConsumed={() => clearInitialCommand(featureId, leaf.id)}
            onPtyReady={(ptyId) => setPtyId(featureId, leaf.id, ptyId)}
            onExit={(ptyId) => handlePaneExit(ptyId, leaf.id)}
            onTerminalFocus={() => setActivePane(leaf.id)}
          />,
          slot,
          leaf.id,
        ),
      )}
    </div>
  );
});
