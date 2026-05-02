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
import { useScopedHotkeys } from "@/hooks/useScopedHotkeys";
import { XTermInstance, type XTermInstanceHandle } from "./XTermInstance";
import { PaneSlotPlaceholder } from "./PaneSlotPlaceholder";
import {
  type TerminalPanelState,
  type SplitOrientation,
  type SplitNode,
  getLeaves,
  findAdjacentLeaf,
  useTerminalStore,
} from "@/hooks/useTerminalState";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useTheme } from "@/hooks/useTheme";

// ---------------------------------------------------------------------------
// Props & handle
// ---------------------------------------------------------------------------

interface TerminalPanelProps {
  featureId: number;
  projectId: number;
  state: TerminalPanelState;
  splitPane: (leafId: string | undefined, orientation: SplitOrientation) => void;
  removePane: (paneId: string) => void;
  /** Working directory the feature currently expects (worktree path or project root). */
  expectedCwd: string | null;
}

// Theme colors come from CSS vars defined per theme in index.css. Tailwind's
// arbitrary-value `[var(--…)]` syntax keeps the JIT classes stable while still
// resolving against the active `<html data-theme="…">`.
const ICON_BTN =
  "flex size-6 items-center justify-center rounded text-[var(--terminal-panel-icon)] transition-colors hover:bg-[var(--terminal-panel-icon-bg-hover)] hover:text-[var(--terminal-panel-icon-hover)]";

export interface TerminalPanelHandle {
  focusActivePane: () => void;
}

// ---------------------------------------------------------------------------
// Persistent slot management — DOM elements that outlive React reconciliation
// ---------------------------------------------------------------------------

