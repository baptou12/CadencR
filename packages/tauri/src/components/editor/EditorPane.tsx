import { lazy, Suspense } from "react";
import { useEditorStore } from "@/stores/editor-store";
import EditorSubTabs from "./EditorSubTabs";

const CodeMirrorEditor = lazy(() => import("./CodeMirrorEditor"));

interface EditorPaneProps {
  featureId: number;
  paneId: string;
  projectId: number;
  isActive?: boolean;
}

export default function EditorPane({ featureId, paneId, projectId, isActive }: EditorPaneProps) {
  const activeFilePath = useEditorStore((s) => s.features[featureId]?.panes[paneId]?.activeFilePath ?? null);
  const setActivePane = useEditorStore((s) => s.setActivePane);

  function handleFocus() {
    if (!isActive) {
      setActivePane(featureId, paneId);
    }
  }

  const suspenseFallback = (
    <div className="flex flex-col gap-2 p-4 animate-pulse">
      <div className="h-4 w-3/4 rounded bg-muted" />
      <div className="h-4 w-1/2 rounded bg-muted" />
      <div className="h-4 w-5/6 rounded bg-muted" />
    </div>
  );

  return (
    <div className="flex flex-col h-full" onFocus={handleFocus}>
      <EditorSubTabs featureId={featureId} paneId={paneId} />

      <div className="flex-1 overflow-hidden">
        {activeFilePath ? (
          <Suspense fallback={suspenseFallback}>
            <CodeMirrorEditor
              key={activeFilePath}
              filePath={activeFilePath}
              projectId={projectId}
              paneId={paneId}
              featureId={featureId}
            />
          </Suspense>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Open a file from the sidebar or use CMD+P
          </div>
        )}
      </div>
    </div>
  );
}
