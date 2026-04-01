import { type EditorSplitNode } from "@/stores/editor-store";
import { useEditorStore } from "@/stores/editor-store";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import EditorPane from "./EditorPane";

interface EditorSplitTreeProps {
  node: EditorSplitNode;
  featureId: number;
  projectPath: string;
}

export default function EditorSplitTree({ node, featureId, projectPath }: EditorSplitTreeProps) {
  const activePaneId = useEditorStore((s) => s.features[featureId]?.activePaneId);

  if (node.type === "leaf") {
    const isActive = node.id === activePaneId;
    return (
      <div className={`h-full flex flex-col ${isActive ? "ring-1 ring-primary/30 ring-inset" : ""}`}>
        <EditorPane
          featureId={featureId}
          paneId={node.id}
          projectPath={projectPath}
          isActive={isActive}
        />
      </div>
    );
  }

  const orientation = node.orientation === "horizontal" ? "horizontal" : "vertical";

  return (
    <ResizablePanelGroup orientation={orientation} className="h-full">
      <ResizablePanel defaultSize={50}>
        <EditorSplitTree node={node.children[0]} featureId={featureId} projectPath={projectPath} />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={50}>
        <EditorSplitTree node={node.children[1]} featureId={featureId} projectPath={projectPath} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
