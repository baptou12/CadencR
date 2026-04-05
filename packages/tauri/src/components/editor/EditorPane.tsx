import { lazy, Suspense } from "react";
import { useEditorStore } from "@/stores/editor-store";
import EditorSubTabs from "./EditorSubTabs";

const CodeMirrorEditor = lazy(() => import("./CodeMirrorEditor"));
const ArtifactEditor = lazy(() => import("@/components/workflow/ArtifactEditor"));

interface EditorPaneProps {
  featureId: number;
  paneId: string;
  projectPath: string;
  isActive?: boolean;
}

export default function EditorPane({ featureId, paneId, projectPath, isActive }: EditorPaneProps) {
  const activeFilePath = useEditorStore((s) => s.features[featureId]?.panes[paneId]?.activeFilePath ?? null);
  const activeTab = useEditorStore((s) => s.features[featureId]?.panes[paneId]?.tabs.find((t) => t.filePath === activeFilePath));
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
        {activeFilePath && activeTab?.isArtifact && activeTab.artifactFeatureId != null && activeTab.artifactPhaseSlug ? (
          <Suspense fallback={suspenseFallback}>
            <ArtifactEditor
              key={activeFilePath}
              featureId={activeTab.artifactFeatureId}
              phaseSlug={activeTab.artifactPhaseSlug}
              paneId={paneId}
              filePath={activeFilePath}
              artifactType={activeTab.artifactType}
            />
          </Suspense>
        ) : activeFilePath ? (
          <Suspense fallback={suspenseFallback}>
            <CodeMirrorEditor
              key={activeFilePath}
              filePath={activeFilePath}
              projectPath={projectPath}
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
