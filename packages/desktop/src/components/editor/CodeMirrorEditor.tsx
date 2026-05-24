import { useEffect, useRef, useCallback, useState, useMemo, lazy, Suspense } from "react";
import { EditorView } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import { Loader2Icon } from "lucide-react";
import { useReadFile, useWriteFile, useGetBlame, useGetFeatureWorkingDir } from "@/api/generated";
import { useEditorStore } from "@/stores/editor-store";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { useLsp } from "@/lib/lsp/useLsp";
import { useScopedShortcut } from "@/hooks/useShortcut";
import { cn } from "@/lib/utils";
import { getFileExtension, getLanguageExtension, isMarkdownFile } from "./language-extensions";
import { gitBlameExtension } from "./git-blame-extension";
import { registerSave, unregisterSave } from "./editorSaveRegistry";
import BaseCodeMirrorEditor from "./BaseCodeMirrorEditor";
import { EditorStatusBar } from "./EditorStatusBar";
import EditorSearchPanel from "./editor-search/EditorSearchPanel";
import { bufferSearchExtension } from "./editor-search/search-extension";
import { toast } from "sonner";

// Markdown pulls in react-markdown + lowlight (~35 grammars) — only loaded
// when the user actually previews a markdown file.
const Markdown = lazy(() => import("@/components/Markdown").then((m) => ({ default: m.Markdown })));

interface CodeMirrorEditorProps {
  filePath: string;
  projectId: number;
  paneId: string;
  featureId: number;
  searchOpen: boolean;
  searchReopenSignal: number;
  onCloseSearch: () => void;
  onEditorViewChange?: (paneId: string, view: EditorView | null) => void;
}

const AUTO_SAVE_DELAY_MS = 1500;

export function clampEditorLineNumber(lineNumber: number, lineCount: number): number {
  return Math.min(Math.max(1, lineNumber), Math.max(1, lineCount));
}

function getLanguageName(filePath: string): string {
  const ext = getFileExtension(filePath);
  const MAP: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TSX",
    js: "JavaScript",
    jsx: "JSX",
    json: "JSON",
    html: "HTML",
    css: "CSS",
    rs: "Rust",
    md: "Markdown",
    mdx: "MDX",
    yaml: "YAML",
    yml: "YAML",
    toml: "TOML",
    py: "Python",
    go: "Go",
    sql: "SQL",
    sh: "Shell",
    bash: "Shell",
    zsh: "Shell",
  };
  return MAP[ext] ?? "Plain Text";
}

