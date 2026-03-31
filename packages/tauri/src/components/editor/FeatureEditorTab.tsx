import { useEffect, lazy, Suspense } from "react";
import { useEditorState } from "@/stores/editor-store";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const CodeMirrorEditor = lazy(() => import("./CodeMirrorEditor"));

interface FeatureEditorTabProps {
  featureId: number;
  projectPath: string;
}

const MAIN_PANE = "main";

export default function FeatureEditorTab({ featureId, projectPath }: FeatureEditorTabProps) {
  const { initFeature, panes, activePaneId, closeTab, setActiveFile } = useEditorState(featureId);

  useEffect(() => {
    initFeature();
  }, [initFeature]);

  const pane = panes[activePaneId];
  const tabs = pane?.tabs ?? [];
  const activeFilePath = pane?.activeFilePath ?? null;

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tab bar */}
      {tabs.length > 0 && (
        <div className="flex items-center border-b border-border bg-card overflow-x-auto shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.filePath}
              type="button"
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm border-r border-border whitespace-nowrap shrink-0 hover:bg-accent transition-colors",
                activeFilePath === tab.filePath
                  ? "bg-background text-foreground border-t-2 border-t-primary"
                  : "text-muted-foreground",
              )}
              onClick={() => setActiveFile(MAIN_PANE, tab.filePath)}
            >
              <span>{tab.disambiguatedName}</span>
              {tab.isDirty && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
              <span
                role="button"
                aria-label={`Close ${tab.disambiguatedName}`}
                tabIndex={0}
                className="ml-0.5 rounded hover:bg-muted p-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(MAIN_PANE, tab.filePath);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    closeTab(MAIN_PANE, tab.filePath);
                  }
                }}
              >
                <X className="w-3 h-3" />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Editor area */}
      <div className="flex-1 overflow-hidden">
        {activeFilePath ? (
          <Suspense
            fallback={
              <div className="flex flex-col gap-2 p-4 animate-pulse">
                <div className="h-4 w-3/4 rounded bg-muted" />
                <div className="h-4 w-1/2 rounded bg-muted" />
                <div className="h-4 w-5/6 rounded bg-muted" />
              </div>
            }
          >
            <CodeMirrorEditor
              key={activeFilePath}
              filePath={activeFilePath}
              projectPath={projectPath}
              paneId={activePaneId}
              featureId={featureId}
            />
          </Suspense>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Open a file from the file tree to start editing
          </div>
        )}
      </div>
    </div>
  );
}
