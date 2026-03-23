import { Fragment, forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { Plus, SplitSquareHorizontal, Minus, X, TerminalIcon } from "lucide-react";
import { useHotkeys } from "react-hotkeys-hook";
import { XTermInstance, type XTermInstanceHandle } from "./XTermInstance";
import { type TerminalPanelState, useTerminalStore } from "@/hooks/useTerminalState";
import { getActiveFocusZone } from "@/lib/focus-zones";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

interface TerminalPanelProps {
  featureId: number;
  projectId: number;
  /** Terminal panel state (provided by parent via useTerminalState) */
  state: TerminalPanelState;
  togglePanel: () => void;
  addPane: () => void;
  removePane: (paneId: string) => void;
  minimize: () => void;
  /** Mousedown handler for the toolbar — used by the parent to implement drag-to-resize */
  onToolbarMouseDown?: (e: React.MouseEvent) => void;
  /** Called when terminal is collapsed/minimized — parent can use this to refocus the prompt */
  onCollapse?: () => void;
}

export interface TerminalPanelHandle {
  /** Focus the active (or first) terminal pane */
  focusActivePane: () => void;
}

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(function TerminalPanel({
  featureId,
  projectId,
  state,
  togglePanel,
  addPane,
  removePane,
  minimize,
  onToolbarMouseDown,
  onCollapse,
}, ref) {
  const { isMinimized, panes } = state;
  const paneRefs = useRef<Map<string, XTermInstanceHandle>>(new Map());
  const [activePaneIndex, setActivePaneIndex] = useState(0);
  const setPtyId = useTerminalStore((s) => s.setPtyId);
  const clearInitialCommand = useTerminalStore((s) => s.clearInitialCommand);

  const setPaneRef = useCallback((paneId: string, handle: XTermInstanceHandle | null) => {
    if (handle) {
      paneRefs.current.set(paneId, handle);
    } else {
      paneRefs.current.delete(paneId);
    }
  }, []);

  /** Focus a pane by its ID and track it as active */
  const focusPane = useCallback((paneId: string) => {
    paneRefs.current.get(paneId)?.focus();
    const index = panes.findIndex((p) => p.id === paneId);
    if (index >= 0) setActivePaneIndex(index);
  }, [panes]);

  /** Focus a pane by index (clamped to valid range) */
  const focusPaneByIndex = useCallback((index: number) => {
    if (panes.length === 0) return;
    const clamped = Math.max(0, Math.min(panes.length - 1, index));
    const pane = panes[clamped];
    if (pane) {
      paneRefs.current.get(pane.id)?.focus();
      setActivePaneIndex(clamped);
    }
  }, [panes]);

  /** Focus the first available pane */
  const focusFirstPane = useCallback(() => {
    focusPaneByIndex(0);
  }, [focusPaneByIndex]);

  useImperativeHandle(ref, () => ({
    focusActivePane: () => {
      focusPaneByIndex(activePaneIndex);
    },
  }), [activePaneIndex, focusPaneByIndex]);

  // CMD+OPT+LEFT — focus previous terminal pane
  useHotkeys(
    "meta+alt+left",
    (e) => {
      if (getActiveFocusZone() !== "terminal") return;
      e.preventDefault();
      focusPaneByIndex(activePaneIndex - 1);
    },
    { enableOnFormTags: true },
    [activePaneIndex, focusPaneByIndex],
  );

  // CMD+OPT+RIGHT — focus next terminal pane
  useHotkeys(
    "meta+alt+right",
    (e) => {
      if (getActiveFocusZone() !== "terminal") return;
      e.preventDefault();
      focusPaneByIndex(activePaneIndex + 1);
    },
    { enableOnFormTags: true },
    [activePaneIndex, focusPaneByIndex],
  );

  /** Close a pane and move focus to the nearest neighbor (previous, or next if first) */
  const closePane = useCallback((paneId: string) => {
    // Mark the XTerm instance to kill its PTY before React unmounts it
    paneRefs.current.get(paneId)?.markForKill();

    const index = panes.findIndex((p) => p.id === paneId);
    const neighborIndex = index > 0 ? index - 1 : index + 1;
    const neighbor = panes[neighborIndex];
    removePane(paneId);
    if (neighbor) {
      const newActiveIndex = index > 0 ? index - 1 : 0;
      requestAnimationFrame(() => {
        paneRefs.current.get(neighbor.id)?.focus();
        setActivePaneIndex(newActiveIndex);
      });
    }
  }, [panes, removePane]);

  const handlePaneExit = useCallback(
    (_ptyId: string, paneId: string) => {
      // Auto-remove pane when the shell process exits (e.g. Ctrl+D)
      // Small delay so the user can see the exit message
      setTimeout(() => closePane(paneId), 500);
    },
    [closePane],
  );

  return (
    <div
      className="flex h-full flex-col"
      data-focus-zone="terminal"
      tabIndex={0}
      onFocus={(e) => {
        // When the zone wrapper itself receives focus (e.g. from focus cycling), delegate to first pane
        if (e.target === e.currentTarget) {
          focusFirstPane();
        }
      }}
    >
      {/* Toolbar — always visible when panel is open. Also acts as the drag-to-resize handle. */}
      <div
        className="flex h-8 shrink-0 cursor-row-resize items-center justify-between border-b border-[#292e42] bg-[#1a1b26] px-2 select-none"
        onMouseDown={onToolbarMouseDown}
      >
        <div className="flex items-center gap-1.5">
          <TerminalIcon className="size-3.5 text-[#565f89]" />
          <span className="text-xs font-medium text-[#a9b1d6]">Terminal</span>
          <span className="ml-0.5 text-xs text-[#565f89]">
            ({panes.length})
          </span>
        </div>
        {/* Stop mousedown from bubbling to the toolbar drag handler when clicking buttons */}
        <div className="flex items-center gap-0.5" onMouseDown={(e) => e.stopPropagation()}>
          {/* New terminal */}
          <button
            type="button"
            onClick={addPane}
            className="flex size-6 items-center justify-center rounded text-[#565f89] transition-colors hover:bg-[#292e42] hover:text-[#c0caf5]"
            title="New terminal (Ctrl+Shift+`)"
          >
            <Plus className="size-3.5" />
          </button>
          {/* Split */}
          <button
            type="button"
            onClick={addPane}
            className="flex size-6 items-center justify-center rounded text-[#565f89] transition-colors hover:bg-[#292e42] hover:text-[#c0caf5]"
            title="Split terminal (Ctrl+Shift+`)"
          >
            <SplitSquareHorizontal className="size-3.5" />
          </button>
          {/* Minimize / Restore */}
          <button
            type="button"
            onClick={() => {
              if (isMinimized) {
                togglePanel();
              } else {
                minimize();
                onCollapse?.();
              }
            }}
            className="flex size-6 items-center justify-center rounded text-[#565f89] transition-colors hover:bg-[#292e42] hover:text-[#c0caf5]"
            title={isMinimized ? "Restore terminal" : "Minimize terminal"}
          >
            <Minus className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal panes — hidden when minimized but kept mounted so PTYs stay alive */}
      <div
        className="min-h-0 flex-1 overflow-hidden transition-[height] duration-150 ease-in-out"
        style={isMinimized ? { height: 0, minHeight: 0 } : undefined}
      >
        {/* Always render through ResizablePanelGroup so XTermInstance is never unmounted
            when adding/removing panes (a tree structure change would cause remounting). */}
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          {panes.map((pane, index) => (
            <Fragment key={pane.id}>
              {index > 0 && (
                <ResizableHandle className="bg-[#292e42] hover:bg-[#3b4261] transition-colors" />
              )}
              <ResizablePanel minSize={10}>
                <div
                  className="relative h-full cursor-text"
                  onClick={() => focusPane(pane.id)}
                  onFocus={() => focusPane(pane.id)}
                >
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); closePane(pane.id); }}
                    className="absolute right-2 top-1 z-10 flex size-5 items-center justify-center rounded text-[#565f89] transition-colors hover:bg-[#292e42] hover:text-[#c0caf5]"
                    title="Close terminal"
                  >
                    <X className="size-3" />
                  </button>
                  <XTermInstance
                    ref={(handle) => setPaneRef(pane.id, handle)}
                    featureId={featureId}
                    projectId={projectId}
                    existingPtyId={pane.ptyId}
                    initialCommand={pane.initialCommand}
                    onInitialCommandConsumed={() => clearInitialCommand(featureId, pane.id)}
                    onPtyReady={(ptyId) => setPtyId(featureId, pane.id, ptyId)}
                    onExit={(ptyId) => handlePaneExit(ptyId, pane.id)}
                  />
                </div>
              </ResizablePanel>
            </Fragment>
          ))}
        </ResizablePanelGroup>
      </div>
    </div>
  );
});
