import { memo, useMemo, type ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { SplitNode, SplitOrientation } from "@/hooks/useTerminalState";
import { PaneSlotPlaceholder } from "./PaneSlotPlaceholder";

interface TerminalSplitTreeProps {
  expectedCwd: string | null;
  /** Pane ids whose stale shell is busy — show the "Restart here" warning. */
  warnPaneIds: Set<string>;
  node: SplitNode;
  onDismissWarning: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
  onCopyPane: (paneId: string) => void;
  onFocusPane: (paneId: string) => void;
  onPastePane: (paneId: string) => void;
  onRegisterPlaceholder: (id: string, el: HTMLDivElement | null) => void;
  onRestartPane: (paneId: string) => void;
  onSplitPane: (paneId: string, orientation: SplitOrientation) => void;
}

export const TerminalSplitTree = memo(function TerminalSplitTree(
  props: TerminalSplitTreeProps,
): ReactNode {
  const {
    expectedCwd,
    warnPaneIds,
    node,
    onDismissWarning,
    onClosePane,
    onCopyPane,
    onFocusPane,
    onPastePane,
    onRegisterPlaceholder,
    onRestartPane,
    onSplitPane,
  } = props;
  const splitOrientation = node.type === "leaf" ? null : node.orientation;
  const handleClassName = useMemo(
    () =>
      splitOrientation === "vertical"
        ? "!h-0.5 !w-full bg-[var(--terminal-panel-handle-bg)] hover:bg-[var(--terminal-panel-handle-bg-hover)] transition-colors"
        : "bg-[var(--terminal-panel-handle-bg)] hover:bg-[var(--terminal-panel-handle-bg-hover)] transition-colors",
    [splitOrientation],
  );
  if (node.type === "leaf") {
    return (
      <PaneSlotPlaceholder
        leaf={node}
        expectedCwd={expectedCwd}
        showWarning={warnPaneIds.has(node.id)}
        registerPlaceholder={onRegisterPlaceholder}
        onFocus={onFocusPane}
        onSplit={onSplitPane}
        onRestart={onRestartPane}
        onDismiss={onDismissWarning}
        onClose={onClosePane}
        onCopy={onCopyPane}
        onPaste={onPastePane}
      />
    );
  }
  const [a, b] = node.children;
  return (
    <ResizablePanelGroup orientation={node.orientation} className="h-full">
      <ResizablePanel minSize={10}>
        <TerminalSplitTree {...props} node={a} />
      </ResizablePanel>
      <ResizableHandle className={handleClassName} />
      <ResizablePanel minSize={10}>
        <TerminalSplitTree {...props} node={b} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}, areTerminalSplitTreePropsEqual);

TerminalSplitTree.displayName = "TerminalSplitTree";

function areTerminalSplitTreePropsEqual(
  prev: TerminalSplitTreeProps,
  next: TerminalSplitTreeProps,
): boolean {
  return (
    prev.expectedCwd === next.expectedCwd &&
    prev.warnPaneIds === next.warnPaneIds &&
    prev.node === next.node &&
    prev.onClosePane === next.onClosePane &&
    prev.onCopyPane === next.onCopyPane &&
    prev.onDismissWarning === next.onDismissWarning &&
    prev.onFocusPane === next.onFocusPane &&
    prev.onPastePane === next.onPastePane &&
    prev.onRegisterPlaceholder === next.onRegisterPlaceholder &&
    prev.onRestartPane === next.onRestartPane &&
    prev.onSplitPane === next.onSplitPane
  );
}
