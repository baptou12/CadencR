import { useCallback, useRef } from "react";
import { Plus, SplitSquareHorizontal, Minus, X, TerminalIcon } from "lucide-react";
import { XTermInstance, type XTermInstanceHandle } from "./XTermInstance";
import type { TerminalPanelState } from "@/hooks/useTerminalState";
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
}

export function TerminalPanel({
  featureId,
  projectId,
  state,
  togglePanel,
  addPane,
  removePane,
  minimize,
}: TerminalPanelProps) {
  const { isOpen, isMinimized, panes } = state;
  const paneRefs = useRef<Map<string, XTermInstanceHandle>>(new Map());

  const setPaneRef = useCallback((paneId: string, handle: XTermInstanceHandle | null) => {
    if (handle) {
      paneRefs.current.set(paneId, handle);
    } else {
      paneRefs.current.delete(paneId);
    }
  }, []);

  /** Focus a specific pane's terminal */
  const focusPane = useCallback((paneId: string) => {
    paneRefs.current.get(paneId)?.focus();
  }, []);

  /** Focus the first available pane */
  const focusFirstPane = useCallback(() => {
    if (panes.length > 0) {
      paneRefs.current.get(panes[0].id)?.focus();
    }
  }, [panes]);

  const handlePaneExit = useCallback(
    (ptyId: string, paneId: string) => {
      // Auto-remove pane when the shell process exits (e.g. Ctrl+D)
      // Small delay so the user can see the exit message
      setTimeout(() => removePane(paneId), 500);
    },
    [removePane],
  );

  // Don't render anything if panel is not open
  if (!isOpen) return null;

  return (
    <div
      className="flex h-full flex-col border-t border-[#292e42]"
      data-focus-zone="terminal"
      tabIndex={0}
      onFocus={(e) => {
        // When the zone wrapper itself receives focus (e.g. from focus cycling), delegate to first pane
        if (e.target === e.currentTarget) {
          focusFirstPane();
        }
      }}
    >
      {/* Toolbar — always visible when panel is open */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[#292e42] bg-[#1a1b26] px-2">
        <div className="flex items-center gap-1.5">
          <TerminalIcon className="size-3.5 text-[#565f89]" />
          <span className="text-xs font-medium text-[#a9b1d6]">Terminal</span>
          <span className="ml-0.5 text-xs text-[#565f89]">
            ({panes.length})
          </span>
        </div>
        <div className="flex items-center gap-0.5">
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
            onClick={isMinimized ? togglePanel : minimize}
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
        {panes.length === 1 ? (
          <div
            className="relative h-full cursor-text"
            onClick={() => focusPane(panes[0].id)}
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removePane(panes[0].id); }}
              className="absolute right-2 top-1 z-10 flex size-5 items-center justify-center rounded text-[#565f89] transition-colors hover:bg-[#292e42] hover:text-[#c0caf5]"
              title="Close terminal"
            >
              <X className="size-3" />
            </button>
            <XTermInstance
              ref={(handle) => setPaneRef(panes[0].id, handle)}
              key={panes[0].id}
              featureId={featureId}
              projectId={projectId}
              onExit={(ptyId) => handlePaneExit(ptyId, panes[0].id)}
            />
          </div>
        ) : (
          <ResizablePanelGroup orientation="horizontal" className="h-full">
            {panes.map((pane, index) => (
              <PaneWithHandle key={pane.id} isFirst={index === 0}>
                <ResizablePanel minSize={10}>
                  <div
                    className="relative h-full cursor-text"
                    onClick={() => focusPane(pane.id)}
                  >
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removePane(pane.id); }}
                      className="absolute right-2 top-1 z-10 flex size-5 items-center justify-center rounded text-[#565f89] transition-colors hover:bg-[#292e42] hover:text-[#c0caf5]"
                      title="Close terminal"
                    >
                      <X className="size-3" />
                    </button>
                    <XTermInstance
                      ref={(handle) => setPaneRef(pane.id, handle)}
                      featureId={featureId}
                      projectId={projectId}
                      onExit={(ptyId) => handlePaneExit(ptyId, pane.id)}
                    />
                  </div>
                </ResizablePanel>
              </PaneWithHandle>
            ))}
          </ResizablePanelGroup>
        )}
      </div>
    </div>
  );
}

/**
 * Helper to render a ResizableHandle before each pane except the first.
 */
function PaneWithHandle({
  isFirst,
  children,
}: {
  isFirst: boolean;
  children: React.ReactNode;
}) {
  if (isFirst) return <>{children}</>;
  return (
    <>
      <ResizableHandle className="bg-[#292e42] hover:bg-[#3b4261] transition-colors" />
      {children}
    </>
  );
}
