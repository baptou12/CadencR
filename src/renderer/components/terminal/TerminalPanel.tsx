import { useCallback } from "react";
import { Plus, SplitSquareHorizontal, Minus, X, TerminalIcon } from "lucide-react";
import { XTermInstance } from "./XTermInstance";
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
    <div className="flex h-full flex-col border-t border-border">
      {/* Toolbar — always visible when panel is open */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-[#1e1e2e] px-2">
        <div className="flex items-center gap-1">
          <TerminalIcon className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Terminal</span>
          <span className="ml-1 text-xs text-muted-foreground/60">
            ({panes.length})
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {/* New terminal */}
          <button
            type="button"
            onClick={addPane}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-white/10 hover:text-foreground"
            title="New terminal (Ctrl+Shift+`)"
          >
            <Plus className="size-3.5" />
          </button>
          {/* Split */}
          <button
            type="button"
            onClick={addPane}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-white/10 hover:text-foreground"
            title="Split terminal (Ctrl+Shift+`)"
          >
            <SplitSquareHorizontal className="size-3.5" />
          </button>
          {/* Minimize / Restore */}
          <button
            type="button"
            onClick={isMinimized ? togglePanel : minimize}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-white/10 hover:text-foreground"
            title={isMinimized ? "Restore terminal" : "Minimize terminal"}
          >
            <Minus className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal panes — hidden when minimized but kept mounted so PTYs stay alive */}
      <div
        className="min-h-0 flex-1 overflow-hidden"
        style={isMinimized ? { height: 0, minHeight: 0 } : undefined}
      >
        {panes.length === 1 ? (
          <div className="relative h-full">
            <button
              type="button"
              onClick={() => removePane(panes[0].id)}
              className="absolute right-2 top-1 z-10 flex size-5 items-center justify-center rounded text-muted-foreground/60 hover:bg-white/10 hover:text-foreground"
              title="Close terminal"
            >
              <X className="size-3" />
            </button>
            <XTermInstance
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
                  <div className="relative h-full">
                    <button
                      type="button"
                      onClick={() => removePane(pane.id)}
                      className="absolute right-2 top-1 z-10 flex size-5 items-center justify-center rounded text-muted-foreground/60 hover:bg-white/10 hover:text-foreground"
                      title="Close terminal"
                    >
                      <X className="size-3" />
                    </button>
                    <XTermInstance
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
      <ResizableHandle />
      {children}
    </>
  );
}
