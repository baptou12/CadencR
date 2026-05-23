import { type EditorSplitNode } from "@/stores/editor-store";
import { useEditorStore } from "@/stores/editor-store";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import EditorPane from "./EditorPane";
import type { EditorView } from "@codemirror/view";

interface EditorSplitTreeProps {
  node: EditorSplitNode;
  featureId: number;
  projectId: number;
  onEditorViewChange?: (paneId: string, view: EditorView | null) => void;
}

export default function EditorSplitTree({
  node,
  featureId,
  projectId,
  onEditorViewChange,
}: EditorSplitTreeProps) {
  const activePaneId = useEditorStore((s) => s.features[featureId]?.activePaneId);

  if (node.type === "leaf") {
    return (
      <LeafPane
        nodeId={node.id}
        featureId={featureId}
        projectId={projectId}
        isActive={node.id === activePaneId}
        onEditorViewChange={onEditorViewChange}
      />
    );
  }

  const orientation = node.orientation === "horizontal" ? "horizontal" : "vertical";

  return (
    <ResizablePanelGroup orientation={orientation} className="h-full">
      <ResizablePanel defaultSize={50}>
        <EditorSplitTree
          node={node.children[0]}
          featureId={featureId}
          projectId={projectId}
          onEditorViewChange={onEditorViewChange}
        />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={50}>
        <EditorSplitTree
          node={node.children[1]}
          featureId={featureId}
          projectId={projectId}
          onEditorViewChange={onEditorViewChange}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

interface LeafPaneProps {
  nodeId: string;
  featureId: number;
  projectId: number;
  isActive: boolean;
  onEditorViewChange?: (paneId: string, view: EditorView | null) => void;
}

function LeafPane({ nodeId, featureId, projectId, isActive, onEditorViewChange }: LeafPaneProps) {
  const hasActiveFile = useEditorStore((s) =>
    Boolean(s.features[featureId]?.panes[nodeId]?.activeFilePath),
  );
  const showRing = isActive && hasActiveFile;
  return (
    <div className={`h-full flex flex-col ${showRing ? "ring-1 ring-primary/30 ring-inset" : ""}`}>
      <EditorPane
        featureId={featureId}
        paneId={nodeId}
        projectId={projectId}
        isActive={isActive}
        onEditorViewChange={onEditorViewChange}
      />
    </div>
  );
}
