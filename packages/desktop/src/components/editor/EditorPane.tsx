import type { EditorView } from "@codemirror/view";
import { lazy, Suspense, useCallback, useState } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { useScopedGlobalShortcutById } from "@/hooks/useShortcut";
import EditorSubTabs from "./EditorSubTabs";

const CodeMirrorEditor = lazy(() => import("./CodeMirrorEditor"));

interface EditorPaneProps {
  featureId: number;
  paneId: string;
  projectId: number;
  isActive?: boolean;
  onEditorViewChange?: (paneId: string, view: EditorView | null) => void;
}

export default function EditorPane({
  featureId,
  paneId,
  projectId,
  isActive,
  onEditorViewChange,
}: EditorPaneProps) {
  const activeFilePath = useEditorStore(
    (s) => s.features[featureId]?.panes[paneId]?.activeFilePath ?? null,
  );
  const activePaneId = useEditorStore((s) => s.features[featureId]?.activePaneId);
  const setActivePane = useEditorStore((s) => s.setActivePane);

  const isFocusedPane = activePaneId === paneId;
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchReopenSignal, setSearchReopenSignal] = useState(0);

  const openSearch = useCallback((): void => {
    setSearchOpen((wasOpen) => {
      if (wasOpen) setSearchReopenSignal((n) => n + 1);
      return true;
    });
  }, []);
  const closeSearch = useCallback((): void => setSearchOpen(false), []);

  useScopedGlobalShortcutById(
    "editor-buffer-search",
    (event) => {
      if (!isFocusedPane || !activeFilePath) return;
      event.preventDefault();
      event.stopPropagation();
      openSearch();
    },
    "editor",
    { enabled: isFocusedPane && Boolean(activeFilePath) },
  );

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
      <EditorSubTabs featureId={featureId} paneId={paneId} projectId={projectId} />

      <div className="flex-1 overflow-hidden">
        {activeFilePath ? (
          <Suspense fallback={suspenseFallback}>
            <CodeMirrorEditor
              key={activeFilePath}
              filePath={activeFilePath}
              projectId={projectId}
              paneId={paneId}
              featureId={featureId}
              searchOpen={searchOpen}
              searchReopenSignal={searchReopenSignal}
              onCloseSearch={closeSearch}
              onEditorViewChange={onEditorViewChange}
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