export default function CodeMirrorEditor({
  filePath,
  projectId,
  paneId,
  featureId,
  searchOpen,
  searchReopenSignal,
  onCloseSearch,
  onEditorViewChange,
}: CodeMirrorEditorProps) {
  const viewRef = useRef<EditorView | null>(null);
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoSavedVisible, setAutoSavedVisible] = useState(false);
  const autoSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutateAsyncRef = useRef<ReturnType<typeof useWriteFile>["mutateAsync"] | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const isMarkdown = isMarkdownFile(filePath);

  const { value: vimModeSetting } = useDebouncedSetting("editor_vim_mode");
  const { value: autoSaveSetting } = useDebouncedSetting("editor_auto_save");
  const { value: gitBlameSetting } = useDebouncedSetting("editor_git_blame");
  const isVimEnabled = (vimModeSetting ?? "false") === "true";
  const isAutoSaveEnabled = (autoSaveSetting ?? "false") === "true";
  const isBlameEnabled = (gitBlameSetting ?? "false") === "true";
  const isAutoSaveEnabledRef = useRef(isAutoSaveEnabled);
  isAutoSaveEnabledRef.current = isAutoSaveEnabled;

  const blameCompartment = useRef(new Compartment());
  const lspCompartment = useRef(new Compartment());

  // Workspace root for LSP. The working-dir query is also fired by other
  // components (file watcher, project tree) — React Query dedupes by key, so
  // this is effectively free.
  const cwdQuery = useGetFeatureWorkingDir(
    featureId,
    { project_id: projectId },
    { query: { enabled: Boolean(featureId && projectId), refetchOnWindowFocus: false } },
  );
  const workspaceRoot = cwdQuery.data?.path ?? undefined;
  const lsp = useLsp({ workspaceRoot, filePath, featureId, paneId });

  const { data: blameData } = useGetBlame(
    { project_id: projectId, feature_id: featureId, file_path: filePath },
    {
      query: {
        enabled: isBlameEnabled && Boolean(projectId && filePath),
        refetchOnWindowFocus: false,
      },
    },
  );

  const setDirty = useEditorStore((s) => s.setDirty);
  const setCursorPosition = useEditorStore((s) => s.setCursorPosition);
  const clearPendingGoToLine = useEditorStore((s) => s.clearPendingGoToLine);
  const cursorPosition = useEditorStore(
    (s) =>
      s.features[featureId]?.panes[paneId]?.tabs.find((t) => t.filePath === filePath)
        ?.cursorPosition ?? { line: 1, col: 1 },
  );
  const pendingGoToLine = useEditorStore(
    (s) =>
      s.features[featureId]?.panes[paneId]?.tabs.find((t) => t.filePath === filePath)
        ?.pendingGoToLine,
  );

  const { data, error } = useReadFile(
    { project_id: projectId, feature_id: featureId, file_path: filePath },
    {
      query: {
        enabled: Boolean(filePath && projectId),
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  );

  const writeFile = useWriteFile();
  mutateAsyncRef.current = writeFile.mutateAsync;

  const saveQuiet = useCallback(async () => {
    const view = viewRef.current;
    if (!view || !mutateAsyncRef.current) return;
    const content = view.state.doc.toString();
    try {
      await mutateAsyncRef.current({
        data: {
          project_id: projectId,
          feature_id: featureId,
          file_path: filePath,
          content,
        },
      });
      setDirty(featureId, paneId, filePath, false);
      setAutoSavedVisible(true);
      if (autoSavedTimerRef.current) clearTimeout(autoSavedTimerRef.current);
      autoSavedTimerRef.current = setTimeout(() => setAutoSavedVisible(false), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to auto-save file";
      toast.error(msg);
    }
  }, [projectId, filePath, featureId, paneId, setDirty]);

  const save = useCallback(async () => {
    const view = viewRef.current;
    if (!view || !mutateAsyncRef.current) return;
    const content = view.state.doc.toString();
    try {
      await mutateAsyncRef.current({
        data: {
          project_id: projectId,
          feature_id: featureId,
          file_path: filePath,
          content,
        },
      });
      setDirty(featureId, paneId, filePath, false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save file";
      toast.error(msg);
    }
  }, [projectId, filePath, featureId, paneId, setDirty]);

  const handleSave = useCallback(() => {
    void save();
  }, [save]);

  const handleChange = useCallback(() => {
    setDirty(featureId, paneId, filePath, true);
    if (isAutoSaveEnabledRef.current) {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => {
        void saveQuiet();
      }, AUTO_SAVE_DELAY_MS);
    }
  }, [featureId, paneId, filePath, setDirty, saveQuiet]);

  const handleEditorViewChange = useCallback(
    (view: EditorView | null): void => {
      setEditorView(view);
      onEditorViewChange?.(paneId, view);
    },
    [onEditorViewChange, paneId],
  );

  const togglePreview = useCallback(() => {
    if (!isMarkdown) return;
    // Editor is guaranteed mounted past the loader guard below.
    setPreviewContent((prev) =>
      prev !== null ? null : (viewRef.current?.state.doc.toString() ?? ""),
    );
    // Force-close the search panel so its `searchOpen` flag doesn't go stale
    // while the panel is hidden during preview.
    onCloseSearch();
  }, [isMarkdown, onCloseSearch]);

  useScopedShortcut(
    "editor-toggle-markdown-preview",
    (e) => {
      e.preventDefault();
      togglePreview();
    },
    "editor",
    { enabled: isMarkdown },
  );

  const bufferSearch = useMemo(() => bufferSearchExtension(), []);

  const langExt = useMemo(() => getLanguageExtension(filePath), [filePath]);

  // Hot-swap blame extension when data or setting changes.
  // `data` is in deps so the effect re-runs once the editor mounts after the file loads;
  // otherwise an early-arriving blameData would be lost when viewRef is still null.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const ext = isBlameEnabled && blameData ? gitBlameExtension(blameData.lines) : [];
    view.dispatch({ effects: blameCompartment.current.reconfigure(ext) });
  }, [isBlameEnabled, blameData, data]);

  // Hot-swap LSP extensions once the client for this file's language is ready.
  // `lsp.extension` is `[]` until the session and WebSocket are open; we
  // reconfigure the compartment then so the editor picks up cmd-click + F12
  // without remounting.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: lspCompartment.current.reconfigure(lsp.extension) });
  }, [lsp.extension]);

  const cursorExtension = useMemo(() => {
    return EditorView.updateListener.of((update) => {
      if (update.selectionSet) {
        const cursor = update.state.selection.main.head;
        const line = update.state.doc.lineAt(cursor);
        setCursorPosition(featureId, paneId, filePath, {
          line: line.number,
          col: cursor - line.from + 1,
        });
      }
    });
  }, [featureId, paneId, filePath, setCursorPosition]);

  // Register save callback for external callers
  useEffect(() => {
    registerSave(paneId, filePath, save);
    return () => unregisterSave(paneId, filePath);
  }, [paneId, filePath, save]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      if (autoSavedTimerRef.current) clearTimeout(autoSavedTimerRef.current);
    };
  }, []);

  // Clear any stale `isDirty` carried over from a previous mount of this tab
  // (its unsaved edits were thrown away on unmount). EditorPane keys this
  // component by file path, so this fires exactly once per file open.
  useEffect(() => {
    setDirty(featureId, paneId, filePath, false);
  }, [featureId, paneId, filePath, setDirty]);

  // Scroll to pending go-to line after content is loaded
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !data || pendingGoToLine == null) return;

    const lineCount = view.state.doc.lines;
    const targetLine = clampEditorLineNumber(pendingGoToLine, lineCount);
    const line = view.state.doc.line(targetLine);

    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });

    clearPendingGoToLine(featureId, paneId, filePath);
  }, [data, pendingGoToLine, featureId, paneId, filePath, clearPendingGoToLine]);

  const isPreviewing = previewContent !== null;

  const previewToggle = useMemo(
    () => (isMarkdown ? { active: isPreviewing, onToggle: togglePreview } : undefined),
    [isMarkdown, isPreviewing, togglePreview],
  );

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-background text-destructive text-sm px-6 text-center">
        {error instanceof Error ? error.message : "Failed to load file"}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <BaseCodeMirrorEditor
        initialContent={data.content}
        language={langExt}
        vimMode={isVimEnabled}
        onChange={handleChange}
        onSave={handleSave}
        extraExtensions={[
          cursorExtension,
          blameCompartment.current.of([]),
          lspCompartment.current.of([]),
          bufferSearch,
        ]}
        editorViewRef={viewRef}
        onEditorViewChange={handleEditorViewChange}
        className={cn("flex-1 overflow-auto", isPreviewing && "hidden")}
      />
      {isPreviewing && (
        <div className="flex-1 overflow-auto bg-background">
          <div className="max-w-3xl mx-auto px-6 py-4">
            <Suspense fallback={null}>
              <Markdown content={previewContent ?? ""} cacheKey={filePath} />
            </Suspense>
          </div>
        </div>
      )}
      {searchOpen && editorView && !isPreviewing && (
        <EditorSearchPanel
          view={editorView}
          featureId={featureId}
          paneId={paneId}
          reopenSignal={searchReopenSignal}
          onClose={onCloseSearch}
        />
      )}
      <EditorStatusBar
        line={cursorPosition.line}
        col={cursorPosition.col}
        language={getLanguageName(filePath)}
        autoSavedVisible={autoSavedVisible}
        lspStatus={lsp.status}
        lspLanguageId={lsp.languageId}
        lspError={lsp.errorMessage}
        preview={previewToggle}
      />
    </div>
  );
}