function createSlotElement(id: string): HTMLDivElement {
  const el = document.createElement("div");
  // Slot sits inside a flex-column placeholder alongside the optional cwd
  // warning banner. `flex: 1` lets xterm fill the remaining space; the explicit
  // min-height: 0 prevents overflow when the warning is present.
  el.style.flex = "1 1 0";
  el.style.minHeight = "0";
  el.style.width = "100%";
  el.setAttribute("data-pane-slot", id);
  return el;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(
  function TerminalPanel({ featureId, projectId, state, splitPane, removePane, expectedCwd }, ref) {
    const { isMinimized, root } = state;
    const leaves = useMemo(() => (root ? getLeaves(root) : []), [root]);
    const paneRefs = useRef<Map<string, XTermInstanceHandle>>(new Map());
    const [activePaneId, setActivePaneId] = useState<string | null>(null);
    // xterm canvas can't read CSS vars — feed the palette in as a prop.
    const { theme } = useTheme();
    const xtermPalette = theme.xterm;
    const setPtyId = useTerminalStore((s) => s.setPtyId);
    const setPaneCwd = useTerminalStore((s) => s.setPaneCwd);
    const dismissCwdWarning = useTerminalStore((s) => s.dismissCwdWarning);
    const replaceLeafWithFresh = useTerminalStore((s) => s.replaceLeafWithFresh);
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

    // Remove slots for leaves that no longer exist. Note: we deliberately do
    // NOT have a separate `useEffect(() => return cleanup, [])` that empties
    // `slotsRef` on unmount. Under React StrictMode (dev) such a cleanup runs
    // mid-life (mount → cleanup → remount), wiping the Map. A subsequent
    // re-render — e.g. when the WS sets `ptyId` via `setPtyId` — then walks
    // an empty Map, creates a *fresh* slot for the same leaf, and React's
    // `createPortal` unmounts xterm from the old slot and mounts it in the
    // new one. The old, orphaned slot stays parented under the placeholder
    // (re-appended by the `useLayoutEffect` re-run), so we end up with two
    // sibling slots: an empty one (visible) and the live one (overflowed
    // out of the parent's `overflow-hidden`, invisible). The result is a
    // blank pane even though xterm is fully wired up. Slots are children
    // of `placeholder`, so they're cleaned up automatically when this
    // component unmounts and React removes the placeholder.
    useEffect(() => {
      const activeIds = new Set(leaves.map((l) => l.id));
      for (const [id, el] of slotsRef.current) {
        if (!activeIds.has(id)) {
          el.remove();
          slotsRef.current.delete(id);
        }
      }
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

    const focusPane = useCallback(
      (paneId: string) => {
        paneRefs.current.get(paneId)?.focus();
        setActivePane(paneId);
      },
      [setActivePane],
    );

    const focusPaneByIndex = useCallback(
      (index: number) => {
        if (leaves.length === 0) return;
        const clamped = Math.max(0, Math.min(leaves.length - 1, index));
        const leaf = leaves[clamped];
        if (leaf) focusPane(leaf.id);
      },
      [leaves, focusPane],
    );

    const focusFirstPane = useCallback(() => focusPaneByIndex(0), [focusPaneByIndex]);

    const activeIndex = Math.max(
      0,
      leaves.findIndex((l) => l.id === activePaneId),
    );
    const resolvedActivePaneId = leaves[activeIndex]?.id ?? null;

    useImperativeHandle(
      ref,
      () => ({
        focusActivePane: () => focusPaneByIndex(activeIndex),
      }),
      [activeIndex, focusPaneByIndex],
    );

    // -- Keyboard shortcuts --
    // All terminal pane shortcuts are scoped to the terminal tab so they
    // don't fire when the user has another tab focused.

    useScopedHotkeys(
      "meta+d",
      (e) => {
        e.preventDefault();
        splitPane(resolvedActivePaneId ?? undefined, "horizontal");
      },
      "terminal",
      undefined,
      [splitPane, resolvedActivePaneId],
    );

    useScopedHotkeys(
      "meta+shift+d",
      (e) => {
        e.preventDefault();
        splitPane(resolvedActivePaneId ?? undefined, "vertical");
      },
      "terminal",
      undefined,
      [splitPane, resolvedActivePaneId],
    );

    const navigatePane = useCallback(
      (direction: "left" | "right" | "up" | "down") => {
        if (!root || !resolvedActivePaneId) return;
        const target = findAdjacentLeaf(root, resolvedActivePaneId, direction);
        if (target) focusPane(target);
      },
      [root, resolvedActivePaneId, focusPane],
    );

    useScopedHotkeys(
      ["meta+alt+left", "meta+alt+right", "meta+alt+up", "meta+alt+down"],
      (e, handler) => {
        e.preventDefault();
        const dir = handler.keys?.[0];
        if (dir === "left" || dir === "right" || dir === "up" || dir === "down") {
          navigatePane(dir);
        }
      },
      "terminal",
      undefined,
      [navigatePane],
    );

    // Use ref for leaves so closePane stays stable
    const leavesRef = useRef(leaves);
    leavesRef.current = leaves;

    const closePane = useCallback(
      (paneId: string) => {
        paneRefs.current.get(paneId)?.markForKill();
        const currentLeaves = leavesRef.current;
        const idx = currentLeaves.findIndex((l) => l.id === paneId);
        const neighborIndex = idx > 0 ? idx - 1 : idx + 1;
        const neighbor = currentLeaves[neighborIndex];
        removePane(paneId);
        if (neighbor) {
          requestAnimationFrame(() => focusPane(neighbor.id));
        }
      },
      [removePane, focusPane],
    );

    const handlePaneExit = useCallback(
      (_ptyId: string, paneId: string) => {
        setTimeout(() => closePane(paneId), 500);
      },
      [closePane],
    );

    // Mark the old PTY for kill, then swap the leaf in-place so React
    // unmounts the stale XTermInstance and mounts a fresh one — which spawns
    // a new PTY at the feature's current expected cwd.
    const restartPane = useCallback(
      (paneId: string) => {
        paneRefs.current.get(paneId)?.markForKill();
        replaceLeafWithFresh(featureId, paneId);
      },
      [replaceLeafWithFresh, featureId],
    );

    const dismissPaneWarning = useCallback(
      (paneId: string) => dismissCwdWarning(featureId, paneId),
      [dismissCwdWarning, featureId],
    );

    const registerPlaceholder = useCallback((id: string, el: HTMLDivElement | null) => {
      if (el) placeholderRefs.current.set(id, el);
      else placeholderRefs.current.delete(id);
    }, []);

    // -- Tree layout (empty placeholders — no XTermInstances) --

    const renderTreeNode = useCallback(
      (node: SplitNode): React.ReactNode => {
        if (node.type === "leaf") {
          return (
            <PaneSlotPlaceholder
              leaf={node}
              expectedCwd={expectedCwd}
              registerPlaceholder={registerPlaceholder}
              onFocus={focusPane}
              onRestart={restartPane}
              onDismiss={dismissPaneWarning}
            />
          );
        }
        const [a, b] = node.children;
        const isVertical = node.orientation === "vertical";
        return (
          <ResizablePanelGroup orientation={node.orientation} className="h-full">
            <ResizablePanel minSize={10}>{renderTreeNode(a)}</ResizablePanel>
            <ResizableHandle
              className={
                isVertical
                  ? "!h-0.5 !w-full bg-[var(--terminal-panel-handle-bg)] hover:bg-[var(--terminal-panel-handle-bg-hover)] transition-colors"
                  : "bg-[var(--terminal-panel-handle-bg)] hover:bg-[var(--terminal-panel-handle-bg-hover)] transition-colors"
              }
            />
            <ResizablePanel minSize={10}>{renderTreeNode(b)}</ResizablePanel>
          </ResizablePanelGroup>
        );
      },
      [focusPane, expectedCwd, registerPlaceholder, restartPane, dismissPaneWarning],
    );

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
          <ShortcutTooltip label="Split horizontal" keys={["cmd", "shift", "D"]} alignRight>
            <button
              type="button"
              onClick={() => splitPane(resolvedActivePaneId ?? undefined, "vertical")}
              className={ICON_BTN}
            >
              <SplitSquareVertical className="size-3.5" />
            </button>
          </ShortcutTooltip>
          {leaves.length > 0 && (
            <ShortcutTooltip label="Close terminal" alignRight>
              <button
                type="button"
                onClick={() => {
                  if (resolvedActivePaneId) closePane(resolvedActivePaneId);
                }}
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
              requestedCwd={expectedCwd ?? undefined}
              theme={xtermPalette}
              initialCommand={leaf.initialCommand}
              onInitialCommandConsumed={() => clearInitialCommand(featureId, leaf.id)}
              onPtyReady={(ptyId, cwd) => {
                setPtyId(featureId, leaf.id, ptyId);
                if (cwd) setPaneCwd(featureId, leaf.id, cwd);
              }}
              onExit={(ptyId) => handlePaneExit(ptyId, leaf.id)}
              onTerminalFocus={() => setActivePane(leaf.id)}
            />,
            slot,
            leaf.id,
          ),
        )}
      </div>
    );
  },
);
