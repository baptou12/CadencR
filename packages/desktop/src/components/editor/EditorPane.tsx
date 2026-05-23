import type { EditorView } from "@codemirror/view";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { useScopedGlobalShortcutById } from "@/hooks/useShortcut";
import EditorSubTabs from "./EditorSubTabs";
import { clearPaneSearch } from "./editor-search/search-cache";

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
  // Replace mode is sticky: once the user opens the replace row, repeated ⌘F
  // calls keep it visible until the panel is closed. ⌘⌥F always re-opens
  // into replace mode and bumps `replaceFocusSignal` so the replace input
  // grabs focus even if the panel is already open in find-only mode.
  const [replaceMode, setReplaceMode] = useState(false);
  const [replaceFocusSignal, setReplaceFocusSignal] = useState(0);
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const [goToLineReopenSignal, setGoToLineReopenSignal] = useState(0);

  const openSearch = useCallback((withReplace: boolean): void => {
    setSearchOpen((wasOpen) => {
      if (wasOpen) setSearchReopenSignal((n) => n + 1);
      return true;
    });
    if (withReplace) {
      setReplaceMode(true);
      setReplaceFocusSignal((n) => n + 1);
    }
  }, []);
  const closeSearch = useCallback((): void => {
    setSearchOpen(false);
    // Reset replace visibility so the next ⌘F lands in find-only mode.
    setReplaceMode(false);
  }, []);

  useScopedGlobalShortcutById(
    "editor-buffer-search",
    (event) => {
      if (!isFocusedPane || !activeFilePath) return;
      event.preventDefault();
      event.stopPropagation();
      openSearch(false);
    },
    "editor",
    { enabled: isFocusedPane && Boolean(activeFilePath) },
  );

  useScopedGlobalShortcutById(
    "editor-replace",
    (event) => {
      if (!isFocusedPane || !activeFilePath) return;
      event.preventDefault();
      event.stopPropagation();
      openSearch(true);
    },
    "editor",
    { enabled: isFocusedPane && Boolean(activeFilePath) },
  );

  const openGoToLine = useCallback((): void => {
    setGoToLineOpen((wasOpen) => {
      if (wasOpen) setGoToLineReopenSignal((n) => n + 1);
      return true;
    });
  }, []);
  const closeGoToLine = useCallback((): void => setGoToLineOpen(false), []);

  useScopedGlobalShortcutById(
    "editor-go-to-line",
    (event) => {
      if (!isFocusedPane || !activeFilePath) return;
      event.preventDefault();
      event.stopPropagation();
      openGoToLine();
    },
    "editor",
    { enabled: isFocusedPane && Boolean(activeFilePath) },
  );

  useEffect(() => {
    return () => clearPaneSearch(featureId, paneId);
  }, [featureId, paneId]);

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
              searchReplaceMode={replaceMode}
              searchReplaceFocusSignal={replaceFocusSignal}
              goToLineOpen={goToLineOpen}
              goToLineReopenSignal={goToLineReopenSignal}
              onCloseSearch={closeSearch}
              onCloseGoToLine={closeGoToLine}
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
