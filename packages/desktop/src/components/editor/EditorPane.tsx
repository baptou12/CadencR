import type { EditorView } from "@codemirror/view";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useEditorStore, isUntitledPath } from "@/stores/editor-store";
import { useScopedGlobalShortcutById } from "@/hooks/useShortcut";
import { isExcalidrawFile, isImageFile } from "@/lib/file-language";
import EditorSubTabs from "./EditorSubTabs";
import { copyFilePath } from "./copyFilePath";
import { clearPaneSearch } from "./editor-search/search-cache";
import { useActiveConflict } from "./useAutoConflictResolution";

const CodeMirrorEditor = lazy(() => import("./CodeMirrorEditor"));
const ConflictResolverEditor = lazy(() => import("./ConflictResolverEditor"));
const UntitledCodeMirrorEditor = lazy(() => import("./UntitledCodeMirrorEditor"));
const ImageFileViewer = lazy(() => import("./ImageFileViewer"));
const ExcalidrawEditor = lazy(() => import("./ExcalidrawEditor"));

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
  const activeFileIsDirty = useEditorStore(
    (s) =>
      s.features[featureId]?.panes[paneId]?.tabs.find((tab) => tab.filePath === activeFilePath)
        ?.isDirty ?? false,
  );
  const activeConflict = useActiveConflict(activeFilePath, activeFileIsDirty);
  const setActivePane = useEditorStore((s) => s.setActivePane);
  const openUntitledBuffer = useEditorStore((s) => s.openUntitledBuffer);

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

  // CMD+N: spawn a fresh untitled buffer in the currently focused pane.
  // Scoped to the editor tab so it doesn't fire while the agent/terminal
  // is in front. We only handle this on the focused pane — every pane
  // mounts this hook, but only one of them owns the chord at a time.
  useScopedGlobalShortcutById(
    "editor-new",
    (event) => {
      if (!isFocusedPane) return;
      event.preventDefault();
      event.stopPropagation();
      openUntitledBuffer(featureId, paneId);
    },
    "editor",
    { enabled: isFocusedPane },
  );

  // CMD+SHIFT+C: copy the active file's project-relative path. Capture-phase
  // + editor-scoped so it works with CodeMirror focused; gated on the focused
  // pane so a split layout copies the file the user is actually looking at.
  useScopedGlobalShortcutById(
    "editor-copy-path",
    (event) => {
      if (!isFocusedPane) return;
      event.preventDefault();
      event.stopPropagation();
      copyFilePath(activeFilePath);
    },
    "editor",
    { enabled: isFocusedPane },
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
            {activeConflict ? (
              <ConflictResolverEditor
                key={`conflict:${activeFilePath}`}
                filePath={activeFilePath}
                conflictKind={activeConflict.kind}
                projectId={projectId}
                paneId={paneId}
                featureId={featureId}
                onEditorViewChange={onEditorViewChange}
              />
            ) : isExcalidrawFile(activeFilePath) ? (
              <ExcalidrawEditor
                key={activeFilePath}
                filePath={activeFilePath}
                projectId={projectId}
                featureId={featureId}
                paneId={paneId}
              />
            ) : isImageFile(activeFilePath) ? (
              <ImageFileViewer
                key={activeFilePath}
                filePath={activeFilePath}
                projectId={projectId}
                featureId={featureId}
              />
            ) : isUntitledPath(activeFilePath) ? (
              <UntitledCodeMirrorEditor
                key={activeFilePath}
                filePath={activeFilePath}
                projectId={projectId}
                paneId={paneId}
                featureId={featureId}
                onEditorViewChange={onEditorViewChange}
              />
            ) : (
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
            )}
          </Suspense>
        ) : (
          <div className="flex items-center justify-center h-full px-4 text-muted-foreground text-sm text-center text-balance">
            Open a file from the sidebar, press CMD+N for a new buffer, or use CMD+P
          </div>
        )}
      </div>
    </div>
  );
}
