import { useEffect } from "react";
import { useEditorState } from "@/stores/editor-store";
import EditorPane from "./EditorPane";

interface FeatureEditorTabProps {
  featureId: number;
  projectPath: string;
}

const MAIN_PANE = "main";

export default function FeatureEditorTab({ featureId, projectPath }: FeatureEditorTabProps) {
  const { initFeature, activePaneId } = useEditorState(featureId);

  useEffect(() => {
    initFeature();
  }, [initFeature]);

  return (
    <div className="flex h-full">
      <EditorPane featureId={featureId} paneId={activePaneId ?? MAIN_PANE} projectPath={projectPath} />
    </div>
  );
}
